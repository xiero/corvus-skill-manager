import {promises as fs} from 'node:fs';
import path from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {createTestHome, createStubGit, type TestHome} from '../../../../test/support/appHarness.js';
import {
  type SkillpackFixture,
  v2SkillpackFixture,
  v3BundleSkillpackFixture,
  writeSkillpack
} from '../../../../test/support/skillpackFixtures.js';
import {loadConfig, saveConfig} from '../config/configStore.js';
import {createCorvusApplication} from './createCorvusApplication.js';

describe('multiple skillpacks', () => {
  let home: TestHome | undefined;

  afterEach(async () => home?.cleanup());

  test('aggregates qualified catalog entries and installs from a secondary repository', async () => {
    home = await createTestHome({skillpack: v2SkillpackFixture});
    const secondary = await addSecondarySkillpack(home, secondaryFixture());
    const app = createCorvusApplication({
      homeDir: home.homeDir,
      configPath: home.configPath,
      git: createStubGit().runner,
      now: () => new Date('2026-08-16T08:00:00.000Z')
    });

    const list = await app.listSkills();
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({id: 'private-review', skillpackId: 'team-pack', ref: 'team-pack:private-review'})
      ])
    );

    const plan = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'team-pack:private-review'}]
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok || plan.data.planId === undefined) return;
    expect(plan.data.plan.operations).toContainEqual(
      expect.objectContaining({
        skillId: 'team-pack:private-review',
        sourcePath: path.join(secondary.checkoutPath, 'skills', 'private-review'),
        targetPath: path.join(home.homeDir, '.agents', 'skills', 'private-review')
      })
    );

    const applied = await app.installApply({planId: plan.data.planId, confirm: plan.data.planId});
    expect(applied.ok).toBe(true);
    expect((await loadConfig(home.configPath)).agents?.codex?.selectedSkillIds).toEqual(['team-pack:private-review']);
    const verified = await app.installVerify({planId: plan.data.planId});
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.data.status).toBe('verified');
  });

  test('blocks same-name targets and allCompatible when a configured pack is unavailable', async () => {
    home = await createTestHome({skillpack: v2SkillpackFixture});
    await addSecondarySkillpack(home, secondaryFixture(true));
    const config = await loadConfig(home.configPath);
    await saveConfig(
      {
        ...config,
        skillpacks: {
          ...(config.skillpacks ?? {}),
          broken: {
            id: 'broken',
            repositoryUrl: 'https://example.invalid/broken.git',
            branch: 'main',
            checkoutPath: path.join(home.homeDir, '.agents', 'skillpacks', 'broken', 'current')
          }
        }
      },
      {configPath: home.configPath}
    );
    const app = createCorvusApplication({homeDir: home.homeDir, configPath: home.configPath, git: createStubGit().runner});

    const collision = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'git-commit'}, {id: 'team-pack:git-commit'}]
    });
    expect(collision.ok).toBe(false);
    if (!collision.ok) expect(collision.errors[0]?.code).toBe('SKILL_TARGET_NAME_CONFLICT');

    const explicit = await app.installPlan({
      schemaVersion: 1,
      targetAgents: ['codex'],
      selectedSkills: [{id: 'team-pack:private-review'}]
    });
    expect(explicit.ok).toBe(true);

    const all = await app.installPlan({schemaVersion: 1, targetAgents: ['codex'], allCompatible: true});
    expect(all.ok).toBe(false);
    if (!all.ok) expect(all.errors[0]?.code).toBe('SKILLPACK_NOT_READY');
  });

  test('removes only an unused secondary registration and preserves its snapshots', async () => {
    home = await createTestHome({skillpack: v2SkillpackFixture});
    const secondary = await addSecondarySkillpack(home, secondaryFixture());
    const app = createCorvusApplication({
      homeDir: home.homeDir,
      configPath: home.configPath,
      git: createStubGit().runner,
      now: () => new Date('2026-08-16T08:00:00.000Z')
    });

    const protectedDefault = await app.skillpackRemovePlan({skillpackId: 'corvus-skillpack'});
    expect(protectedDefault.ok).toBe(false);

    const plan = await app.skillpackRemovePlan({skillpackId: 'team-pack'});
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const unconfirmed = await app.skillpackRemoveApply({planId: plan.data.planId, confirm: 'wrong'});
    expect(unconfirmed.ok).toBe(false);
    if (!unconfirmed.ok) {
      expect(unconfirmed.errors[0]?.code).toBe('PLAN_CONFIRMATION_REQUIRED');
      expect(unconfirmed.nextActions[0]?.command).toContain('skillpack remove-apply');
    }
    const apply = await app.skillpackRemoveApply({planId: plan.data.planId, confirm: plan.data.planId});
    expect(apply.ok).toBe(true);
    expect((await loadConfig(home.configPath)).skillpacks?.['team-pack']).toBeUndefined();
    expect((await fs.lstat(secondary.checkoutPath)).isSymbolicLink()).toBe(true);
    expect((await fs.stat(secondary.revisionPath)).isDirectory()).toBe(true);
  });

  test('qualifies identical local bundle ids and their members by owning skillpack', async () => {
    home = await createTestHome({skillpack: v3BundleSkillpackFixture});
    await addSecondarySkillpack(home, v3BundleSkillpackFixture);
    const app = createCorvusApplication({
      homeDir: home.homeDir,
      configPath: home.configPath,
      git: createStubGit().runner
    });

    const discovery = await app.discoverSkills();
    const list = await app.listBundles();

    expect(discovery.ok && list.ok).toBe(true);
    if (!discovery.ok || !list.ok) return;

    const defaults = discovery.data.discovery.bundles.filter((bundle) => bundle.id === 'default');
    const reviewHelpers = discovery.data.discovery.skills.filter((skill) => skill.id === 'review-helper');
    expect(reviewHelpers.map((skill) => skill.ref)).toEqual([
      'corvus-skillpack:review-helper',
      'team-pack:review-helper'
    ]);
    expect(defaults.map((bundle) => bundle.ref)).toEqual([
      'corvus-skillpack:default',
      'team-pack:default'
    ]);
    expect(defaults[0]?.members.every((member) => member.ref?.startsWith('corvus-skillpack:'))).toBe(true);
    expect(defaults[1]?.members.every((member) => member.ref?.startsWith('team-pack:'))).toBe(true);
    expect(list.data.bundles.filter((bundle) => bundle.id === 'default').map((bundle) => bundle.ref)).toEqual([
      'corvus-skillpack:default',
      'team-pack:default'
    ]);
  });
});

