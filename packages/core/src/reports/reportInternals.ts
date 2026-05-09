import {promises as fs} from 'node:fs';
import path from 'node:path';
import {ZodError} from 'zod';
import type {AgentAdapter, AgentId} from '../agents/AgentAdapter.js';
import {getAgentAdapters} from '../agents/adapters.js';
import type {ManagerConfig} from '../config/configSchema.js';
import {loadConfig} from '../config/configStore.js';
import type {GitRunner} from '../git/gitRunner.js';
import {inspectSkillpackCheckout} from '../git/skillpackSetup.js';
import type {LinkPlan, TargetState} from '../links/linkPlan.js';
import {generateLinkPlan} from '../links/linkPlan.js';
import type {ManagerLock} from '../lock/lockSchema.js';
import {loadLock} from '../lock/lockStore.js';
import type {ManagerManifest} from '../manifest/manifestSchema.js';
import {createEmptyManagerManifest} from '../manifest/manifestSchema.js';
import {loadManifest} from '../manifest/manifestStore.js';
import {
  configFileName,
  defaultManagerStateDir,
  lockFileName,
  manifestFileName,
  resolveUserPath
} from '../paths.js';
import type {SkillDiscoveryResult} from '../skills/skillDiscovery.js';
import {discoverSkillsFromCheckout} from '../skills/skillDiscovery.js';

export interface ReportOptions {
  homeDir?: string;
  managerStateDir?: string;
  configPath?: string;
  git?: GitRunner;
}

export interface ReportContext {
  homeDir?: string;
  configPath: string;
  managerStateDir: string;
  configExists: boolean;
  config?: ManagerConfig;
  configError?: string;
  lockPath: string;
  lock?: ManagerLock;
  lockError?: string;
  manifestPath: string;
  manifest: ManagerManifest;
  manifestExists: boolean;
  manifestValid: boolean;
  manifestError?: string;
  adapters: AgentAdapter[];
  checkout?: Awaited<ReturnType<typeof inspectSkillpackCheckout>>;
  discovery?: SkillDiscoveryResult;
  plan?: LinkPlan;
  targetStates: TargetState[];
}

export async function buildReportContext(options: ReportOptions = {}): Promise<ReportContext> {
  const homeDir = options.homeDir;
  const fallbackManagerStateDir = resolveUserPath(
    options.managerStateDir ?? (homeDir === undefined ? defaultManagerStateDir() : defaultManagerStateDir(homeDir)),
    homeDir
  );
  const configPath = resolveUserPath(options.configPath ?? path.join(fallbackManagerStateDir, configFileName), homeDir);
  const configLoad = await readConfig(configPath);
  const managerStateDir = configLoad.config?.managerStateDir ?? fallbackManagerStateDir;
  const lockPath = path.join(managerStateDir, lockFileName);
  const manifestPath = path.join(managerStateDir, manifestFileName);
  const lockLoad = await readLock(lockPath);
  const manifestLoad = await readManifest(manifestPath);
  const context: ReportContext = {
    ...(homeDir === undefined ? {} : {homeDir}),
    configPath,
    managerStateDir,
    configExists: configLoad.exists,
    ...(configLoad.config === undefined ? {} : {config: configLoad.config}),
    ...(configLoad.error === undefined ? {} : {configError: configLoad.error}),
    lockPath,
    ...(lockLoad.lock === undefined ? {} : {lock: lockLoad.lock}),
    ...(lockLoad.error === undefined ? {} : {lockError: lockLoad.error}),
    manifestPath,
    manifest: manifestLoad.manifest,
    manifestExists: manifestLoad.exists,
    manifestValid: manifestLoad.valid,
    ...(manifestLoad.error === undefined ? {} : {manifestError: manifestLoad.error}),
    adapters: getAgentAdapters(),
    targetStates: []
  };

  if (context.config?.skillpack === undefined) {
    return context;
  }

  const inspectOptions =
    options.git === undefined ?
      homeDir === undefined ? {} : {homeDir} :
      homeDir === undefined ? {git: options.git} : {homeDir, git: options.git};
  context.checkout = await inspectSkillpackCheckout(context.config.skillpack.checkoutPath, inspectOptions);

  if (context.checkout.exists) {
    context.discovery = await discoverSkillsFromCheckout(context.config.skillpack.checkoutPath);
  }

  context.targetStates = await buildTargetStates({
    config: context.config,
    adapters: context.adapters,
    manifest: context.manifest,
    ...(context.discovery === undefined ? {} : {discovery: context.discovery}),
    ...(homeDir === undefined ? {} : {homeDir})
  });
  context.plan = generateLinkPlan({
    adapters: context.adapters,
    skills: (context.discovery?.skills ?? []).map((skill) => ({
      id: skill.id,
      absolutePath: skill.absolutePath
    })),
    selections: context.adapters.map((adapter) => {
      const agentConfig = context.config?.agents?.[adapter.id];

      return {
        agentId: adapter.id,
        enabled: agentConfig?.enabled ?? false,
        ...(agentConfig?.targetPath === undefined ? {} : {targetPath: agentConfig.targetPath}),
        selectedSkillIds: agentConfig?.selectedSkillIds ?? []
      };
    }),
    ...(homeDir === undefined ? {} : {homeDir}),
    targetStates: context.targetStates
  });

  return context;
}

