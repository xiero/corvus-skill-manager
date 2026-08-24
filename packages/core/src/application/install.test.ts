import {promises as fs} from 'node:fs';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {type TestHome, createStubGit, createTestHome, listTree} from '../../../../test/support/appHarness.js';
import {
  type SkillpackFixture,
  v2SkillpackFixture,
  v3BundleSkillpackFixture
} from '../../../../test/support/skillpackFixtures.js';
import {loadConfig, saveConfig} from '../config/configStore.js';
import type {CorvusApplication} from './CorvusApplication.js';
import {createCorvusApplication} from './createCorvusApplication.js';
import {installRequestFromFlags, normalizeInstallRequest, parseInstallRequest} from './install/installRequest.js';

const homes: TestHome[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map(async (home) => home.cleanup()));
});

async function newHome(options: Parameters<typeof createTestHome>[0] = {}): Promise<TestHome> {
  const home = await createTestHome({skillpack: v2SkillpackFixture, ...options});
  homes.push(home);
  return home;
}

function appFor(home: TestHome): CorvusApplication {
  return createCorvusApplication({
    homeDir: home.homeDir,
    git: createStubGit({commitHash: home.commitHash}).runner,
    now: () => new Date('2025-01-01T00:00:00.000Z')
  });
}

async function planAndApply(
  app: CorvusApplication,
  request: unknown
): Promise<{planId: string; apply: Awaited<ReturnType<CorvusApplication['installApply']>>}> {
  const plan = await app.installPlan(request);

  if (!plan.ok || plan.data.planId === undefined) {
    throw new Error(`Plan failed: ${JSON.stringify(plan.errors)}`);
  }

  const planId = plan.data.planId;

  return {planId, apply: await app.installApply({planId, confirm: planId})};
}

function codexTargetDir(home: TestHome): string {
  return path.join(home.homeDir, '.agents', 'skills');
}

async function selectCodexBundles(home: TestHome, selectedBundleIds: string[]): Promise<void> {
  const config = await loadConfig(home.configPath);
  await saveConfig(
    {
      ...config,
      agents: {
        ...config.agents,
        codex: {enabled: true, selectedSkillIds: [], selectedBundleIds}
      }
    },
    {configPath: home.configPath}
  );
}

function v3RelationshipFixture(options: {
  skills: Array<{
    id: string;
    supportedAgents?: string[];
    requires?: string[];
    recommends?: string[];
    conflictsWith?: string[];
  }>;
  bundles: Array<{id: string; skills: string[]}>;
}): SkillpackFixture {
  return {
    registry: {
      version: 3,
      skills: options.skills.map((skill) => ({
        id: skill.id,
        version: '1.0.0',
        path: `skills/${skill.id}`,
        title: skill.id,
        description: `${skill.id} skill.`,
        supportedAgents: skill.supportedAgents ?? ['codex'],
        ...(skill.requires === undefined
          ? {}
          : {requires: skill.requires.map((id) => ({id, version: '^1.0.0'}))}),
        ...(skill.recommends === undefined ? {} : {recommends: skill.recommends}),
        ...(skill.conflictsWith === undefined ? {} : {conflictsWith: skill.conflictsWith})
      })),
      bundles: options.bundles.map((bundle) => ({
        id: bundle.id,
        version: '1.0.0',
        title: bundle.id,
        description: `${bundle.id} bundle.`,
        skills: bundle.skills.map((id) => ({id, version: '^1.0.0'}))
      }))
    },
    skills: options.skills.map((skill) => ({
      relativePath: `skills/${skill.id}`,
      frontmatter: {name: skill.id, description: `${skill.id} skill.`},
      body: `${skill.id} body.`
    }))
  };
}

