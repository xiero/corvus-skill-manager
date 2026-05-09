import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {defaultManagerStateDir, defaultSkillpackCheckoutPath} from '../paths.js';
import {loadLock} from '../lock/lockStore.js';
import {runGit, type GitRunner} from './gitRunner.js';
import {applyInitialSkillpackSetup} from './skillpackSetup.js';

let tempHome: string;

beforeEach(async () => {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'corvus-skillpack-test-'));
});

afterEach(async () => {
  await fs.rm(tempHome, {recursive: true, force: true});
});

describe('skillpack setup', () => {
  it('clones a missing checkout and records lock state under the manager directory', async () => {
    const sourceRepo = await createSourceRepo();
    const managerStateDir = defaultManagerStateDir(tempHome);
    const checkoutPath = defaultSkillpackCheckoutPath('alpha', tempHome);

    const result = await applyInitialSkillpackSetup({
      config: {
        id: 'alpha',
        repositoryUrl: sourceRepo,
        branch: 'main',
        checkoutPath
      },
      managerStateDir,
      now: new Date('2026-03-04T05:06:07.000Z')
    });

    expect(result.status).toBe('clone-complete');
    expect(result.checkoutPath).toBe(checkoutPath);
    await expect(fs.access(path.join(checkoutPath, 'SKILL.md'))).resolves.toBeUndefined();
    expect(result.lockPath).toBe(path.join(managerStateDir, 'lock.json'));

    const lock = await loadLock(result.lockPath!);
    expect(lock.skillpacks.alpha).toMatchObject({
      id: 'alpha',
      repositoryUrl: sourceRepo,
      branch: 'main',
      checkoutPath,
      dirty: false
    });
    expect(lock.skillpacks.alpha?.commitHash).toMatch(/^[a-f0-9]{40}$/);
  });

  it('inspects an existing checkout without cloning or writing inside it', async () => {
    const sourceRepo = await createSourceRepo();
    const managerStateDir = defaultManagerStateDir(tempHome);
    const checkoutPath = defaultSkillpackCheckoutPath('existing', tempHome);

    await fs.mkdir(path.dirname(checkoutPath), {recursive: true});
    await runGit(['clone', '--branch', 'main', '--single-branch', sourceRepo, checkoutPath]);
    const beforeSnapshot = await snapshotTree(checkoutPath);

    const git: GitRunner = async (args, options) => {
      if (args[0] === 'clone') {
        throw new Error('clone must not be called for an existing checkout');
      }

      return runGit(args, options);
    };

    const result = await applyInitialSkillpackSetup({
      config: {
        id: 'existing',
        repositoryUrl: sourceRepo,
        branch: 'main',
        checkoutPath
      },
      managerStateDir,
      git,
      now: new Date('2026-03-04T05:06:07.000Z')
    });
    const afterSnapshot = await snapshotTree(checkoutPath);

    expect(result.status).toBe('checkout-readable');
    expect(result.commitHash).toMatch(/^[a-f0-9]{40}$/);
    expect(afterSnapshot).toEqual(beforeSnapshot);
    expect(result.lockPath).toBe(path.join(managerStateDir, 'lock.json'));
  });

  it('reports dirty existing checkouts and records dirty lock state', async () => {
    const sourceRepo = await createSourceRepo();
    const managerStateDir = defaultManagerStateDir(tempHome);
    const checkoutPath = defaultSkillpackCheckoutPath('dirty', tempHome);

    await fs.mkdir(path.dirname(checkoutPath), {recursive: true});
    await runGit(['clone', '--branch', 'main', '--single-branch', sourceRepo, checkoutPath]);
    await fs.writeFile(path.join(checkoutPath, 'LOCAL_ONLY.md'), 'local change\n', 'utf8');

    const result = await applyInitialSkillpackSetup({
      config: {
        id: 'dirty',
        repositoryUrl: sourceRepo,
        branch: 'main',
        checkoutPath
      },
      managerStateDir,
      now: new Date('2026-03-04T05:06:07.000Z')
    });

    expect(result.status).toBe('checkout-dirty');
    expect(result.dirty).toBe(true);
    expect(result.dirtyFiles).toContain('?? LOCAL_ONLY.md');

    const lock = await loadLock(result.lockPath!);
    expect(lock.skillpacks.dirty?.dirty).toBe(true);
  });

  it('returns clone-failed when the initial clone cannot be completed', async () => {
    const managerStateDir = defaultManagerStateDir(tempHome);
    const checkoutPath = defaultSkillpackCheckoutPath('missing-remote', tempHome);

    const result = await applyInitialSkillpackSetup({
      config: {
        id: 'missing-remote',
        repositoryUrl: path.join(tempHome, 'does-not-exist.git'),
        branch: 'main',
        checkoutPath
      },
      managerStateDir
    });

    expect(result.status).toBe('clone-failed');
    await expect(fs.access(path.join(managerStateDir, 'lock.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });
});

async function createSourceRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(tempHome, 'source-repo-'));

  await runGit(['init', '--initial-branch', 'main'], {cwd: repoPath});
  await fs.writeFile(path.join(repoPath, 'SKILL.md'), '# Test Skill\n', 'utf8');
  await runGit(['add', 'SKILL.md'], {cwd: repoPath});
  await runGit(
    ['-c', 'user.name=Corvus Test', '-c', 'user.email=corvus@example.test', 'commit', '-m', 'initial skill'],
    {cwd: repoPath}
  );

  return repoPath;
}

async function snapshotTree(rootPath: string): Promise<Record<string, number>> {
  const entries: Record<string, number> = {};

  async function visit(currentPath: string): Promise<void> {
    const stat = await fs.lstat(currentPath);
    const relativePath = path.relative(rootPath, currentPath) || '.';
    entries[relativePath] = stat.mtimeMs;

    if (!stat.isDirectory()) {
      return;
    }

    const childNames = await fs.readdir(currentPath);

    for (const childName of childNames) {
      await visit(path.join(currentPath, childName));
    }
  }

  await visit(rootPath);

  return entries;
}
