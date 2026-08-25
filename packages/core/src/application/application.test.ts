import {promises as fs} from 'node:fs';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  type TestHome,
  assertNoMutatingGitCalls,
  createStubGit,
  createTestHome,
  listTree
} from '../../../../test/support/appHarness.js';
import {
  v2SkillpackFixture,
  v3BundleSkillpackFixture
} from '../../../../test/support/skillpackFixtures.js';
import {createCorvusApplication} from './createCorvusApplication.js';
import {machineCommands} from './protocol/envelope.js';
import {exitCodeForErrorCode} from './protocol/errors.js';
import {toMachineEnvelope} from './protocol/result.js';
import {commandCapabilities} from './useCases/capabilitiesUseCase.js';

const homes: TestHome[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map(async (home) => home.cleanup()));
});

async function newHome(options: Parameters<typeof createTestHome>[0] = {}): Promise<TestHome> {
  const home = await createTestHome(options);
  homes.push(home);
  return home;
}

function appFor(home: TestHome, git = createStubGit({commitHash: home.commitHash}).runner) {
  return createCorvusApplication({homeDir: home.homeDir, git, now: () => new Date('2025-01-01T00:00:00.000Z')});
}

describe('capabilities', () => {
  it('describes the binary without any skillpack being configured', async () => {
    const home = await newHome();
    const before = await listTree(home.homeDir);
    const result = appFor(home).capabilities();

    expect(result.ok).toBe(true);
    expect(await listTree(home.homeDir)).toEqual(before);

    if (!result.ok) {
      return;
    }

    expect(result.data.protocol.schemaVersion).toBe(1);
    expect(result.data.registry.supportedVersions).toEqual([1, 2, 3]);
    expect(result.data.paths.managerStateDir).toBe(home.managerStateDir);
    expect(result.nextActions.map((action) => action.code)).toEqual([
      'run-status',
      'run-skillpack-setup-plan',
      'search-skills',
      'search-bundles',
      'plan-install'
    ]);
    expect(result.data.bundles).toEqual({
      referenceFormat: '<skillpack-id>:<bundle-id>',
      discoveryCommands: ['bundles.list', 'bundles.search', 'bundles.inspect'],
      installRequestField: 'selectedBundles',
      installFlag: '--bundle <id>',
      membersAreSkillsOnly: true,
      allCompatibleIncludesBundles: false
    });
    expect(result.data.protocol.errorCodes).toEqual(
      expect.arrayContaining([
        'BUNDLE_NOT_FOUND',
        'BUNDLE_NOT_SUPPORTED_BY_AGENT',
        'BUNDLE_MEMBER_MISMATCH',
        'VERSION_MISMATCH'
      ])
    );
  });

  it('advertises every machine command exactly once with a read/write classification', async () => {
    const home = await newHome();
    const result = appFor(home).capabilities();

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.data.commands.map((command) => command.command).sort()).toEqual([...machineCommands].sort());
    expect(new Set(result.data.commands.map((command) => command.command)).size).toBe(machineCommands.length);

    for (const command of result.data.commands) {
      expect(['read-only', 'write']).toContain(command.mode);
      expect(command.mode === 'write' ? command.requiresConfirmation : true).toBe(true);
    }

    expect(result.data.commands.find((command) => command.command === 'install.plan')?.options).toContainEqual(
      expect.objectContaining({flag: '--bundle <id>', repeatable: true})
    );
  });

  it('derives supported agents from the adapter registry', async () => {
    const home = await newHome();
    const result = appFor(home).capabilities();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.agents.map((agent) => agent.id)).toEqual([
        'codex',
        'claude',
        'copilot',
        'opencode',
        'pi',
        'custom',
        'gemini'
      ]);
    }
  });

  it('is deterministic across calls', async () => {
    const home = await newHome();
    const app = appFor(home);

    expect(toMachineEnvelope('capabilities', app.capabilities())).toEqual(
      toMachineEnvelope('capabilities', app.capabilities())
    );
  });
});