describe('install request contract', () => {
  it('normalizes CLI flags and a request document to the same request', () => {
    const fromFlags = normalizeInstallRequest(
      parseInstallRequest(
        installRequestFromFlags({
          agents: ['claude', 'codex', 'codex'],
          skills: ['git-commit', 'embedded-testing', 'git-commit'],
          reasons: {'git-commit': 'Commit hygiene.'},
          intent: 'Set up embedded work'
        })
      )
    );
    const fromDocument = normalizeInstallRequest(
      parseInstallRequest({
        schemaVersion: 1,
        intent: 'Set up embedded work',
        targetAgents: ['codex', 'claude'],
        selectedSkills: [
          {id: 'embedded-testing'},
          {id: 'git-commit', reason: 'Commit hygiene.'},
          {id: 'git-commit', reason: 'Ignored duplicate.'}
        ]
      })
    );

    expect(fromFlags).toEqual(fromDocument);
    expect(fromFlags.targetAgents).toEqual(['claude', 'codex']);
    expect(fromFlags.selectedSkills).toEqual([
      {id: 'embedded-testing'},
      {id: 'git-commit', reason: 'Commit hygiene.'}
    ]);
  });

  it('rejects supplying both explicit skills and allCompatible', () => {
    expect(() =>
      parseInstallRequest({
        schemaVersion: 1,
        targetAgents: ['codex'],
        selectedSkills: [{id: 'git-commit'}],
        allCompatible: true
      })
    ).toThrow();
  });

  it('rejects a request with neither a selection nor allCompatible', () => {
    expect(() => parseInstallRequest({schemaVersion: 1, targetAgents: ['codex']})).toThrow();
  });

  it('accepts a deliberately empty explicit selection', () => {
    const request = normalizeInstallRequest(
      parseInstallRequest({schemaVersion: 1, targetAgents: ['codex'], selectedSkills: []})
    );

    expect(request.selectedSkills).toEqual([]);
    expect(request.allCompatible).toBe(false);
  });

  it('rejects an unknown agent and an over-long intent', () => {
    expect(() => parseInstallRequest({schemaVersion: 1, targetAgents: ['nope'], selectedSkills: []})).toThrow();
    expect(() =>
      parseInstallRequest({
        schemaVersion: 1,
        intent: 'x'.repeat(501),
        targetAgents: ['codex'],
        selectedSkills: []
      })
    ).toThrow();
  });
});

