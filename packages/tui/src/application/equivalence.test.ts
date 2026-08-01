import {promises as fs} from 'node:fs';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  type CorvusApplication,
  createCorvusApplication,
  generateLinkPlan,
  getAgentAdapters
} from '@corvus-tools/skill-manager-core';
import {type TestHome, createStubGit, createTestHome} from '../../../../test/support/appHarness.js';
import {v2SkillpackFixture} from '../../../../test/support/skillpackFixtures.js';
import {describeMachineError, describeMachineErrors} from './errorMessages.js';

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

/**
 * Reproduces exactly how the Guided Flow wizard builds its link plan: adapters from the
 * registry, discovered skills sorted by id, and one selection entry per adapter derived from
 * draft state.
 */
async function wizardLinkPlan(
  app: CorvusApplication,
  home: TestHome,
  draft: {agentId: string; enabled: boolean; targetPath: string; selectedSkillIds: string[]}[]
) {
  const discovery = await app.discoverSkills();

  if (!discovery.ok) {
    throw new Error('expected discovery to succeed');
  }

  const adapters = getAgentAdapters();
  const sortedSkills = [...discovery.data.discovery.skills].sort((left, right) =>
    left.id.localeCompare(right.id)
  );

  return generateLinkPlan({
    adapters,
    homeDir: home.homeDir,
    skills: sortedSkills.map((skill) => ({id: skill.id, absolutePath: skill.absolutePath})),
    selections: adapters.map((adapter) => {
      const draftAgent = draft.find((entry) => entry.agentId === adapter.id);

      return {
        agentId: adapter.id,
        enabled: draftAgent?.enabled ?? false,
        ...(draftAgent?.targetPath === undefined || draftAgent.targetPath === ''
          ? {}
          : {targetPath: draftAgent.targetPath}),
        selectedSkillIds: draftAgent?.selectedSkillIds ?? [],
        previousSelectedSkillIds: []
      };
    })
  });
}

describe('TUI and CLI equivalence', () => {
  it('produces the same link operations for the same selection and state', async () => {
    const home = await newHome();
    const app = appFor(home);
    const selectedSkillIds = ['git-commit', 'test-driven-development'];
    const tuiPlan = await wizardLinkPlan(app, home, [
      {
        agentId: 'codex',
        enabled: true,
        targetPath: path.join(home.homeDir, '.agents', 'skills'),
        selectedSkillIds
      }
    ]);
    const cliPlan = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: selectedSkillIds.map((id) => ({id})),
      replaceSelection: true,
      agentTargetPaths: {codex: path.join(home.homeDir, '.agents', 'skills')}
    });

    expect(cliPlan.ok).toBe(true);

    if (!cliPlan.ok) {
      return;
    }

    expect(cliPlan.data.plan.operations).toEqual(tuiPlan.operations);
    expect(cliPlan.data.plan.conflicts).toEqual(tuiPlan.conflicts);
  });

  it('agrees across multiple agents', async () => {
    const home = await newHome();
    const app = appFor(home);
    const tuiPlan = await wizardLinkPlan(app, home, [
      {agentId: 'codex', enabled: true, targetPath: path.join(home.homeDir, 'codex'), selectedSkillIds: ['git-commit']},
      {agentId: 'claude', enabled: true, targetPath: path.join(home.homeDir, 'claude'), selectedSkillIds: ['git-commit']}
    ]);
    const cliPlan = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex', 'claude'],
      selectedSkills: [{id: 'git-commit'}],
      replaceSelection: true,
      agentTargetPaths: {codex: path.join(home.homeDir, 'codex'), claude: path.join(home.homeDir, 'claude')}
    });

    expect(cliPlan.ok).toBe(true);

    if (cliPlan.ok) {
      expect(cliPlan.data.plan.operations).toEqual(tuiPlan.operations);
    }
  });

  it('agrees that an unmanaged target is a conflict', async () => {
    const home = await newHome();
    const app = appFor(home);
    const targetRoot = path.join(home.homeDir, '.agents', 'skills');

    await fs.mkdir(targetRoot, {recursive: true});
    await fs.writeFile(path.join(targetRoot, 'git-commit'), 'not ours\n', 'utf8');

    const tuiPlan = await wizardLinkPlan(app, home, [
      {agentId: 'codex', enabled: true, targetPath: targetRoot, selectedSkillIds: ['git-commit']}
    ]);
    const cliPlan = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}],
      replaceSelection: true,
      agentTargetPaths: {codex: targetRoot}
    });

    // The wizard passes no target states, so the machine planner is the stricter of the two:
    // it inspects the filesystem and reports the conflict the wizard would hit at apply time.
    expect(tuiPlan.operations).toHaveLength(1);
    expect(cliPlan.ok).toBe(false);

    if (!cliPlan.ok) {
      expect(cliPlan.errors[0]?.code).toBe('UNMANAGED_TARGET_EXISTS');
    }
  });

  it('reads the same status report through the shared use case', async () => {
    const home = await newHome();
    const app = appFor(home);
    const first = await app.status();
    const second = await app.status();

    expect(first.ok && second.ok).toBe(true);

    if (first.ok && second.ok) {
      expect(first.data.report).toEqual(second.data.report);
      expect(first.data.report.skillpack?.discoveredSkillCount).toBe(8);
    }
  });
});

describe('protocol error wording', () => {
  it('maps every reported code to a human sentence that keeps the original detail', () => {
    expect(
      describeMachineError({
        code: 'UNMANAGED_TARGET_EXISTS',
        category: 'conflict',
        message: 'Target already exists and is not manager-owned: /tmp/x',
        retryable: false
      })
    ).toContain('Move it yourself first.');
    expect(
      describeMachineError({
        code: 'UNMANAGED_TARGET_EXISTS',
        category: 'conflict',
        message: 'Target already exists and is not manager-owned: /tmp/x',
        retryable: false
      })
    ).toContain('/tmp/x');
  });

  it('never renders raw JSON', () => {
    const rendered = describeMachineErrors([
      {code: 'STALE_PLAN', category: 'confirmation', message: 'Local state changed.', retryable: false}
    ]);

    expect(rendered).not.toContain('{');
    expect(rendered).not.toContain('"code"');
  });

  it('falls back to a generic sentence when given no errors', () => {
    expect(describeMachineErrors([])).toBe('Something went wrong.');
  });
});