describe('read-only commands', () => {
  it('reports missing config structurally without creating anything', async () => {
    const home = await newHome();
    const before = await listTree(home.homeDir);
    const app = appFor(home);
    const status = await app.status();
    const doctor = await app.doctor();
    const agents = await app.listAgents();
    const skillpack = await app.skillpackStatus();

    expect(status.ok).toBe(true);
    expect(doctor.ok).toBe(true);
    expect(agents.ok).toBe(true);
    expect(skillpack.ok).toBe(true);
    expect(await listTree(home.homeDir)).toEqual(before);

    if (status.ok) {
      expect(status.data.report.configExists).toBe(false);
      expect(status.warnings.map((warning) => warning.code)).toContain('config-not-found');
      expect(status.nextActions[0]?.code).toBe('run-skillpack-setup-plan');
    }

    if (skillpack.ok) {
      expect(skillpack.data.configured).toBe(false);
    }
  });

  it('reports an invalid config without throwing', async () => {
    const home = await newHome({writeConfig: false});
    await fs.mkdir(home.managerStateDir, {recursive: true});
    await fs.writeFile(home.configPath, '{"version": 99}\n', 'utf8');

    const status = await appFor(home).status();

    expect(status.ok).toBe(true);

    if (status.ok) {
      expect(status.data.report.configValid).toBe(false);
      expect(status.warnings.map((warning) => warning.code)).toContain('config-invalid');
    }
  });

  it('lists agents deterministically with target and selection details', async () => {
    const home = await newHome({
      skillpack: v2SkillpackFixture,
      agents: {codex: {enabled: true, selectedSkillIds: ['git-commit', 'embedded-testing']}}
    });
    const result = await appFor(home).listAgents();

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    const codex = result.data.agents.find((agent) => agent.id === 'codex');

    expect(result.data.agents.map((agent) => agent.id)).toEqual([
      'codex',
      'claude',
      'copilot',
      'opencode',
      'pi',
      'custom',
      'gemini'
    ]);
    expect(codex).toMatchObject({
      enabled: true,
      defaultTargetPath: '~/.agents/skills',
      effectiveTargetPath: '~/.agents/skills',
      selectedSkillIds: ['corvus-skillpack:embedded-testing', 'corvus-skillpack:git-commit']
    });
  });

  it('never runs a mutating git command', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const stubGit = createStubGit({commitHash: home.commitHash});
    const app = appFor(home, stubGit.runner);

    await app.status({checkRemote: true});
    await app.doctor({checkRemote: true});
    await app.skillpackUpdateCheck();

    assertNoMutatingGitCalls(stubGit);
  });
});

describe('skills catalog', () => {
  it('requires a ready skillpack', async () => {
    const home = await newHome();
    const result = await appFor(home).listSkills();

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('CONFIG_NOT_FOUND');
      expect(exitCodeForErrorCode('CONFIG_NOT_FOUND')).toBe(3);
    }
  });

  it('lists skills and filters by agent compatibility', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const app = appFor(home);
    const all = await app.listSkills();
    const geminiOnly = await app.listSkills({agentIds: ['gemini']});

    expect(all.ok && geminiOnly.ok).toBe(true);

    if (!all.ok || !geminiOnly.ok) {
      return;
    }

    expect(all.data.registryVersion).toBe(2);
    expect(all.data.skillCount).toBe(8);
    // Listing preserves registry order, which is deterministic for a given snapshot.
    expect(geminiOnly.data.skills.map((skill) => skill.id)).toEqual([
      'embedded-toolchain',
      'git-commit',
      'test-driven-development'
    ]);
    expect(geminiOnly.data.skills[0]?.compatibility).toEqual([{agentId: 'gemini', supported: true}]);
  });

  it('rejects an unknown agent filter', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const result = await appFor(home).listSkills({agentIds: ['nope']});

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('UNKNOWN_AGENT');
    }
  });
});