describe('install plan', () => {
  it('expands required dependencies with a dependency-of reason', async () => {
    const home = await newHome();
    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      intent: 'Install a balanced skill set for embedded development',
      selectionPolicy: 'balanced',
      targetAgents: ['codex'],
      selectedSkills: [{id: 'embedded-driver-development', reason: 'Relevant to embedded drivers.'}]
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.data.plan.summary.dependenciesAdded).toEqual(['corvus-skillpack:embedded-toolchain']);
    expect(result.data.plan.selections).toEqual([
      {
        agentId: 'codex',
        skillId: 'corvus-skillpack:embedded-driver-development',
        reason: 'Relevant to embedded drivers.',
        reasonKind: 'explicit',
        origins: [{kind: 'explicit', reason: 'Relevant to embedded drivers.'}]
      },
      {
        agentId: 'codex',
        skillId: 'corvus-skillpack:embedded-toolchain',
        reason: 'dependency-of:corvus-skillpack:embedded-driver-development',
        reasonKind: 'dependency-of',
        origins: [
          {
            kind: 'dependency-of',
            reason: 'dependency-of:corvus-skillpack:embedded-driver-development'
          }
        ]
      }
    ]);
    expect(result.data.plan.summary.recommendationsNotSelected).toEqual(['corvus-skillpack:embedded-testing']);
    expect(result.warnings.some((warning) => warning.code === 'recommendation-not-selected')).toBe(true);
  });

  it('blocks an explicit unsupported skill/agent pair instead of skipping it', async () => {
    const home = await newHome();
    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      targetAgents: ['gemini'],
      selectedSkills: [{id: 'react-component-design'}]
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('SKILL_NOT_SUPPORTED_BY_AGENT');
      expect(result.errors[0]?.agentId).toBe('gemini');
    }
  });

  it('blocks an unknown skill id', async () => {
    const home = await newHome();
    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'ghost'}]
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('SKILL_NOT_FOUND');
    }
  });

  it('requires a target path for the custom agent', async () => {
    const home = await newHome();
    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      targetAgents: ['custom'],
      selectedSkills: []
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('AGENT_TARGET_REQUIRED');
    }
  });

  it('accepts an explicit target path for the custom agent', async () => {
    const home = await newHome();
    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      targetAgents: ['custom'],
      selectedSkills: [],
      agentTargetPaths: {custom: path.join(home.homeDir, 'custom-skills')}
    });

    expect(result.ok).toBe(true);
  });

  it('plans every compatible skill for --all-compatible', async () => {
    const home = await newHome();
    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      targetAgents: ['gemini'],
      allCompatible: true
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.plan.operations.map((operation) => operation.skillId).sort()).toEqual([
        'corvus-skillpack:embedded-toolchain',
        'corvus-skillpack:git-commit',
        'corvus-skillpack:test-driven-development'
      ]);
    }
  });

  it('plans multiple agents in one plan', async () => {
    const home = await newHome();
    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      targetAgents: ['codex', 'claude'],
      selectedSkills: [{id: 'git-commit'}]
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.plan.targetAgents).toEqual(['claude', 'codex']);
      expect(result.data.plan.operations).toHaveLength(2);
    }
  });

  it('is additive by default and never removes an existing selection', async () => {
    const home = await newHome({
      agents: {codex: {enabled: true, selectedSkillIds: ['git-commit']}}
    });
    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'test-driven-development'}]
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.plan.configChanges[0]?.selectedSkillIdsTo).toEqual([
        'corvus-skillpack:git-commit',
        'corvus-skillpack:test-driven-development'
      ]);
      expect(result.data.plan.operations.filter((operation) => operation.type === 'remove-link')).toEqual([]);
      expect(result.data.planId).toBeDefined();
      if (result.data.planId === undefined) return;

      const apply = await appFor(home).installApply({
        planId: result.data.planId,
        confirm: result.data.planId
      });
      expect(apply.ok).toBe(true);
      expect((await fs.lstat(path.join(codexTargetDir(home), 'git-commit'))).isSymbolicLink()).toBe(true);
      expect((await loadConfig(home.configPath)).agents?.codex?.selectedSkillIds).toEqual([
        'corvus-skillpack:git-commit',
        'corvus-skillpack:test-driven-development'
      ]);
    }
  });

  it('keeps dependency-expanded links separate from persisted root skills', async () => {
    const home = await newHome();
    const app = appFor(home);
    const plan = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'embedded-driver-development'}]
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok || plan.data.planId === undefined) return;

    expect(plan.data.plan.configChanges[0]?.selectedSkillIdsTo).toEqual([
      'corvus-skillpack:embedded-driver-development'
    ]);
    expect(plan.data.plan.operations.map((operation) => operation.skillId).sort()).toEqual([
      'corvus-skillpack:embedded-driver-development',
      'corvus-skillpack:embedded-toolchain'
    ]);

    const apply = await app.installApply({planId: plan.data.planId, confirm: plan.data.planId});
    expect(apply.ok).toBe(true);
    expect((await loadConfig(home.configPath)).agents?.codex?.selectedSkillIds).toEqual([
      'corvus-skillpack:embedded-driver-development'
    ]);
  });

  it('preserves existing bundle roots through the v1 skill-only install workflow', async () => {
    const home = await newHome({skillpack: v3BundleSkillpackFixture});
    const config = await loadConfig(home.configPath);
    await saveConfig(
      {
        ...config,
        agents: {
          ...config.agents,
          codex: {
            enabled: true,
            selectedSkillIds: [],
            selectedBundleIds: ['corvus-skillpack:default']
          }
        }
      },
      {configPath: home.configPath}
    );
    const app = appFor(home);
    const plan = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'docs-helper'}],
      replaceSelection: true
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok || plan.data.planId === undefined) return;

    expect(plan.data.plan.configChanges[0]).toMatchObject({
      selectedBundleIdsFrom: ['corvus-skillpack:default'],
      selectedBundleIdsTo: ['corvus-skillpack:default']
    });
    expect(plan.data.plan.operations.map((operation) => operation.skillId).sort()).toEqual([
      'corvus-skillpack:docs-helper',
      'corvus-skillpack:git-basics',
      'corvus-skillpack:review-helper',
      'corvus-skillpack:test-helper'
    ]);
    expect(
      plan.data.plan.selections.find(
        (selection) => selection.skillId === 'corvus-skillpack:review-helper'
      )
    ).toMatchObject({
      reason: 'bundle:corvus-skillpack:default',
      reasonKind: 'bundle-member',
      origins: [
        {kind: 'bundle-member', reason: 'bundle:corvus-skillpack:default'}
      ]
    });

    const apply = await app.installApply({planId: plan.data.planId, confirm: plan.data.planId});
    expect(apply.ok).toBe(true);
    expect((await loadConfig(home.configPath)).agents?.codex?.selectedBundleIds).toEqual([
      'corvus-skillpack:default'
    ]);
  });

  it('blocks a bundle atomically when a direct member does not support the target agent', async () => {
    const home = await newHome({
      skillpack: v3RelationshipFixture({
        skills: [
          {id: 'supported'},
          {id: 'blocked', supportedAgents: ['claude']}
        ],
        bundles: [{id: 'workflow', skills: ['supported', 'blocked']}]
      })
    });
    await selectCodexBundles(home, ['corvus-skillpack:workflow']);

    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: []
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'SKILL_NOT_SUPPORTED_BY_AGENT',
        skillId: 'corvus-skillpack:blocked',
        details: expect.objectContaining({bundleRefs: ['corvus-skillpack:workflow']})
      })
    ]);
  });

  it('blocks a bundle when a transitive dependency does not support the target agent', async () => {
    const home = await newHome({
      skillpack: v3RelationshipFixture({
        skills: [
          {id: 'member', requires: ['foundation']},
          {id: 'foundation', supportedAgents: ['claude']}
        ],
        bundles: [{id: 'workflow', skills: ['member']}]
      })
    });
    await selectCodexBundles(home, ['corvus-skillpack:workflow']);

    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: []
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: 'SKILL_NOT_SUPPORTED_BY_AGENT',
      skillId: 'corvus-skillpack:foundation',
      details: {bundleRefs: ['corvus-skillpack:workflow']}
    });
  });

  it('detects bundle-vs-bundle and bundle-vs-explicit conflicts with bundle provenance', async () => {
    const fixture = v3RelationshipFixture({
      skills: [
        {id: 'alpha', conflictsWith: ['beta']},
        {id: 'beta'}
      ],
      bundles: [
        {id: 'alpha-flow', skills: ['alpha']},
        {id: 'beta-flow', skills: ['beta']}
      ]
    });
    const bundleHome = await newHome({skillpack: fixture});
    await selectCodexBundles(bundleHome, [
      'corvus-skillpack:alpha-flow',
      'corvus-skillpack:beta-flow'
    ]);
    const bundleConflict = await appFor(bundleHome).installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: []
    });

    expect(bundleConflict.ok).toBe(false);
    if (!bundleConflict.ok) {
      expect(bundleConflict.errors[0]).toMatchObject({
        code: 'SKILL_CONFLICT',
        details: {
          bundleRefs: ['corvus-skillpack:alpha-flow', 'corvus-skillpack:beta-flow']
        }
      });
    }

    const explicitHome = await newHome({skillpack: fixture});
    await selectCodexBundles(explicitHome, ['corvus-skillpack:alpha-flow']);
    const explicitConflict = await appFor(explicitHome).installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'beta'}]
    });

    expect(explicitConflict.ok).toBe(false);
    if (!explicitConflict.ok) {
      expect(explicitConflict.errors[0]).toMatchObject({
        code: 'SKILL_CONFLICT',
        details: {bundleRefs: ['corvus-skillpack:alpha-flow']}
      });
    }
  });

  it('reports recommendations from bundle-effective skills without selecting them', async () => {
    const home = await newHome({
      skillpack: v3RelationshipFixture({
        skills: [
          {id: 'member', recommends: ['optional']},
          {id: 'optional'}
        ],
        bundles: [{id: 'workflow', skills: ['member']}]
      })
    });
    await selectCodexBundles(home, ['corvus-skillpack:workflow']);

    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: []
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.plan.summary.recommendationsNotSelected).toEqual(['corvus-skillpack:optional']);
    expect(result.data.plan.operations.map((operation) => operation.skillId)).toEqual([
      'corvus-skillpack:member'
    ]);
    expect(result.warnings.some((warning) => warning.code === 'recommendation-not-selected')).toBe(true);
  });

  it('lists every removal in replacement mode', async () => {
    const home = await newHome({
      agents: {codex: {enabled: true, selectedSkillIds: ['git-commit']}}
    });
    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'test-driven-development'}],
      replaceSelection: true
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.plan.configChanges[0]?.selectedSkillIdsTo).toEqual(['corvus-skillpack:test-driven-development']);
      expect(
        result.data.plan.operations.filter((operation) => operation.type === 'remove-link').map((op) => op.skillId)
      ).toEqual(['corvus-skillpack:git-commit']);
      expect(result.data.plan.summary.removals).toBe(1);
    }
  });

  it('preserves selections belonging to agents outside the request', async () => {
    const home = await newHome({
      agents: {
        codex: {enabled: true, selectedSkillIds: ['git-commit']},
        claude: {enabled: true, selectedSkillIds: ['technical-documentation']}
      }
    });
    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'test-driven-development'}],
      replaceSelection: true
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.plan.configChanges.map((change) => change.agentId)).toEqual(['codex']);
    }
  });

  it('refuses to plan over an unmanaged target and persists no plan', async () => {
    const home = await newHome();
    const targetPath = path.join(codexTargetDir(home), 'git-commit');

    await fs.mkdir(path.dirname(targetPath), {recursive: true});
    await fs.writeFile(targetPath, 'not ours\n', 'utf8');

    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}]
    });

    expect(result.ok).toBe(false);
    expect(await listTree(home.plansDir)).toEqual([]);

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('UNMANAGED_TARGET_EXISTS');
      expect(result.errors[0]?.path).toBe(targetPath);
    }
  });

  it('blocks skills that declare a conflict with each other', async () => {
    const home = await newHome({
      skillpack: {
        registry: {
          version: 2,
          skills: [
            {
              id: 'alpha',
              path: 'skills/alpha',
              title: 'Alpha',
              description: 'Alpha skill.',
              supportedAgents: ['codex'],
              conflictsWith: ['beta']
            },
            {
              id: 'beta',
              path: 'skills/beta',
              title: 'Beta',
              description: 'Beta skill.',
              supportedAgents: ['codex']
            }
          ]
        },
        skills: [
          {relativePath: 'skills/alpha', frontmatter: {name: 'alpha', description: 'Alpha.'}, body: 'Body.'},
          {relativePath: 'skills/beta', frontmatter: {name: 'beta', description: 'Beta.'}, body: 'Body.'}
        ]
      }
    });
    const result = await appFor(home).installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'alpha'}, {id: 'beta'}]
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('SKILL_CONFLICT');
    }
  });
});

