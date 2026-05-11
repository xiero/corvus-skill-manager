import {randomUUID} from 'node:crypto';
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
import {type DiscoveredSkill, discoverSkillsFromCheckout} from '../skills/skillDiscovery.js';
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
  activeRevisionPath?: string;
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

export interface SkillpackSnapshotLayout {
  skillpackRootPath: string;
  revisionsPath: string;
  currentPath: string;
}

export type SkillpackRemoteUpdateStatus =
  | 'active-missing'
  | 'active-unreadable'
  | 'remote-unavailable'
  | 'up-to-date'
  | 'update-available';

export interface SkillpackRemoteUpdateInspection {
  status: SkillpackRemoteUpdateStatus;
  checkoutPath: string;
  activeCommitHash?: string;
  remoteCommitHash?: string;
  updateAvailable: boolean;
  message: string;
}

export type SkillpackUpdatePreviewStatus =
  | 'update-preview-ready'
  | 'no-update'
  | 'preview-failed';

export interface SkillpackUpdatePreview {
  status: SkillpackUpdatePreviewStatus;
  checkoutPath: string;
  activeCommitHash?: string;
  remoteCommitHash?: string;
  candidateRevisionPath?: string;
  addedSkillIds: string[];
  removedSkillIds: string[];
  changedSkillIds: string[];
  changedFiles: string[];
  message: string;
}

export type SkillpackUpdateApplyStatus =
  | 'update-applied'
  | 'no-update'
  | 'update-failed';

export interface SkillpackUpdateApplyResult {
  status: SkillpackUpdateApplyStatus;
  checkoutPath: string;
  activeRevisionPath?: string;
  lockPath?: string;
  previousCommitHash?: string;
  commitHash?: string;
  remoteCommitHash?: string;
  message: string;
}

interface RevisionSnapshot {
  commitHash: string;
  repoPath: string;
  created: boolean;
}

export function resolveSkillpackSnapshotLayout(
  config: SkillpackConfig,
  options: {homeDir?: string} = {}
): SkillpackSnapshotLayout {
  const currentPath = resolveUserPath(config.checkoutPath, options.homeDir);
  const skillpackRootPath = path.dirname(currentPath);

  return {
    skillpackRootPath,
    revisionsPath: path.join(skillpackRootPath, 'revisions'),
    currentPath
  };
}

