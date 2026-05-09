import {promises as fs} from 'node:fs';
import path from 'node:path';
import {
  assertPathInside,
  defaultLockPath,
  defaultManagerStateDir,
  lockFileName,
  resolveUserPath
} from '../paths.js';
import {
  type ManagerLock,
  type SkillpackLockEntry,
  createEmptyManagerLock,
  parseManagerLock
} from './lockSchema.js';

export interface LockStoreOptions {
  homeDir?: string;
  managerStateDir?: string;
  lockPath?: string;
  now?: Date;
}

function resolveLockPaths(options: LockStoreOptions = {}): {
  managerStateDir: string;
  lockPath: string;
} {
  const homeDir = options.homeDir;
  const managerStateDir = resolveUserPath(
    options.managerStateDir ?? (homeDir === undefined ? defaultManagerStateDir() : defaultManagerStateDir(homeDir)),
    homeDir
  );
  const lockPath = resolveUserPath(options.lockPath ?? path.join(managerStateDir, lockFileName), homeDir);

  assertPathInside(managerStateDir, lockPath);

  return {managerStateDir, lockPath};
}

export async function loadLock(lockPath: string): Promise<ManagerLock> {
  const rawLock = await fs.readFile(lockPath, 'utf8');
  return parseManagerLock(JSON.parse(rawLock));
}

export async function saveLock(lock: ManagerLock, options: LockStoreOptions = {}): Promise<string> {
  const {managerStateDir, lockPath} = resolveLockPaths(options);
  const parsedLock = parseManagerLock(lock);

  assertPathInside(managerStateDir, lockPath);
  await fs.mkdir(path.dirname(lockPath), {recursive: true});
  await fs.writeFile(lockPath, `${JSON.stringify(parsedLock, null, 2)}\n`, 'utf8');

  return lockPath;
}

export async function upsertSkillpackLockEntry(
  entry: SkillpackLockEntry,
  options: LockStoreOptions = {}
): Promise<{lock: ManagerLock; lockPath: string}> {
  const {lockPath} = resolveLockPaths(options);
  let lock: ManagerLock;

  try {
    lock = await loadLock(lockPath);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    lock = createEmptyManagerLock(options.now);
  }

  const updatedAt = (options.now ?? new Date()).toISOString();
  const updatedLock: ManagerLock = {
    ...lock,
    updatedAt,
    skillpacks: {
      ...lock.skillpacks,
      [entry.id]: entry
    }
  };

  await saveLock(updatedLock, options);
  return {lock: updatedLock, lockPath};
}

export function getDefaultLockPath(homeDir?: string): string {
  return homeDir === undefined ? defaultLockPath() : defaultLockPath(homeDir);
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