describe('deterministic search', () => {
  it('ranks embedded skills for an embedded-development query and explains the match', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const result = await appFor(home).searchSkills({query: 'embedded firmware c cpp cmake stm32 debugging'});

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.data.results[0]?.id).toBe('embedded-driver-development');
    expect(result.data.results.slice(0, 3).map((entry) => entry.id)).toEqual([
      'embedded-driver-development',
      'embedded-toolchain',
      'embedded-testing'
    ]);
    expect(result.data.results[0]?.matchedFields).toContain('domains');
    expect(result.data.results[0]?.matchedTerms).toContain('stm32');
    expect(result.data.results.every((entry) => entry.score > 0)).toBe(true);
  });

  it('ranks web skills for a React/Node query', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const result = await appFor(home).searchSkills({query: 'react node typescript web frontend api'});

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.results.slice(0, 2).map((entry) => entry.id).sort()).toEqual([
        'node-api-development',
        'react-component-design'
      ]);
    }
  });

  it('ranks testing and documentation queries to their own domains', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const app = appFor(home);
    const testing = await app.searchSkills({query: 'testing'});
    const documentation = await app.searchSkills({query: 'documentation'});

    expect(testing.ok && documentation.ok).toBe(true);

    if (!testing.ok || !documentation.ok) {
      return;
    }

    // Both testing skills match the `testing` domain and task; `embedded-testing` additionally
    // matches on id and title, so it ranks first. The calling agent still picks the exact ids.
    expect(testing.data.results.slice(0, 2).map((entry) => entry.id)).toEqual([
      'embedded-testing',
      'test-driven-development'
    ]);
    expect(documentation.data.results[0]?.id).toBe('technical-documentation');
  });

  it('demotes a skill whose nonGoals mention the query', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const result = await appFor(home).searchSkills({query: 'web application development'});

    expect(result.ok).toBe(true);

    if (result.ok) {
      const driver = result.data.results.find((entry) => entry.id === 'embedded-driver-development');
      expect(driver?.matches.some((match) => match.field === 'nonGoals' && match.weight < 0)).toBe(true);
    }
  });

  it('returns byte-stable results for repeated searches', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const app = appFor(home);
    const first = await app.searchSkills({query: 'embedded'});
    const second = await app.searchSkills({query: 'embedded'});

    expect(JSON.stringify(toMachineEnvelope('skills.search', first))).toBe(
      JSON.stringify(toMachineEnvelope('skills.search', second))
    );
  });

  it('breaks score ties by skill id', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const result = await appFor(home).searchSkills({query: 'code-review'});

    expect(result.ok).toBe(true);

    if (result.ok) {
      const topScore = result.data.results[0]?.score;
      const tied = result.data.results.filter((entry) => entry.score === topScore).map((entry) => entry.id);

      expect(tied).toEqual([...tied].sort());
    }
  });

  it('filters search by agent compatibility', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const result = await appFor(home).searchSkills({query: 'embedded', agentIds: ['gemini']});

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.results.map((entry) => entry.id)).toEqual(['embedded-toolchain']);
    }
  });

  it('rejects an empty query and unreasonable limits', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const app = appFor(home);

    for (const options of [
      {query: '   '},
      {query: 'embedded', limit: 0},
      {query: 'embedded', limit: 1000},
      {query: 'embedded', limit: 1.5}
    ]) {
      const result = await app.searchSkills(options);

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.errors[0]?.code).toBe('INVALID_REQUEST');
      }
    }
  });

  it('honours a bounded limit', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const result = await appFor(home).searchSkills({query: 'embedded', limit: 1});

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.results).toHaveLength(1);
      expect(result.data.totalMatches).toBeGreaterThan(1);
    }
  });
});

describe('skills inspect', () => {
  it('returns full metadata and only returns content when opted in', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const app = appFor(home);
    const withoutContent = await app.inspectSkills({skillIds: ['embedded-driver-development']});
    const withContent = await app.inspectSkills({
      skillIds: ['embedded-driver-development'],
      includeContent: true
    });

    expect(withoutContent.ok && withContent.ok).toBe(true);

    if (!withoutContent.ok || !withContent.ok) {
      return;
    }

    expect(withoutContent.data.skills[0]?.content).toBeUndefined();
    expect(withContent.data.skills[0]?.content).toContain('embedded-driver-development');
    expect(withoutContent.data.skills[0]?.requires).toEqual(['corvus-skillpack:embedded-toolchain']);
  });

  it('reports unknown skill ids', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const result = await appFor(home).inspectSkills({skillIds: ['ghost']});

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('SKILL_NOT_FOUND');
    }
  });
});