function secondaryFixture(includeCollision = false) {
  const ids = ['private-review', ...(includeCollision ? ['git-commit'] : [])];
  return {
    registry: {
      version: 1,
      skills: ids.map((id) => ({
        id,
        path: `skills/${id}`,
        title: id,
        description: `Secondary ${id} skill`,
        supportedAgents: ['codex'],
        tags: ['secondary']
      }))
    },
    skills: ids.map((id) => ({
      relativePath: `skills/${id}`,
      frontmatter: {name: id, description: `Secondary ${id} skill`},
      body: `# ${id}`
    }))
  };
}

async function addSecondarySkillpack(home: TestHome, fixture: SkillpackFixture) {
  const commit = 'b'.repeat(40);
  const root = path.join(home.homeDir, '.agents', 'skillpacks', 'team-pack');
  const checkoutPath = path.join(root, 'current');
  const revisionPath = path.join(root, 'revisions', commit, 'repo');
  await writeSkillpack(revisionPath, fixture);
  await fs.mkdir(root, {recursive: true});
  await fs.symlink(path.relative(root, revisionPath), checkoutPath, 'dir');

  const config = await loadConfig(home.configPath);
  await saveConfig(
    {
      ...config,
      skillpacks: {
        ...(config.skillpacks ?? {}),
        'team-pack': {
          id: 'team-pack',
          repositoryUrl: 'https://example.com/team-pack.git',
          branch: 'main',
          checkoutPath
        }
      }
    },
    {configPath: home.configPath}
  );

  return {checkoutPath, revisionPath};
}
