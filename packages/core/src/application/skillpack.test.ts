import {promises as fs} from 'node:fs';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  type StubGit,
  type TestHome,
  assertNoMutatingGitCalls,
  createStubGit,
  createTestHome,
  listTree
} from '../../../../test/support/appHarness.js';
import {v2SkillpackFixture, writeSkillpack} from '../../../../test/support/skillpackFixtures.js';
import {createCorvusApplication} from './createCorvusApplication.js';

const homes: TestHome[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map(async (home) => home.cleanup()));
});

async function newHome(options: Parameters<typeof createTestHome>[0] = {}): Promise<TestHome> {
  const home = await createTestHome(options);
  homes.push(home);
  return home;
}

function appFor(home: TestHome, stubGit: StubGit) {
  return createCorvusApplication({
    homeDir: home.homeDir,
    git: stubGit.runner,
    now: () => new Date('2025-01-01T00:00:00.000Z')
  });
}

const remoteCommit = 'b'.repeat(40);

describe('skillpack setup', () => {
  it('plans the initial setup before any clone happens', async () => {
    const home = await newHome();
    const stubGit = createStubGit({commitHash: remoteCommit});
    const result = await appFor(home, stubGit).skillpackSetupPlan();

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.data.plan).toMatchObject({
      skillpackId: 'corvus-skillpack',
      repositoryUrl: 'https://github.com/xiero/skill-collection.git',
      branch: 'main',
      activePath: path.join(home.homeDir, '.agents', 'skillpacks', 'corvus-skillpack', 'current'),
      expectedCommitHash: remoteCommit,
      alreadyPresent: false,
      createsConfig: true
    });
    expect(result.data.plan.expectedRevisionPath).toContain(path.join('revisions', remoteCommit, 'repo'));
    // Planning must not have cloned anything yet.
    expect(await listTree(path.join(home.homeDir, '.agents', 'skillpacks'))).toEqual([]);
    assertNoMutatingGitCalls(stubGit);
  });

  it('clones and activates the initial revision only after a confirmed apply', async () => {
    const home = await newHome();
    const stubGit = createStubGit({
      commitHash: remoteCommit,
      onClone: async (targetPath) => writeSkillpack(targetPath, v2SkillpackFixture)
    });
    const app = appFor(home, stubGit);
    const plan = await app.skillpackSetupPlan();

    expect(plan.ok).toBe(true);

    if (!plan.ok) {
      return;
    }

    const apply = await app.skillpackSetupApply({planId: plan.data.planId, confirm: plan.data.planId});

    expect(apply.ok).toBe(true);

    if (!apply.ok) {
      return;
    }

    expect(apply.data.status).toBe('clone-complete');
    expect(apply.changed).toBe(true);

    const activePath = path.join(home.homeDir, '.agents', 'skillpacks', 'corvus-skillpack', 'current');

    expect((await fs.lstat(activePath)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(activePath, 'registry.json'), 'utf8')).toContain('embedded-driver-development');

    const config = JSON.parse(await fs.readFile(home.configPath, 'utf8')) as {skillpack?: {id: string}};

    expect(config.skillpack?.id).toBe('corvus-skillpack');

    const skills = await app.listSkills();

    expect(skills.ok).toBe(true);
  });

  it('refuses to apply without a matching confirmation token', async () => {
    const home = await newHome();
    const stubGit = createStubGit({commitHash: remoteCommit});
    const app = appFor(home, stubGit);
    const plan = await app.skillpackSetupPlan();

    expect(plan.ok).toBe(true);

    if (!plan.ok) {
      return;
    }

    const apply = await app.skillpackSetupApply({planId: plan.data.planId, confirm: 'wrong'});

    expect(apply.ok).toBe(false);

    if (!apply.ok) {
      expect(apply.errors[0]?.code).toBe('PLAN_CONFIRMATION_REQUIRED');
    }

    expect(stubGit.calls.some((call) => call[0] === 'clone')).toBe(false);
  });

  it('inspects an existing active revision instead of re-cloning it', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const stubGit = createStubGit({commitHash: home.commitHash});
    const app = appFor(home, stubGit);
    const plan = await app.skillpackSetupPlan();

    expect(plan.ok).toBe(true);

    if (!plan.ok) {
      return;
    }

    expect(plan.data.plan.alreadyPresent).toBe(true);
    expect(plan.warnings.map((warning) => warning.code)).toContain('skillpack-already-present');

    const apply = await app.skillpackSetupApply({planId: plan.data.planId, confirm: plan.data.planId});

    expect(apply.ok).toBe(true);

    if (apply.ok) {
      expect(apply.data.status).toBe('checkout-readable');
      expect(apply.changed).toBe(false);
    }

    expect(stubGit.calls.some((call) => call[0] === 'clone')).toBe(false);
    assertNoMutatingGitCalls(stubGit);
  });

  it('re-running a successful setup is an idempotent no-op', async () => {
    const home = await newHome();
    const stubGit = createStubGit({
      commitHash: remoteCommit,
      onClone: async (targetPath) => writeSkillpack(targetPath, v2SkillpackFixture)
    });
    const app = appFor(home, stubGit);
    const firstPlan = await app.skillpackSetupPlan();

    if (!firstPlan.ok) {
      throw new Error('expected the first plan to succeed');
    }

    await app.skillpackSetupApply({planId: firstPlan.data.planId, confirm: firstPlan.data.planId});

    const secondPlan = await app.skillpackSetupPlan();

    if (!secondPlan.ok) {
      throw new Error('expected the second plan to succeed');
    }

    const secondApply = await app.skillpackSetupApply({
      planId: secondPlan.data.planId,
      confirm: secondPlan.data.planId
    });

    expect(secondApply.ok).toBe(true);

    if (secondApply.ok) {
      expect(secondApply.changed).toBe(false);
      expect(secondApply.data.status).toBe('checkout-readable');
    }
  });

  it('reports a clone failure as an external operation failure', async () => {
    const home = await newHome();
    const stubGit = createStubGit({commitHash: remoteCommit, failClone: true});
    const app = appFor(home, stubGit);
    const plan = await app.skillpackSetupPlan();

    if (!plan.ok) {
      throw new Error('expected plan to succeed');
    }

    const apply = await app.skillpackSetupApply({planId: plan.data.planId, confirm: plan.data.planId});

    expect(apply.ok).toBe(false);

    if (!apply.ok) {
      expect(apply.errors[0]?.code).toBe('EXTERNAL_OPERATION_FAILED');
      expect(apply.errors[0]?.retryable).toBe(true);
    }
  });

  it('warns when the remote head cannot be read, instead of silently omitting it', async () => {
    const home = await newHome();
    const stubGit = createStubGit({commitHash: remoteCommit, failRemote: true});
    const result = await appFor(home, stubGit).skillpackSetupPlan();

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.data.plan.expectedCommitHash).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain('remote-head-unreadable');
    expect(result.warnings.find((warning) => warning.code === 'remote-head-unreadable')?.message).toContain(
      'apply will fail if the branch is wrong'
    );
  });

  it('warns when the branch does not exist on the remote', async () => {
    const home = await newHome();
    const stubGit = createStubGit({commitHash: remoteCommit});
    const emptyLsRemote = {
      ...stubGit,
      runner: async (args: string[], runOptions?: {cwd?: string}) =>
        args[0] === 'ls-remote' ? {stdout: '', stderr: ''} : stubGit.runner(args, runOptions)
    };
    const result = await appFor(home, emptyLsRemote).skillpackSetupPlan({branch: 'does-not-exist'});

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.warnings.map((warning) => warning.code)).toContain('remote-head-unreadable');
      expect(result.warnings.find((warning) => warning.code === 'remote-head-unreadable')?.message).toContain(
        'does-not-exist'
      );
    }
  });

  it('does not warn about the remote head when it reads cleanly', async () => {
    const home = await newHome();
    const stubGit = createStubGit({commitHash: remoteCommit});
    const result = await appFor(home, stubGit).skillpackSetupPlan();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.warnings.map((warning) => warning.code)).not.toContain('remote-head-unreadable');
      expect(result.data.plan.expectedCommitHash).toBe(remoteCommit);
    }
  });

  it('does not look up the remote head when a snapshot already exists', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const stubGit = createStubGit({commitHash: home.commitHash, failRemote: true});
    const result = await appFor(home, stubGit).skillpackSetupPlan();

    expect(result.ok).toBe(true);

    if (result.ok) {
      // An existing snapshot is inspected, never re-cloned, so a failing remote is irrelevant.
      expect(result.warnings.map((warning) => warning.code)).not.toContain('remote-head-unreadable');
      expect(result.warnings.map((warning) => warning.code)).toContain('skillpack-already-present');
    }
  });

  it('rejects a stale setup plan after the snapshot appears', async () => {
    const home = await newHome();
    const stubGit = createStubGit({
      commitHash: remoteCommit,
      onClone: async (targetPath) => writeSkillpack(targetPath, v2SkillpackFixture)
    });
    const app = appFor(home, stubGit);
    const firstPlan = await app.skillpackSetupPlan();
    const secondPlan = await app.skillpackSetupPlan();

    if (!firstPlan.ok || !secondPlan.ok) {
      throw new Error('expected both plans to succeed');
    }

    await app.skillpackSetupApply({planId: secondPlan.data.planId, confirm: secondPlan.data.planId});

    const staleApply = await app.skillpackSetupApply({
      planId: firstPlan.data.planId,
      confirm: firstPlan.data.planId
    });

    expect(staleApply.ok).toBe(false);

    if (!staleApply.ok) {
      expect(staleApply.errors[0]?.code).toBe('STALE_PLAN');
      expect(staleApply.errors[0]?.details?.changedComponents).toContain('checkout');
    }
  });
});

