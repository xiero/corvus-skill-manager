import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {type SkillpackFixture, writeSkillpack} from './skillpackFixtures.js';

export interface GitRunResult {
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[], options?: {cwd?: string}) => Promise<GitRunResult>;

export interface StubGitOptions {
  /** Commit reported by `rev-parse HEAD` inside any checkout. */
  commitHash?: string;
  /** Commit reported by `ls-remote`. Defaults to `commitHash`, i.e. up to date. */
  remoteCommitHash?: string;
  dirtyFiles?: string[];
  /** Populate a freshly cloned directory. */
  onClone?: (targetPath: string) => Promise<void>;
  failRemote?: boolean;
  failClone?: boolean;
}

export interface StubGit {
  runner: GitRunner;
  /** Every git invocation, for asserting that mutating commands are never run. */
  calls: string[][];
}

const mutatingGitCommands = new Set([
  'pull',
  'fetch',
  'reset',
  'checkout',
  'merge',
  'rebase',
  'commit',
  'push',
  'clean',
  'stash',
  'add',
  'gc',
  'prune'
]);

export function createStubGit(options: StubGitOptions = {}): StubGit {
  const commitHash = options.commitHash ?? 'a'.repeat(40);
  const remoteCommitHash = options.remoteCommitHash ?? commitHash;
  const calls: string[][] = [];

  const runner: GitRunner = async (args, runOptions) => {
    calls.push([...args]);

    if (args[0] === 'ls-remote') {
      if (options.failRemote === true) {
        throw new Error('remote unavailable');
      }

      return {stdout: `${remoteCommitHash}\trefs/heads/main\n`, stderr: ''};
    }

    if (args[0] === 'clone') {
      if (options.failClone === true) {
        throw new Error('clone failed');
      }

      const targetPath = args[args.length - 1];

      if (targetPath !== undefined) {
        await fs.mkdir(targetPath, {recursive: true});
        await options.onClone?.(targetPath);
      }

      return {stdout: '', stderr: ''};
    }

    if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
      return {stdout: 'true', stderr: ''};
    }

    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      // A revision snapshot lives at `revisions/<commit>/repo`, so report the commit its own
      // path encodes. Anything else (the active `current` link) reports the active commit.
      return {stdout: `${commitFromRevisionPath(runOptions?.cwd) ?? commitHash}\n`, stderr: ''};
    }

    if (args.includes('status')) {
      return {stdout: (options.dirtyFiles ?? []).join('\n'), stderr: ''};
    }

    if (args[0] === 'diff') {
      return {stdout: '', stderr: ''};
    }

    return {stdout: '', stderr: ''};
  };

  return {runner, calls};
}

function commitFromRevisionPath(cwd: string | undefined): string | undefined {
  if (cwd === undefined) {
    return undefined;
  }

  return /[\\/]revisions[\\/]([a-f0-9]{7,64})[\\/]repo\/?$/.exec(cwd)?.[1];
}

export function assertNoMutatingGitCalls(stubGit: StubGit): void {
  const mutating = stubGit.calls.filter((call) => {
    const command = call.find((argument) => !argument.startsWith('-'));
    return command !== undefined && mutatingGitCommands.has(command);
  });

  if (mutating.length > 0) {
    throw new Error(`Unexpected mutating git commands: ${JSON.stringify(mutating)}`);
  }
}

export interface TestHome {
  homeDir: string;
  managerStateDir: string;
  configPath: string;
  plansDir: string;
  skillpackId: string;
  checkoutPath: string;
  revisionRepoPath: string;
  commitHash: string;
  cleanup: () => Promise<void>;
}

export interface CreateTestHomeOptions {
  skillpackId?: string;
  commitHash?: string;
  /** Write a skillpack revision snapshot and activate it via the `current` link. */
  skillpack?: SkillpackFixture;
  /** Write config.json. Defaults to true when a skillpack fixture is supplied. */
  writeConfig?: boolean;
  /** Include the skillpack block in config.json. */
  configureSkillpack?: boolean;
  agents?: Record<string, {
    enabled: boolean;
    targetPath?: string;
    selectedSkillIds: string[];
    selectedBundleIds?: string[];
  }>;
}

export async function createTestHome(options: CreateTestHomeOptions = {}): Promise<TestHome> {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'corvus-app-test-'));
  const skillpackId = options.skillpackId ?? 'corvus-skillpack';
  const commitHash = options.commitHash ?? 'a'.repeat(40);
  const managerStateDir = path.join(homeDir, '.agents', 'corvus-skill-manager');
  const skillpackRoot = path.join(homeDir, '.agents', 'skillpacks', skillpackId);
  const checkoutPath = path.join(skillpackRoot, 'current');
  const revisionRepoPath = path.join(skillpackRoot, 'revisions', commitHash, 'repo');

  if (options.skillpack !== undefined) {
    await writeSkillpack(revisionRepoPath, options.skillpack);
    await fs.mkdir(skillpackRoot, {recursive: true});
    await fs.symlink(path.relative(skillpackRoot, revisionRepoPath), checkoutPath, 'dir');
  }

  const writeConfig = options.writeConfig ?? options.skillpack !== undefined;

  if (writeConfig) {
    const configureSkillpack = options.configureSkillpack ?? options.skillpack !== undefined;

    await fs.mkdir(managerStateDir, {recursive: true});
    await fs.writeFile(
      path.join(managerStateDir, 'config.json'),
      `${JSON.stringify(
        {
          version: 1,
          managerStateDir,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          ...(configureSkillpack
            ? {
                skillpack: {
                  id: skillpackId,
                  repositoryUrl: 'https://github.com/xiero/skill-collection.git',
                  branch: 'main',
                  checkoutPath
                }
              }
            : {}),
          ...(options.agents === undefined ? {} : {agents: options.agents})
        },
        null,
        2
      )}\n`,
      'utf8'
    );
  }

  return {
    homeDir,
    managerStateDir,
    configPath: path.join(managerStateDir, 'config.json'),
    plansDir: path.join(managerStateDir, 'plans'),
    skillpackId,
    checkoutPath,
    revisionRepoPath,
    commitHash,
    cleanup: async () => {
      await fs.rm(homeDir, {recursive: true, force: true});
    }
  };
}

/** Recursive listing of a directory tree, for asserting a command wrote nothing. */
export async function listTree(rootPath: string): Promise<string[]> {
  const entries: string[] = [];

  async function visit(currentPath: string): Promise<void> {
    let children: Awaited<ReturnType<typeof fs.readdir>>;

    try {
      children = await fs.readdir(currentPath, {withFileTypes: true});
    } catch {
      return;
    }

    for (const child of [...children].sort((left, right) => left.name.localeCompare(right.name))) {
      const childPath = path.join(currentPath, child.name);
      entries.push(path.relative(rootPath, childPath));

      if (child.isDirectory() && !child.isSymbolicLink()) {
        await visit(childPath);
      }
    }
  }

  await visit(rootPath);
  return entries;
}