describe('install apply', () => {
  it('creates manager-owned links and records the selection in config', async () => {
    const home = await newHome();
    const app = appFor(home);
    const {planId, apply} = await planAndApply(app, {
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}]
    });

    expect(apply.ok).toBe(true);

    if (!apply.ok) {
      return;
    }

    const targetPath = path.join(codexTargetDir(home), 'git-commit');

    expect(apply.data.status).toBe('applied');
    expect(apply.changed).toBe(true);
    expect(apply.data.operations[0]).toMatchObject({status: 'applied', skillId: 'corvus-skillpack:git-commit'});
    expect((await fs.lstat(targetPath)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(targetPath, 'SKILL.md'), 'utf8')).toContain('git-commit');

    const config = JSON.parse(await fs.readFile(home.configPath, 'utf8')) as {
      version: number;
      agents?: Record<string, {enabled: boolean; selectedSkillIds: string[]; selectedBundleIds: string[]}>;
    };

    expect(config.version).toBe(3);
    expect(config.agents?.codex).toMatchObject({
      enabled: true,
      selectedSkillIds: ['corvus-skillpack:git-commit'],
      selectedBundleIds: []
    });

    const verify = await app.installVerify({planId});

    expect(verify.ok).toBe(true);

    if (verify.ok) {
      expect(verify.data.status).toBe('verified');
    }
  });

  it('installs for multiple agents in one apply', async () => {
    const home = await newHome();
    const {apply} = await planAndApply(appFor(home), {
      schemaVersion: 1,
      targetAgents: ['codex', 'claude'],
      selectedSkills: [{id: 'git-commit'}]
    });

    expect(apply.ok).toBe(true);

    if (apply.ok) {
      expect(apply.data.operations.map((operation) => operation.agentId)).toEqual(['claude', 'codex']);
    }

    expect((await fs.lstat(path.join(home.homeDir, '.claude', 'skills', 'git-commit'))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(codexTargetDir(home), 'git-commit'))).isSymbolicLink()).toBe(true);
  });

  it('is idempotent: a second apply is a structured no-op', async () => {
    const home = await newHome();
    const app = appFor(home);
    const {planId, apply} = await planAndApply(app, {
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}]
    });

    expect(apply.ok).toBe(true);

    const second = await app.installApply({planId, confirm: planId});

    expect(second.ok).toBe(true);

    if (second.ok) {
      expect(second.data.status).toBe('already-satisfied');
      expect(second.changed).toBe(false);
      expect(second.data.operations.every((operation) => operation.status === 'already-satisfied')).toBe(true);
    }
  });

  it('requires the confirmation token to match the plan id', async () => {
    const home = await newHome();
    const app = appFor(home);
    const plan = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}]
    });

    expect(plan.ok).toBe(true);

    if (!plan.ok || plan.data.planId === undefined) {
      return;
    }

    const result = await app.installApply({planId: plan.data.planId, confirm: 'nope'});

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('PLAN_CONFIRMATION_REQUIRED');
    }

    await expect(fs.lstat(path.join(codexTargetDir(home), 'git-commit'))).rejects.toThrow();
  });

  it('rejects an unknown plan id', async () => {
    const home = await newHome();
    const planId = `install-${'0'.repeat(32)}`;
    const result = await appFor(home).installApply({planId, confirm: planId});

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('PLAN_NOT_FOUND');
    }
  });

  it('rejects a plan id that tries to escape the plans directory', async () => {
    const home = await newHome();
    const result = await appFor(home).installApply({
      planId: '../../etc/passwd',
      confirm: '../../etc/passwd'
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('PLAN_NOT_FOUND');
    }
  });

  it('rejects a tampered plan file', async () => {
    const home = await newHome();
    const app = appFor(home);
    const plan = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}]
    });

    expect(plan.ok).toBe(true);

    if (!plan.ok || plan.data.planId === undefined || plan.data.planPath === undefined) {
      return;
    }

    const stored = JSON.parse(await fs.readFile(plan.data.planPath, 'utf8')) as {
      payload: {operations: Array<{targetPath: string}>};
    };
    const operation = stored.payload.operations[0];

    if (operation !== undefined) {
      operation.targetPath = path.join(home.homeDir, 'somewhere-else', 'git-commit');
    }

    await fs.writeFile(plan.data.planPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

    const result = await app.installApply({planId: plan.data.planId, confirm: plan.data.planId});

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('PLAN_DIGEST_MISMATCH');
    }
  });

  it('rejects a plan made against stale state', async () => {
    const home = await newHome();
    const app = appFor(home);
    const plan = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}]
    });

    expect(plan.ok).toBe(true);

    if (!plan.ok || plan.data.planId === undefined) {
      return;
    }

    // Another agent's selection lands first, changing config underneath the plan.
    const otherPlan = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'test-driven-development'}]
    });

    if (!otherPlan.ok || otherPlan.data.planId === undefined) {
      throw new Error('expected the second plan to succeed');
    }

    await app.installApply({planId: otherPlan.data.planId, confirm: otherPlan.data.planId});

    const result = await app.installApply({planId: plan.data.planId, confirm: plan.data.planId});

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('STALE_PLAN');
      expect(result.errors[0]?.details?.changedComponents).toContain('config');
      expect(result.nextActions.map((action) => action.code)).toContain('regenerate-plan');
    }
  });

  it('refuses to overwrite an unmanaged target that appears after planning', async () => {
    const home = await newHome();
    const app = appFor(home);
    const plan = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}, {id: 'test-driven-development'}]
    });

    expect(plan.ok).toBe(true);

    if (!plan.ok || plan.data.planId === undefined) {
      return;
    }

    const targetPath = path.join(codexTargetDir(home), 'git-commit');
    await fs.mkdir(path.dirname(targetPath), {recursive: true});
    await fs.writeFile(targetPath, 'not ours\n', 'utf8');

    const result = await app.installApply({planId: plan.data.planId, confirm: plan.data.planId});

    expect(result.ok).toBe(false);
    expect(await fs.readFile(targetPath, 'utf8')).toBe('not ours\n');

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('UNMANAGED_TARGET_EXISTS');
      expect(result.data.status).toBe('partially-applied');
      // The unaffected skill still lands, and config records only what actually linked.
      expect(
        (result.data.operations as Array<{skillId: string; status: string}>).find(
          (operation) => operation.skillId === 'corvus-skillpack:test-driven-development'
        )
      ).toMatchObject({status: 'applied'});
    }
  });

  it('needs explicit confirmation before replacing a broken managed link', async () => {
    const home = await newHome();
    const app = appFor(home);
    const {planId} = await planAndApply(app, {
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}]
    });
    const targetPath = path.join(codexTargetDir(home), 'git-commit');

    await fs.unlink(targetPath);
    await fs.symlink(path.join(home.homeDir, 'missing-source'), targetPath, 'dir');

    const withoutConfirmation = await app.installApply({planId, confirm: planId});

    expect(withoutConfirmation.ok).toBe(true);

    if (withoutConfirmation.ok) {
      expect(withoutConfirmation.data.operations[0]?.code).toBe('broken-managed-link-needs-confirmation');
      expect(withoutConfirmation.warnings[0]?.code).toBe('broken-managed-link-needs-confirmation');
    }

    const withConfirmation = await app.installApply({
      planId,
      confirm: planId,
      confirmReplaceBrokenManagedLinks: true
    });

    expect(withConfirmation.ok).toBe(true);

    if (withConfirmation.ok) {
      expect(withConfirmation.data.operations[0]?.status).toBe('applied');
    }
  });
});