describe('skillpack update', () => {
  it('reports no update when the remote matches the active revision', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const stubGit = createStubGit({commitHash: home.commitHash});
    const result = await appFor(home, stubGit).skillpackUpdateCheck();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.inspection.status).toBe('up-to-date');
      expect(result.data.inspection.updateAvailable).toBe(false);
    }

    assertNoMutatingGitCalls(stubGit);
  });

  it('detects an available update read-only', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const stubGit = createStubGit({commitHash: home.commitHash, remoteCommitHash: remoteCommit});
    const before = await listTree(home.homeDir);
    const result = await appFor(home, stubGit).skillpackUpdateCheck();

    expect(await listTree(home.homeDir)).toEqual(before);
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.inspection.status).toBe('update-available');
      expect(result.nextActions.map((action) => action.code)).toContain('preview-skillpack-update');
    }

    assertNoMutatingGitCalls(stubGit);
  });

  it('reports an unreachable remote as a warning, not a failure', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const stubGit = createStubGit({commitHash: home.commitHash, failRemote: true});
    const result = await appFor(home, stubGit).skillpackUpdateCheck();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.inspection.status).toBe('remote-unavailable');
      expect(result.warnings.map((warning) => warning.code)).toContain('remote-unavailable');
    }
  });

  it('previews an update into an inactive revision without moving the current link', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const stubGit = createStubGit({
      commitHash: home.commitHash,
      remoteCommitHash: remoteCommit,
      onClone: async (targetPath) => writeSkillpack(targetPath, v2SkillpackFixture)
    });
    const app = appFor(home, stubGit);
    const activeBefore = await fs.readlink(home.checkoutPath);
    const preview = await app.skillpackUpdatePreview();

    expect(preview.ok).toBe(true);

    if (!preview.ok) {
      return;
    }

    expect(preview.data.requiresConfirmation).toBe(true);
    expect(preview.data.plan?.remoteCommitHash).toBe(remoteCommit);
    expect(await fs.readlink(home.checkoutPath)).toBe(activeBefore);
    expect(
      (await fs.stat(path.join(home.homeDir, '.agents', 'skillpacks', 'corvus-skillpack', 'revisions', remoteCommit, 'repo'))).isDirectory()
    ).toBe(true);
    assertNoMutatingGitCalls(stubGit);
  });

  it('activates a previewed revision only with the exact plan and confirmation', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const stubGit = createStubGit({
      commitHash: home.commitHash,
      remoteCommitHash: remoteCommit,
      onClone: async (targetPath) => writeSkillpack(targetPath, v2SkillpackFixture)
    });
    const app = appFor(home, stubGit);
    const preview = await app.skillpackUpdatePreview();

    if (!preview.ok || preview.data.planId === undefined) {
      throw new Error('expected a preview plan');
    }

    const unconfirmed = await app.skillpackUpdateApply({planId: preview.data.planId, confirm: 'nope'});

    expect(unconfirmed.ok).toBe(false);

    if (!unconfirmed.ok) {
      expect(unconfirmed.errors[0]?.code).toBe('PLAN_CONFIRMATION_REQUIRED');
    }

    const applied = await app.skillpackUpdateApply({
      planId: preview.data.planId,
      confirm: preview.data.planId
    });

    expect(applied.ok).toBe(true);

    if (applied.ok) {
      expect(applied.data.status).toBe('update-applied');
      expect(applied.changed).toBe(true);
    }

    expect(await fs.readlink(home.checkoutPath)).toContain(remoteCommit);
    assertNoMutatingGitCalls(stubGit);
  });

  it('rejects activation when the remote head moved after the preview', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const previewGit = createStubGit({
      commitHash: home.commitHash,
      remoteCommitHash: remoteCommit,
      onClone: async (targetPath) => writeSkillpack(targetPath, v2SkillpackFixture)
    });
    const preview = await appFor(home, previewGit).skillpackUpdatePreview();

    if (!preview.ok || preview.data.planId === undefined) {
      throw new Error('expected a preview plan');
    }

    const movedGit = createStubGit({
      commitHash: home.commitHash,
      remoteCommitHash: 'c'.repeat(40),
      onClone: async (targetPath) => writeSkillpack(targetPath, v2SkillpackFixture)
    });
    const result = await appFor(home, movedGit).skillpackUpdateApply({
      planId: preview.data.planId,
      confirm: preview.data.planId
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('STALE_PLAN');
      expect(result.errors[0]?.details?.changedComponents).toContain('remote');
    }

    expect(await fs.readlink(home.checkoutPath)).toContain(home.commitHash);
  });

  it('requires a configured skillpack', async () => {
    const home = await newHome({writeConfig: true, configureSkillpack: false});
    const stubGit = createStubGit();
    const app = appFor(home, stubGit);

    for (const result of [await app.skillpackUpdateCheck(), await app.skillpackUpdatePreview()]) {
      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.errors[0]?.code).toBe('SKILLPACK_NOT_CONFIGURED');
      }
    }
  });
});