export function skillpackRevisionRepoPath(layout: SkillpackSnapshotLayout, commitHash: string): string {
  return path.join(layout.revisionsPath, assertSafeCommitHash(commitHash), 'repo');
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
    const commitHash = assertSafeCommitHash(
      (await git(['rev-parse', 'HEAD'], {cwd: resolvedCheckoutPath})).stdout.trim()
    );
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

export async function inspectSkillpackRemoteUpdate(
  configInput: SkillpackConfig,
  options: {homeDir?: string; git?: GitRunner} = {}
): Promise<SkillpackRemoteUpdateInspection> {
  const config = normalizeSkillpackConfig(configInput, options.homeDir);
  const git = options.git ?? runGit;
  const inspectOptions = options.homeDir === undefined ? {git} : {homeDir: options.homeDir, git};
  const activeInspection = await inspectSkillpackCheckout(config.checkoutPath, inspectOptions);

  if (!activeInspection.exists) {
    return {
      status: 'active-missing',
      checkoutPath: activeInspection.checkoutPath,
      updateAvailable: false,
      message: 'Active skillpack snapshot is missing; setup can create the initial revision.'
    };
  }

  if (!activeInspection.readable || activeInspection.commitHash === undefined) {
    return {
      status: 'active-unreadable',
      checkoutPath: activeInspection.checkoutPath,
      updateAvailable: false,
      message: `Active skillpack snapshot is not readable: ${activeInspection.message}.`
    };
  }

  try {
    const remoteCommitHash = await readRemoteCommitHash(config, git);
    const updateAvailable = remoteCommitHash !== activeInspection.commitHash;

    return {
      status: updateAvailable ? 'update-available' : 'up-to-date',
      checkoutPath: activeInspection.checkoutPath,
      activeCommitHash: activeInspection.commitHash,
      remoteCommitHash,
      updateAvailable,
      message: updateAvailable ?
        `Remote ${config.branch} is at ${shortCommit(remoteCommitHash)}; active snapshot is ${shortCommit(activeInspection.commitHash)}.` :
        `Active snapshot is up to date with ${config.branch}.`
    };
  } catch (error) {
    return {
      status: 'remote-unavailable',
      checkoutPath: activeInspection.checkoutPath,
      activeCommitHash: activeInspection.commitHash,
      updateAvailable: false,
      message: `Remote update check failed: ${error instanceof Error ? error.message : String(error)}.`
    };
  }
}

export async function prepareSkillpackUpdatePreview(
  options: SkillpackSetupOptions
): Promise<SkillpackUpdatePreview> {
  const config = normalizeSkillpackConfig(options.config, options.homeDir);
  const git = options.git ?? runGit;
  const updateInspection = await inspectSkillpackRemoteUpdate(config, {
    ...(options.homeDir === undefined ? {} : {homeDir: options.homeDir}),
    git
  });

  if (
    updateInspection.status !== 'update-available' ||
    updateInspection.activeCommitHash === undefined ||
    updateInspection.remoteCommitHash === undefined
  ) {
    return {
      status: 'no-update',
      checkoutPath: updateInspection.checkoutPath,
      ...(updateInspection.activeCommitHash === undefined ? {} : {activeCommitHash: updateInspection.activeCommitHash}),
      ...(updateInspection.remoteCommitHash === undefined ? {} : {remoteCommitHash: updateInspection.remoteCommitHash}),
      addedSkillIds: [],
      removedSkillIds: [],
      changedSkillIds: [],
      changedFiles: [],
      message: updateInspection.message
    };
  }

  try {
    const layout = resolveSkillpackSnapshotLayout(config, options);
    const snapshot = await ensureRevisionSnapshot({
      config,
      layout,
      git,
      expectedCommitHash: updateInspection.remoteCommitHash
    });
    const currentDiscovery = await discoverSkillsFromCheckout(config.checkoutPath);
    const candidateDiscovery = await discoverSkillsFromCheckout(snapshot.repoPath);
    const changedFiles = await readChangedFiles({
      git,
      repoPath: snapshot.repoPath,
      activeCommitHash: updateInspection.activeCommitHash,
      remoteCommitHash: updateInspection.remoteCommitHash
    });
    const summary = summarizeSkillChanges({
      currentSkills: currentDiscovery.skills,
      candidateSkills: candidateDiscovery.skills,
      changedFiles
    });

    return {
      status: 'update-preview-ready',
      checkoutPath: config.checkoutPath,
      activeCommitHash: updateInspection.activeCommitHash,
      remoteCommitHash: updateInspection.remoteCommitHash,
      candidateRevisionPath: snapshot.repoPath,
      addedSkillIds: summary.addedSkillIds,
      removedSkillIds: summary.removedSkillIds,
      changedSkillIds: summary.changedSkillIds,
      changedFiles,
      message: snapshot.created ? 'Downloaded update preview snapshot.' : 'Loaded existing update preview snapshot.'
    };
  } catch (error) {
    return {
      status: 'preview-failed',
      checkoutPath: config.checkoutPath,
      activeCommitHash: updateInspection.activeCommitHash,
      remoteCommitHash: updateInspection.remoteCommitHash,
      addedSkillIds: [],
      removedSkillIds: [],
      changedSkillIds: [],
      changedFiles: [],
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function applySkillpackUpdate(
  options: SkillpackSetupOptions
): Promise<SkillpackUpdateApplyResult> {
  const config = normalizeSkillpackConfig(options.config, options.homeDir);
  const git = options.git ?? runGit;
  const updateInspection = await inspectSkillpackRemoteUpdate(config, {
    ...(options.homeDir === undefined ? {} : {homeDir: options.homeDir}),
    git
  });

  if (
    updateInspection.status !== 'update-available' ||
    updateInspection.activeCommitHash === undefined ||
    updateInspection.remoteCommitHash === undefined
  ) {
    return {
      status: 'no-update',
      checkoutPath: updateInspection.checkoutPath,
      ...(updateInspection.activeCommitHash === undefined ? {} : {previousCommitHash: updateInspection.activeCommitHash}),
      message: updateInspection.message
    };
  }

  try {
    const layout = resolveSkillpackSnapshotLayout(config, options);
    const snapshot = await ensureRevisionSnapshot({
      config,
      layout,
      git,
      expectedCommitHash: updateInspection.remoteCommitHash
    });

    await activateRevisionSnapshot({
      currentPath: layout.currentPath,
      repoPath: snapshot.repoPath
    });

    const lockPath = await recordSkillpackLock({
      config,
      managerStateDir: options.managerStateDir,
      commitHash: snapshot.commitHash,
      dirty: false,
      activeRevisionPath: snapshot.repoPath,
      remoteCommitHash: updateInspection.remoteCommitHash,
      updateAvailable: false,
      ...(options.now === undefined ? {} : {now: options.now})
    });

    return {
      status: 'update-applied',
      checkoutPath: layout.currentPath,
      activeRevisionPath: snapshot.repoPath,
      lockPath,
      previousCommitHash: updateInspection.activeCommitHash,
      commitHash: snapshot.commitHash,
      message: `Activated skillpack revision ${shortCommit(snapshot.commitHash)}.`
    };
  } catch (error) {
    return {
      status: 'update-failed',
      checkoutPath: config.checkoutPath,
      previousCommitHash: updateInspection.activeCommitHash,
      remoteCommitHash: updateInspection.remoteCommitHash,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function applyInitialSkillpackSetup(
  options: SkillpackSetupOptions
): Promise<SkillpackSetupResult> {
  const config = normalizeSkillpackConfig(options.config, options.homeDir);
  const layout = resolveSkillpackSnapshotLayout(config, options);
  const git = options.git ?? runGit;
  const inspectOptions = options.homeDir === undefined ? {git} : {homeDir: options.homeDir, git};
  const initialInspection = await inspectSkillpackCheckout(layout.currentPath, inspectOptions);

  if (initialInspection.status === 'checkout-missing') {
    try {
      const snapshot = await ensureRevisionSnapshot({
        config,
        layout,
        git,
        ...(await remoteCommitOption(config, git))
      });

      await activateRevisionSnapshot({
        currentPath: layout.currentPath,
        repoPath: snapshot.repoPath
      });

      const clonedInspection = await inspectSkillpackCheckout(layout.currentPath, inspectOptions);

      if (!clonedInspection.readable || clonedInspection.commitHash === undefined) {
        return {
          status: 'clone-failed',
          config,
          checkoutPath: layout.currentPath,
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
        activeRevisionPath: snapshot.repoPath,
        remoteCommitHash: clonedInspection.commitHash,
        updateAvailable: false,
        ...(options.now === undefined ? {} : {now: options.now})
      });

      return {
        status: 'clone-complete',
        config,
        checkoutPath: layout.currentPath,
        activeRevisionPath: snapshot.repoPath,
        lockPath,
        commitHash: clonedInspection.commitHash,
        dirty: clonedInspection.dirty,
        dirtyFiles: clonedInspection.dirtyFiles,
        message: 'Initial revision snapshot cloned and activated'
      };
    } catch (error) {
      return {
        status: 'clone-failed',
        config,
        checkoutPath: layout.currentPath,
        dirty: false,
        dirtyFiles: [],
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  if (initialInspection.readable && initialInspection.commitHash !== undefined) {
    const activeRevisionPath = await readCurrentLinkTarget(layout.currentPath);
    const lockPath = await recordSkillpackLock({
      config,
      managerStateDir: options.managerStateDir,
      commitHash: initialInspection.commitHash,
      dirty: initialInspection.dirty,
      ...(activeRevisionPath === undefined ? {} : {activeRevisionPath}),
      ...(options.now === undefined ? {} : {now: options.now})
    });

    return {
      status: initialInspection.status,
      config,
      checkoutPath: layout.currentPath,
      ...(activeRevisionPath === undefined ? {} : {activeRevisionPath}),
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
    checkoutPath: layout.currentPath,
    dirty: initialInspection.dirty,
    dirtyFiles: initialInspection.dirtyFiles,
    message: initialInspection.message
  };
}

async function ensureRevisionSnapshot(options: {
  config: SkillpackConfig;
  layout: SkillpackSnapshotLayout;
  git: GitRunner;
  expectedCommitHash?: string;
}): Promise<RevisionSnapshot> {
  const expectedCommitHash =
    options.expectedCommitHash === undefined ? undefined : assertSafeCommitHash(options.expectedCommitHash);

  if (expectedCommitHash !== undefined) {
    const expectedRepoPath = skillpackRevisionRepoPath(options.layout, expectedCommitHash);

    if (await pathExists(expectedRepoPath)) {
      await assertExistingRevisionMatches({
        repoPath: expectedRepoPath,
        expectedCommitHash,
        git: options.git
      });

      return {
        commitHash: expectedCommitHash,
        repoPath: expectedRepoPath,
        created: false
      };
    }

    const expectedRevisionPath = path.dirname(expectedRepoPath);
    const expectedRevisionStat = await lstatIfExists(expectedRevisionPath);

    if (expectedRevisionStat !== undefined) {
      throw new Error(`Revision path exists without a readable repo; refusing to repair ${expectedRevisionPath}.`);
    }

    await fs.mkdir(expectedRevisionPath, {recursive: true});

    try {
      await options.git([
        'clone',
        '--branch',
        options.config.branch,
        '--single-branch',
        options.config.repositoryUrl,
        expectedRepoPath
      ]);

      await assertExistingRevisionMatches({
        repoPath: expectedRepoPath,
        expectedCommitHash,
        git: options.git
      });

      return {
        commitHash: expectedCommitHash,
        repoPath: expectedRepoPath,
        created: true
      };
    } catch (error) {
      await fs.rm(expectedRevisionPath, {recursive: true, force: true});
      throw error;
    }
  }

  await fs.mkdir(options.layout.revisionsPath, {recursive: true});
  const temporaryRepoPath = path.join(options.layout.revisionsPath, `.tmp-${process.pid}-${randomUUID()}`);

  try {
    await options.git([
      'clone',
      '--branch',
      options.config.branch,
      '--single-branch',
      options.config.repositoryUrl,
      temporaryRepoPath
    ]);

    const commitHash = assertSafeCommitHash(
      (await options.git(['rev-parse', 'HEAD'], {cwd: temporaryRepoPath})).stdout.trim()
    );

    if (expectedCommitHash !== undefined && commitHash !== expectedCommitHash) {
      throw new Error(
        `Remote branch moved while preparing snapshot: expected ${expectedCommitHash}, cloned ${commitHash}.`
      );
    }

    const repoPath = skillpackRevisionRepoPath(options.layout, commitHash);

    if (await pathExists(repoPath)) {
      await fs.rm(temporaryRepoPath, {recursive: true, force: true});
      return {
        commitHash,
        repoPath,
        created: false
      };
    }

    await fs.mkdir(path.dirname(repoPath), {recursive: true});
    await fs.rename(temporaryRepoPath, repoPath);

    return {
      commitHash,
      repoPath,
      created: true
    };
  } catch (error) {
    await fs.rm(temporaryRepoPath, {recursive: true, force: true});
    throw error;
  }
}

async function assertExistingRevisionMatches(options: {
  repoPath: string;
  expectedCommitHash: string;
  git: GitRunner;
}): Promise<void> {
  const inspection = await inspectSkillpackCheckout(options.repoPath, {git: options.git});

  if (!inspection.readable || inspection.commitHash !== options.expectedCommitHash) {
    throw new Error(
      `Revision snapshot at ${options.repoPath} does not match expected commit ${options.expectedCommitHash}.`
    );
  }
}

async function activateRevisionSnapshot(options: {
  currentPath: string;
  repoPath: string;
}): Promise<void> {
  await fs.mkdir(path.dirname(options.currentPath), {recursive: true});
  const currentStat = await lstatIfExists(options.currentPath);

  if (currentStat !== undefined && !currentStat.isSymbolicLink()) {
    throw new Error(`Refusing to replace non-link active skillpack path: ${options.currentPath}`);
  }

  if (currentStat?.isSymbolicLink() === true) {
    await fs.unlink(options.currentPath);
  }

  const relativeTarget = path.relative(path.dirname(options.currentPath), options.repoPath);
  const linkTarget = process.platform === 'win32' ? options.repoPath : relativeTarget;
  await fs.symlink(linkTarget, options.currentPath, process.platform === 'win32' ? 'junction' : 'dir');
}

async function readRemoteCommitHash(config: SkillpackConfig, git: GitRunner): Promise<string> {
  const output = (await git(['ls-remote', config.repositoryUrl, `refs/heads/${config.branch}`])).stdout.trim();
  const firstLine = output.split('\n').find((line) => line.trim() !== '');

  if (firstLine === undefined) {
    throw new Error(`No remote branch named ${config.branch} found.`);
  }

  return assertSafeCommitHash(firstLine.split(/\s+/)[0] ?? '');
}

async function remoteCommitOption(
  config: SkillpackConfig,
  git: GitRunner
): Promise<{expectedCommitHash: string} | Record<string, never>> {
  try {
    return {expectedCommitHash: await readRemoteCommitHash(config, git)};
  } catch {
    return {};
  }
}

async function readChangedFiles(options: {
  git: GitRunner;
  repoPath: string;
  activeCommitHash: string;
  remoteCommitHash: string;
}): Promise<string[]> {
  try {
    const output = (
      await options.git(
        ['diff', '--name-only', options.activeCommitHash, options.remoteCommitHash, '--', 'registry.json', 'skills'],
        {cwd: options.repoPath}
      )
    ).stdout;

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function summarizeSkillChanges(options: {
  currentSkills: DiscoveredSkill[];
  candidateSkills: DiscoveredSkill[];
  changedFiles: string[];
}): {
  addedSkillIds: string[];
  removedSkillIds: string[];
  changedSkillIds: string[];
} {
  const currentById = new Map(options.currentSkills.map((skill) => [skill.id, skill]));
  const candidateById = new Map(options.candidateSkills.map((skill) => [skill.id, skill]));
  const currentSkillIds = new Set(currentById.keys());
  const candidateSkillIds = new Set(candidateById.keys());
  const addedSkillIds = [...candidateSkillIds].filter((skillId) => !currentSkillIds.has(skillId)).sort();
  const removedSkillIds = [...currentSkillIds].filter((skillId) => !candidateSkillIds.has(skillId)).sort();
  const changedSkillIds = [...candidateSkillIds]
    .filter((skillId) => currentSkillIds.has(skillId))
    .filter((skillId) => {
      const currentSkill = currentById.get(skillId);
      const candidateSkill = candidateById.get(skillId);

      return (
        currentSkill !== undefined &&
        candidateSkill !== undefined &&
        (
          skillSignature(currentSkill) !== skillSignature(candidateSkill) ||
          changedFilesIncludeSkill(options.changedFiles, currentSkill.relativePath) ||
          changedFilesIncludeSkill(options.changedFiles, candidateSkill.relativePath)
        )
      );
    })
    .sort();

  return {addedSkillIds, removedSkillIds, changedSkillIds};
}

function skillSignature(skill: DiscoveredSkill): string {
  return JSON.stringify({
    id: skill.id,
    title: skill.title,
    description: skill.description,
    supportedAgents: [...skill.supportedAgents].sort(),
    tags: [...skill.tags].sort(),
    relativePath: skill.relativePath,
    frontmatter: skill.frontmatter
  });
}

function changedFilesIncludeSkill(changedFiles: string[], relativePath: string): boolean {
  const normalizedRelativePath = relativePath.split(path.sep).join('/');
  return changedFiles.some((changedFile) =>
    changedFile === normalizedRelativePath || changedFile.startsWith(`${normalizedRelativePath}/`)
  );
}

async function readCurrentLinkTarget(currentPath: string): Promise<string | undefined> {
  const stat = await lstatIfExists(currentPath);

  if (stat?.isSymbolicLink() !== true) {
    return undefined;
  }

  const linkTarget = await fs.readlink(currentPath);
  return path.resolve(path.dirname(currentPath), linkTarget);
}

async function recordSkillpackLock(options: {
  config: SkillpackConfig;
  managerStateDir: string;
  commitHash: string;
  dirty: boolean;
  activeRevisionPath?: string;
  remoteCommitHash?: string;
  updateAvailable?: boolean;
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
      ...(options.activeRevisionPath === undefined ? {} : {activeRevisionPath: options.activeRevisionPath}),
      ...(options.remoteCommitHash === undefined ? {} : {remoteCommitHash: options.remoteCommitHash}),
      ...(options.updateAvailable === undefined ? {} : {updateAvailable: options.updateAvailable}),
      dirty: options.dirty,
      recordedAt
    },
    lockOptions
  );

  return result.lockPath;
}

function normalizeSkillpackConfig(configInput: SkillpackConfig, homeDir?: string): SkillpackConfig {
  const parsedConfig = parseSkillpackConfig(configInput);

  return {
    ...parsedConfig,
    checkoutPath: resolveUserPath(parsedConfig.checkoutPath, homeDir)
  };
}

function assertSafeCommitHash(commitHash: string): string {
  const normalizedCommitHash = commitHash.trim().toLowerCase();

  if (!/^[a-f0-9]{7,64}$/.test(normalizedCommitHash)) {
    throw new Error(`Invalid commit hash for revision path: ${commitHash}`);
  }

  return normalizedCommitHash;
}

function shortCommit(commitHash: string): string {
  return commitHash.slice(0, 12);
}

async function lstatIfExists(candidatePath: string): Promise<import('node:fs').Stats | undefined> {
  try {
    return await fs.lstat(candidatePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