describe('install verify', () => {
  it('is read-only', async () => {
    const home = await newHome();
    const app = appFor(home);
    const {planId} = await planAndApply(app, {
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}]
    });
    const before = await listTree(home.homeDir);

    await app.installVerify({planId});

    expect(await listTree(home.homeDir)).toEqual(before);
  });

  it('reports verified-no-op for a plan with nothing to do', async () => {
    const home = await newHome();
    const app = appFor(home);
    const plan = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['custom'],
      selectedSkills: [],
      agentTargetPaths: {custom: path.join(home.homeDir, 'custom-skills')}
    });

    if (!plan.ok || plan.data.planId === undefined) {
      throw new Error('expected plan to succeed');
    }

    await app.installApply({planId: plan.data.planId, confirm: plan.data.planId});

    const verify = await app.installVerify({planId: plan.data.planId});

    expect(verify.ok).toBe(true);

    if (verify.ok) {
      expect(['verified', 'verified-no-op']).toContain(verify.data.status);
    }
  });

  it('reports a partially applied plan when a link is missing', async () => {
    const home = await newHome();
    const app = appFor(home);
    const {planId} = await planAndApply(app, {
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}]
    });

    await fs.unlink(path.join(codexTargetDir(home), 'git-commit'));

    const verify = await app.installVerify({planId});

    expect(verify.ok).toBe(true);

    if (verify.ok) {
      expect(verify.data.status).toBe('partially-applied');
      expect(verify.data.checks.some((check) => check.code === 'missing-managed-link')).toBe(true);
      expect(verify.nextActions.map((action) => action.code)).toContain('reapply-plan');
    }
  });

  it('detects drift when a link points somewhere else', async () => {
    const home = await newHome();
    const app = appFor(home);
    const {planId} = await planAndApply(app, {
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}]
    });
    const targetPath = path.join(codexTargetDir(home), 'git-commit');
    const elsewhere = path.join(home.homeDir, 'elsewhere');

    await fs.mkdir(elsewhere, {recursive: true});
    await fs.unlink(targetPath);
    await fs.symlink(elsewhere, targetPath, 'dir');

    const verify = await app.installVerify({planId});

    expect(verify.ok).toBe(true);

    if (verify.ok) {
      expect(verify.data.status).toBe('drift-detected');
      expect(verify.nextActions.map((action) => action.code)).toContain('regenerate-plan');
    }
  });

  it('reports blocked when an expected target is not a link', async () => {
    const home = await newHome();
    const app = appFor(home);
    const {planId} = await planAndApply(app, {
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}]
    });
    const targetPath = path.join(codexTargetDir(home), 'git-commit');

    await fs.unlink(targetPath);
    await fs.writeFile(targetPath, 'not ours\n', 'utf8');

    const verify = await app.installVerify({planId});

    expect(verify.ok).toBe(true);

    if (verify.ok) {
      expect(verify.data.status).toBe('blocked');
    }
  });

  it('reports dependency installation', async () => {
    const home = await newHome();
    const app = appFor(home);
    const {planId} = await planAndApply(app, {
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'embedded-driver-development'}]
    });
    const verify = await app.installVerify({planId});

    expect(verify.ok).toBe(true);

    if (verify.ok) {
      expect(
        verify.data.checks.find((check) => check.kind === 'dependency' && check.skillId === 'corvus-skillpack:embedded-toolchain')
      ).toMatchObject({satisfied: true});
    }
  });
});
