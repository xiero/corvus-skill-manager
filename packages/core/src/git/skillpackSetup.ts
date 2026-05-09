import {promises as fs} from 'node:fs';
import path from 'node:path';
import {
  type SkillpackConfig,
  parseSkillpackConfig
} from '../config/configSchema.js';
import {
  type LockStoreOptions,
  upsertSkillpackLockEntry
} from '../lock/lockStore.js';
import {resolveUserPath} from '../paths.js';
import {type GitRunner, runGit} from './gitRunner.js';

export type CheckoutStatus =
  | 'checkout-missing'
  | 'checkout-readable'
  | 'checkout-dirty'
  | 'checkout-unreadable';

export interface SkillpackInspection {
  status: CheckoutStatus;
  checkoutPath: string;
  exists: boolean;
  readable: boolean;
  commitHash?: string;
  dirty: boolean;
  dirtyFiles: string[];
  message: string;
}

export type SkillpackSetupStatus =
  | CheckoutStatus
  | 'clone-complete'
  | 'clone-failed';

export interface SkillpackSetupResult {
  status: SkillpackSetupStatus;
  config: SkillpackConfig;
  checkoutPath: string;
  lockPath?: string;
  commitHash?: string;
  dirty: boolean;
  dirtyFiles: string[];
  message: string;
}

export interface SkillpackSetupOptions {
  config: SkillpackConfig;
  managerStateDir: string;
  homeDir?: string;
  git?: GitRunner;
  now?: Date;
}

export async function inspectSkillpackCheckout(
  checkoutPath: string,
  options: {homeDir?: string; git?: GitRunner} = {}
): Promise<SkillpackInspection> {
  const git = options.git ?? runGit;
  const resolvedCheckoutPath = resolveUserPath(checkoutPath, options.homeDir);

  if (!(await pathExists(resolvedCheckoutPath))) {
    return {
      status: 'checkout-missing',
      checkoutPath: resolvedCheckoutPath,
      exists: false,
      readable: false,
      dirty: false,
      dirtyFiles: [],
      message: 'Checkout missing'
    };
  }

  const checkoutStat = await fs.stat(resolvedCheckoutPath);

  if (!checkoutStat.isDirectory()) {
    return {
      status: 'checkout-unreadable',
      checkoutPath: resolvedCheckoutPath,
      exists: true,
      readable: false,
      dirty: false,
      dirtyFiles: [],
      message: 'Checkout path exists but is not a directory'
    };
  }

  try {
    await git(['rev-parse', '--is-inside-work-tree'], {cwd: resolvedCheckoutPath});
    const commitHash = (await git(['rev-parse', 'HEAD'], {cwd: resolvedCheckoutPath})).stdout.trim();
    const statusOutput = (
      await git(
        ['-c', 'core.optionalLocks=false', 'status', '--porcelain=v1', '--untracked-files=all'],
        {cwd: resolvedCheckoutPath}
      )
    ).stdout;
    const dirtyFiles = statusOutput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const dirty = dirtyFiles.length > 0;

    return {
      status: dirty ? 'checkout-dirty' : 'checkout-readable',
      checkoutPath: resolvedCheckoutPath,
      exists: true,
      readable: true,
      commitHash,
      dirty,
      dirtyFiles,
      message: dirty ? 'Checkout exists and is dirty' : 'Checkout exists and is readable'
    };
  } catch (error) {
    return {
      status: 'checkout-unreadable',
      checkoutPath: resolvedCheckoutPath,
      exists: true,
      readable: false,
      dirty: false,
      dirtyFiles: [],
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function applyInitialSkillpackSetup(
  options: SkillpackSetupOptions
): Promise<SkillpackSetupResult> {
  const parsedConfig = parseSkillpackConfig(options.config);
  const checkoutPath = resolveUserPath(parsedConfig.checkoutPath, options.homeDir);
  const config: SkillpackConfig = {
    ...parsedConfig,
    checkoutPath
  };
  const git = options.git ?? runGit;
  const inspectOptions = options.homeDir === undefined ? {git} : {homeDir: options.homeDir, git};
  const initialInspection = await inspectSkillpackCheckout(checkoutPath, inspectOptions);

  if (initialInspection.status === 'checkout-missing') {
    try {
      await fs.mkdir(path.dirname(checkoutPath), {recursive: true});
      await git(['clone', '--branch', config.branch, '--single-branch', config.repositoryUrl, checkoutPath]);
    } catch (error) {
      return {
        status: 'clone-failed',
        config,
        checkoutPath,
        dirty: false,
        dirtyFiles: [],
        message: error instanceof Error ? error.message : String(error)
      };
    }

    const clonedInspection = await inspectSkillpackCheckout(checkoutPath, inspectOptions);

    if (!clonedInspection.readable || clonedInspection.commitHash === undefined) {
      return {
        status: 'clone-failed',
        config,
        checkoutPath,
        dirty: false,
        dirtyFiles: [],
        message: clonedInspection.message
      };
    }

    const lockPath = await recordSkillpackLock({
      config,
      managerStateDir: options.managerStateDir,
      commitHash: clonedInspection.commitHash,
      dirty: clonedInspection.dirty,
      ...(options.now === undefined ? {} : {now: options.now})
    });

    return {
      status: 'clone-complete',
      config,
      checkoutPath,
      lockPath,
      commitHash: clonedInspection.commitHash,
      dirty: clonedInspection.dirty,
      dirtyFiles: clonedInspection.dirtyFiles,
      message: 'Initial clone complete'
    };
  }

  if (initialInspection.readable && initialInspection.commitHash !== undefined) {
    const lockPath = await recordSkillpackLock({
      config,
      managerStateDir: options.managerStateDir,
      commitHash: initialInspection.commitHash,
      dirty: initialInspection.dirty,
      ...(options.now === undefined ? {} : {now: options.now})
    });

    return {
      status: initialInspection.status,
      config,
      checkoutPath,
      lockPath,
      commitHash: initialInspection.commitHash,
      dirty: initialInspection.dirty,
      dirtyFiles: initialInspection.dirtyFiles,
      message: initialInspection.message
    };
  }

  return {
    status: initialInspection.status,
    config,
    checkoutPath,
    dirty: initialInspection.dirty,
    dirtyFiles: initialInspection.dirtyFiles,
    message: initialInspection.message
  };
}

async function recordSkillpackLock(options: {
  config: SkillpackConfig;
  managerStateDir: string;
  commitHash: string;
  dirty: boolean;
  now?: Date;
}): Promise<string> {
  const lockOptions: LockStoreOptions =
    options.now === undefined ?
      {managerStateDir: options.managerStateDir} :
      {managerStateDir: options.managerStateDir, now: options.now};
  const recordedAt = (options.now ?? new Date()).toISOString();
  const result = await upsertSkillpackLockEntry(
    {
      id: options.config.id,
      repositoryUrl: options.config.repositoryUrl,
      branch: options.config.branch,
      checkoutPath: options.config.checkoutPath,
      commitHash: options.commitHash,
      dirty: options.dirty,
      recordedAt
    },
    lockOptions
  );

  return result.lockPath;
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return false;
    }

    throw error;
  }
}