describe('bundle catalog', () => {
  it('lists and filters bundles by whole-bundle agent compatibility without writing', async () => {
    const home = await newHome({skillpack: v3BundleSkillpackFixture});
    const before = await listTree(home.homeDir);
    const app = appFor(home);
    const all = await app.listBundles();
    const claude = await app.listBundles({agentIds: ['claude']});

    expect(await listTree(home.homeDir)).toEqual(before);
    expect(all.ok && claude.ok).toBe(true);
    if (!all.ok || !claude.ok) return;

    expect(all.data.totalBundles).toBe(2);
    expect(all.data.bundles.map((bundle) => bundle.ref)).toEqual([
      'corvus-skillpack:default',
      'corvus-skillpack:documentation'
    ]);
    expect(all.data.bundles[0]?.supportedAgents).toEqual(['codex']);
    expect(claude.data.bundles.map((bundle) => bundle.id)).toEqual(['documentation']);
    expect(claude.data.bundles[0]?.compatibility).toEqual([
      {agentId: 'claude', compatible: true, issues: []}
    ]);
  });

  it('searches bundle metadata separately with stable bounded results', async () => {
    const home = await newHome({skillpack: v3BundleSkillpackFixture});
    const before = await listTree(home.homeDir);
    const app = appFor(home);
    const first = await app.searchBundles({query: 'review quality pull request', limit: 1});
    const second = await app.searchBundles({query: 'review quality pull request', limit: 1});

    expect(await listTree(home.homeDir)).toEqual(before);
    expect(first.ok && second.ok).toBe(true);
    expect(second).toEqual(first);
    if (!first.ok) return;

    expect(first.data.totalMatches).toBe(1);
    expect(first.data.results).toHaveLength(1);
    expect(first.data.results[0]).toMatchObject({
      id: 'default',
      ref: 'corvus-skillpack:default',
      matchedFields: expect.arrayContaining(['keywords', 'tags']),
      matchedTerms: expect.arrayContaining(['quality', 'review'])
    });
  });

  it('inspects constraints, actual versions, and explainable all-agent compatibility', async () => {
    const home = await newHome({skillpack: v3BundleSkillpackFixture});
    const before = await listTree(home.homeDir);
    const result = await appFor(home).inspectBundles({bundleIds: ['default']});

    expect(await listTree(home.homeDir)).toEqual(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const bundle = result.data.bundles[0];
    expect(bundle).toMatchObject({
      id: 'default',
      version: '1.2.0',
      supportedAgents: ['codex'],
      members: [
        {
          id: 'review-helper',
          ref: 'corvus-skillpack:review-helper',
          versionRange: '~2.1.0',
          actualVersion: '2.1.0'
        },
        {
          id: 'test-helper',
          ref: 'corvus-skillpack:test-helper',
          versionRange: '>=3.0.0-beta.1 <4.0.0',
          actualVersion: '3.0.0-beta.1'
        }
      ]
    });
    expect(bundle?.compatibility.find((entry) => entry.agentId === 'claude')).toMatchObject({
      compatible: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: 'bundle-dependency-unsupported',
          memberId: 'corvus-skillpack:review-helper',
          skillId: 'corvus-skillpack:git-basics'
        }),
        expect.objectContaining({
          code: 'bundle-member-unsupported',
          memberId: 'corvus-skillpack:test-helper'
        })
      ])
    });
  });

  it('rejects unknown bundles, invalid agents, empty queries, and unreasonable limits', async () => {
    const home = await newHome({skillpack: v3BundleSkillpackFixture});
    const app = appFor(home);
    const missing = await app.inspectBundles({bundleIds: ['ghost']});
    const agent = await app.listBundles({agentIds: ['ghost']});
    const empty = await app.searchBundles({query: '   '});
    const limit = await app.searchBundles({query: 'review', limit: 101});

    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.code).toBe('BUNDLE_NOT_FOUND');
    expect(agent.ok).toBe(false);
    if (!agent.ok) expect(agent.errors[0]?.code).toBe('UNKNOWN_AGENT');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors[0]?.code).toBe('INVALID_REQUEST');
    expect(limit.ok).toBe(false);
    if (!limit.ok) expect(limit.errors[0]?.code).toBe('INVALID_REQUEST');
  });
});

