import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {defaultManagerStateDir, defaultSkillpackCheckoutPath} from '../paths.js';
import {loadLock} from '../lock/lockStore.js';
import {runGit, type GitRunner} from './gitRunner.js';
import {
  applyInitialSkillpackSetup,
  applySkillpackUpdate,
  inspectSkillpackRemoteUpdate,
  prepareSkillpackUpdatePreview
} from './skillpackSetup.js';

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
    const currentStat = await fs.lstat(checkoutPath);
    expect(currentStat.isSymbolicLink()).toBe(true);
    expect(result.lockPath).toBe(path.join(managerStateDir, 'lock.json'));
    expect(result.activeRevisionPath).toMatch(
      new RegExp(`${escapeRegExp(path.join('alpha', 'revisions'))}.*${escapeRegExp(path.join('repo'))}$`)
    );

    const lock = await loadLock(result.lockPath!);
    expect(lock.skillpacks.alpha).toMatchObject({
      id: 'alpha',
      repositoryUrl: sourceRepo,
      branch: 'main',
      checkoutPath,
      activeRevisionPath: result.activeRevisionPath,
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

  it('detects, previews, and activates a remote revision without mutating the active snapshot', async () => {
    const sourceRepo = await createRegisteredSourceRepo();
    const managerStateDir = defaultManagerStateDir(tempHome);
    const checkoutPath = defaultSkillpackCheckoutPath('updates', tempHome);
    const config = {
      id: 'updates',
      repositoryUrl: sourceRepo,
      branch: 'main',
      checkoutPath
    };

    const setupResult = await applyInitialSkillpackSetup({
      config,
      managerStateDir,
      now: new Date('2026-03-04T05:06:07.000Z')
    });
    const initialCommit = setupResult.commitHash!;
    const initialSnapshot = await snapshotTree(path.dirname(checkoutPath));

    await addRegisteredSkill(sourceRepo, {
      id: 'lint',
      title: 'Lint',
      description: 'Lint code.',
      path: 'skills/lint',
      frontmatterName: 'lint'
    });

    const updateInspection = await inspectSkillpackRemoteUpdate(config);

    expect(updateInspection.status).toBe('update-available');
    expect(updateInspection.activeCommitHash).toBe(initialCommit);
    expect(updateInspection.remoteCommitHash).toMatch(/^[a-f0-9]{40}$/);

    const preview = await prepareSkillpackUpdatePreview({
      config,
      managerStateDir
    });
    const afterPreviewSnapshot = await snapshotTree(path.dirname(checkoutPath));

    expect(preview.status).toBe('update-preview-ready');
    expect(preview.addedSkillIds).toEqual(['lint']);
    expect(preview.remoteCommitHash).toBe(updateInspection.remoteCommitHash);
    expect(await currentCommit(checkoutPath)).toBe(initialCommit);
    expect(afterPreviewSnapshot.current).toEqual(initialSnapshot.current);

    const updateResult = await applySkillpackUpdate({
      config,
      managerStateDir,
      now: new Date('2026-03-05T05:06:07.000Z')
    });

    expect(updateResult.status).toBe('update-applied');
    expect(updateResult.previousCommitHash).toBe(initialCommit);
    expect(updateResult.commitHash).toBe(updateInspection.remoteCommitHash);
    await expect(fs.access(path.join(checkoutPath, 'skills', 'lint', 'SKILL.md'))).resolves.toBeUndefined();

    const lock = await loadLock(updateResult.lockPath!);
    expect(lock.skillpacks.updates).toMatchObject({
      commitHash: updateInspection.remoteCommitHash,
      remoteCommitHash: updateInspection.remoteCommitHash,
      updateAvailable: false
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

async function createRegisteredSourceRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(tempHome, 'source-registry-repo-'));

  await runGit(['init', '--initial-branch', 'main'], {cwd: repoPath});
  await writeRegisteredSkill(repoPath, {
    id: 'review',
    title: 'Review',
    description: 'Review code.',
    path: 'skills/review',
    frontmatterName: 'review'
  });
  await runGit(['add', 'registry.json', 'skills/review/SKILL.md'], {cwd: repoPath});
  await runGit(
    ['-c', 'user.name=Corvus Test', '-c', 'user.email=corvus@example.test', 'commit', '-m', 'initial registry'],
    {cwd: repoPath}
  );

  return repoPath;
}

async function addRegisteredSkill(
  repoPath: string,
  skill: {
    id: string;
    title: string;
    description: string;
    path: string;
    frontmatterName: string;
  }
): Promise<void> {
  await writeRegisteredSkill(repoPath, skill);
  await runGit(['add', 'registry.json', path.join(skill.path, 'SKILL.md')], {cwd: repoPath});
  await runGit(
    ['-c', 'user.name=Corvus Test', '-c', 'user.email=corvus@example.test', 'commit', '-m', `add ${skill.id}`],
    {cwd: repoPath}
  );
}

async function writeRegisteredSkill(
  repoPath: string,
  skill: {
    id: string;
    title: string;
    description: string;
    path: string;
    frontmatterName: string;
  }
): Promise<void> {
  const registryPath = path.join(repoPath, 'registry.json');
  const registry = await readRegistry(registryPath);
  registry.skills = [
    ...registry.skills.filter((entry) => entry.id !== skill.id),
    {
      id: skill.id,
      path: skill.path,
      title: skill.title,
      description: skill.description,
      supportedAgents: ['codex']
    }
  ].sort((left, right) => left.id.localeCompare(right.id));
  await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

  const skillPath = path.join(repoPath, skill.path);
  await fs.mkdir(skillPath, {recursive: true});
  await fs.writeFile(
    path.join(skillPath, 'SKILL.md'),
    `---\nname: ${JSON.stringify(skill.frontmatterName)}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n# ${skill.title}\n`,
    'utf8'
  );
}

async function readRegistry(registryPath: string): Promise<{
  version: number;
  skills: Array<{
    id: string;
    path: string;
    title: string;
    description: string;
    supportedAgents: string[];
  }>;
}> {
  try {
    return JSON.parse(await fs.readFile(registryPath, 'utf8')) as {
      version: number;
      skills: Array<{
        id: string;
        path: string;
        title: string;
        description: string;
        supportedAgents: string[];
      }>;
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {version: 1, skills: []};
    }

    throw error;
  }
}

async function currentCommit(checkoutPath: string): Promise<string> {
  return (await runGit(['rev-parse', 'HEAD'], {cwd: checkoutPath})).stdout.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