async function readConfig(configPath: string): Promise<{
  exists: boolean;
  config?: ManagerConfig;
  error?: string;
}> {
  try {
    return {exists: true, config: await loadConfig(configPath)};
  } catch (error) {
    if (isMissingFileError(error)) {
      return {exists: false};
    }

    return {exists: true, error: formatError(error)};
  }
}

async function readLock(lockPath: string): Promise<{lock?: ManagerLock; error?: string}> {
  try {
    return {lock: await loadLock(lockPath)};
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }

    return {error: formatError(error)};
  }
}

async function readManifest(manifestPath: string): Promise<{
  manifest: ManagerManifest;
  exists: boolean;
  valid: boolean;
  error?: string;
}> {
  try {
    return {
      manifest: await loadManifest(manifestPath),
      exists: true,
      valid: true
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        manifest: createEmptyManagerManifest(new Date('1970-01-01T00:00:00.000Z')),
        exists: false,
        valid: true
      };
    }

    return {
      manifest: createEmptyManagerManifest(new Date('1970-01-01T00:00:00.000Z')),
      exists: true,
      valid: false,
      error: formatError(error)
    };
  }
}

async function buildTargetStates(options: {
  config: ManagerConfig;
  adapters: AgentAdapter[];
  discovery?: SkillDiscoveryResult;
  manifest: ManagerManifest;
  homeDir?: string;
}): Promise<TargetState[]> {
  const states: TargetState[] = [];
  const skillsById = new Map((options.discovery?.skills ?? []).map((skill) => [skill.id, skill]));

  for (const adapter of options.adapters) {
    const agentConfig = options.config.agents?.[adapter.id];

    if (agentConfig?.enabled !== true) {
      continue;
    }

    const targetRoot = agentConfig.targetPath ?? adapter.defaultTargetPath;

    if (targetRoot === undefined || targetRoot.trim() === '') {
      continue;
    }

    const resolvedTargetRoot = resolveUserPath(targetRoot, options.homeDir);

    for (const skillId of agentConfig.selectedSkillIds) {
      if (!skillsById.has(skillId)) {
        continue;
      }

      const targetPath = path.join(resolvedTargetRoot, skillId);
      states.push(await inspectTargetState(targetPath, options.manifest));
    }
  }

  return states;
}

async function inspectTargetState(targetPath: string, manifest: ManagerManifest): Promise<TargetState> {
  const manifestEntry = manifest.links[targetPath];

  try {
    await fs.lstat(targetPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        path: targetPath,
        exists: false,
        managed: manifestEntry !== undefined,
        ...(manifestEntry?.sourcePath === undefined ? {} : {sourcePath: manifestEntry.sourcePath})
      };
    }

    throw error;
  }

  return {
    path: targetPath,
    exists: true,
    managed: manifestEntry !== undefined,
    ...(manifestEntry?.sourcePath === undefined ? {} : {sourcePath: manifestEntry.sourcePath})
  };
}

export async function pathExists(candidatePath: string): Promise<boolean> {
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

export async function inspectLinkTarget(targetPath: string): Promise<
  | {kind: 'missing'}
  | {kind: 'not-link'}
  | {kind: 'link'; resolvedSourcePath: string; broken: boolean}
> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>;

  try {
    stat = await fs.lstat(targetPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return {kind: 'missing'};
    }

    throw error;
  }

  if (!stat.isSymbolicLink()) {
    return {kind: 'not-link'};
  }

  const linkTarget = await fs.readlink(targetPath);
  const resolvedSourcePath = path.resolve(path.dirname(targetPath), linkTarget);

  return {
    kind: 'link',
    resolvedSourcePath,
    broken: !(await pathExists(resolvedSourcePath))
  };
}

export function formatError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => {
        const issuePath = issue.path.length === 0 ? '<root>' : issue.path.join('.');
        return `${issuePath}: ${issue.message}`;
      })
      .join('; ');
  }

  return error instanceof Error ? error.message : String(error);
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