describe('validate-registry', () => {
  it('reports coverage and writes nothing', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const before = await listTree(home.homeDir);
    const result = await appFor(home).validateRegistry();

    expect(await listTree(home.homeDir)).toEqual(before);
    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.data.valid).toBe(true);
    expect(result.data.registryVersion).toBe(2);
    expect(result.data.versionedSkillCount).toBe(0);
    expect(result.data.bundleCount).toBe(0);
    expect(result.data.validBundleMembershipCount).toBe(0);
    expect(result.data.requiredDependencyCycles).toEqual([]);
    expect(result.data.skillsMissingSemanticMetadata).toEqual([]);
    expect(result.data.coverage.find((entry) => entry.field === 'domains')).toEqual({
      field: 'domains',
      skillsWithValues: 8,
      totalSkills: 8,
      percent: 100
    });
  });

  it('reports invalid entries and unknown relationship targets', async () => {
    const home = await newHome({
      skillpack: {
        registry: {
          version: 2,
          skills: [
            {
              id: 'needs-ghost',
              path: 'skills/needs-ghost',
              title: 'Needs Ghost',
              description: 'Requires a missing skill.',
              supportedAgents: ['codex'],
              requires: ['ghost']
            }
          ]
        },
        skills: [
          {
            relativePath: 'skills/needs-ghost',
            frontmatter: {name: 'needs-ghost', description: 'Needs.'},
            body: 'Body.'
          }
        ]
      }
    });
    const result = await appFor(home).validateRegistry();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.valid).toBe(false);
      expect(result.data.unknownRelationshipTargets.map((issue) => issue.code)).toEqual([
        'unknown-required-skill'
      ]);
      expect(result.data.skillsMissingSemanticMetadata).toEqual(['needs-ghost']);
    }
  });

  it('reports stable v3 version and bundle diagnostics with counts and no writes', async () => {
    const home = await newHome({
      skillpack: {
        registry: {
          version: 3,
          skills: [
            {
              id: 'consumer',
              version: '2.0.0',
              path: 'skills/consumer',
              title: 'Consumer',
              description: 'Consumes a library.',
              supportedAgents: ['codex'],
              requires: [{id: 'library', version: '^2.0.0'}]
            },
            {
              id: 'library',
              version: '1.5.0',
              path: 'skills/library',
              title: 'Library',
              description: 'A library.',
              supportedAgents: ['codex']
            },
            {
              id: 'unversioned',
              path: 'skills/unversioned',
              title: 'Unversioned',
              description: 'Missing its v3 version.',
              supportedAgents: ['codex']
            },
            {
              id: 'bad-skill-version',
              version: 'v1.0.0',
              path: 'skills/bad-skill-version',
              title: 'Bad Skill Version',
              description: 'Has a malformed v3 version.',
              supportedAgents: ['codex']
            }
          ],
          bundles: [
            {
              id: 'valid',
              version: '1.0.0',
              title: 'Valid',
              description: 'A valid composition.',
              skills: [{id: 'library', version: '^1.0.0'}]
            },
            {
              id: 'missing-member',
              version: '1.0.0',
              title: 'Missing Member',
              description: 'References an unknown skill.',
              skills: [{id: 'ghost', version: '^1.0.0'}]
            },
            {
              id: 'mismatch',
              version: '1.0.0',
              title: 'Mismatch',
              description: 'Has an unsatisfied member range.',
              skills: [{id: 'consumer', version: '^3.0.0'}]
            },
            {
              id: 'bad-version',
              version: 'v1.0.0',
              title: 'Bad Version',
              description: 'Has a malformed version.',
              skills: [{id: 'library', version: '^1.0.0'}]
            }
          ]
        },
        skills: [
          {
            relativePath: 'skills/consumer',
            frontmatter: {name: 'consumer', description: 'Consumer.'},
            body: 'Body.'
          },
          {
            relativePath: 'skills/library',
            frontmatter: {name: 'library', description: 'Library.'},
            body: 'Body.'
          }
        ]
      }
    });
    const before = await listTree(home.homeDir);
    const result = await appFor(home).validateRegistry();

    expect(await listTree(home.homeDir)).toEqual(before);
    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.data).toMatchObject({
      valid: false,
      registryVersion: 3,
      supportedRegistryVersions: [1, 2, 3],
      currentRegistryVersion: 3,
      skillCount: 4,
      versionedSkillCount: 2,
      bundleCount: 4,
      validBundleMembershipCount: 1
    });
    expect(result.data.invalidEntries.map((issue) => issue.code)).toEqual([
      'missing-skill-version',
      'invalid-skill-version',
      'invalid-bundle-version',
      'required-skill-version-mismatch',
      'bundle-member-version-mismatch',
      'unknown-bundle-member'
    ]);
    expect(
      result.data.invalidEntries.find((issue) => issue.code === 'bundle-member-version-mismatch')
    ).toMatchObject({
      bundleId: 'mismatch',
      memberId: 'consumer',
      versionRange: '^3.0.0',
      actualVersion: '2.0.0'
    });
  });
});

describe('plan artifacts', () => {
  it('stores plans only inside the manager plans directory', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const app = appFor(home);
    const plan = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}]
    });

    expect(plan.ok).toBe(true);

    if (!plan.ok || plan.data.planPath === undefined) {
      return;
    }

    expect(path.dirname(plan.data.planPath)).toBe(home.plansDir);
    expect(plan.data.planId).toMatch(/^install-[a-f0-9]{32}$/);
    expect(plan.data.planId?.endsWith(plan.data.digest?.slice(0, 32) ?? '')).toBe(true);
  });

  it('produces the same digest for equivalent requests and state', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const app = appFor(home);
    const first = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}, {id: 'test-driven-development'}]
    });
    const second = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex', 'codex'],
      selectedSkills: [{id: 'test-driven-development'}, {id: 'git-commit'}]
    });

    expect(first.ok && second.ok).toBe(true);

    if (first.ok && second.ok) {
      expect(first.data.digest).toBe(second.data.digest);
      expect(first.data.planId).toBe(second.data.planId);
    }
  });
});

describe('command surface coverage', () => {
  it('keeps capability metadata aligned with the protocol command list', () => {
    expect(commandCapabilities.map((command) => command.command).sort()).toEqual([...machineCommands].sort());
  });
});
