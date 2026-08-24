import {promises as fs} from 'node:fs';
import path from 'node:path';
import {ZodError} from 'zod';
import type {AgentAdapter, AgentId} from '../agents/AgentAdapter.js';
import {getAgentAdapters} from '../agents/adapters.js';
import {
  type ManagerConfig,
  type SkillpackConfig,
  getSkillpacks,
  parseSkillReference,
  qualifySkillId
} from '../config/configSchema.js';
import {loadConfig} from '../config/configStore.js';
import type {GitRunner} from '../git/gitRunner.js';
import {inspectSkillpackCheckout, inspectSkillpackRemoteUpdate} from '../git/skillpackSetup.js';
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
  checkRemote?: boolean;
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
  skillpacks: SkillpackReportContext[];
  checkout?: Awaited<ReturnType<typeof inspectSkillpackCheckout>>;
  remoteUpdate?: Awaited<ReturnType<typeof inspectSkillpackRemoteUpdate>>;
  discovery?: SkillDiscoveryResult;
  plan?: LinkPlan;
  targetStates: TargetState[];
}

export interface SkillpackReportContext {
  config: SkillpackConfig;
  checkout: Awaited<ReturnType<typeof inspectSkillpackCheckout>>;
  remoteUpdate?: Awaited<ReturnType<typeof inspectSkillpackRemoteUpdate>>;
  discovery?: SkillDiscoveryResult;
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
    skillpacks: [],
    targetStates: []
  };

  const configuredSkillpacks = getSkillpacks(context.config);

  if (configuredSkillpacks.length === 0) {
    return context;
  }

  const inspectOptions =
    options.git === undefined ?
      homeDir === undefined ? {} : {homeDir} :
      homeDir === undefined ? {git: options.git} : {homeDir, git: options.git};
  for (const skillpack of configuredSkillpacks) {
    const checkout = await inspectSkillpackCheckout(skillpack.checkoutPath, inspectOptions);
    const packContext: SkillpackReportContext = {config: skillpack, checkout};

    if (options.checkRemote === true) {
      packContext.remoteUpdate = await inspectSkillpackRemoteUpdate(skillpack, inspectOptions);
    }

    if (checkout.exists && checkout.readable) {
      packContext.discovery = qualifyDiscovery(
        skillpack.id,
        await discoverSkillsFromCheckout(skillpack.checkoutPath)
      );
    }

    context.skillpacks.push(packContext);
  }

  const primary = context.skillpacks.find((item) => item.config.id === 'corvus-skillpack') ?? context.skillpacks[0];
  if (primary !== undefined) {
    context.checkout = primary.checkout;
    if (primary.remoteUpdate !== undefined) context.remoteUpdate = primary.remoteUpdate;
  }
  const aggregateDiscovery = aggregateDiscoveries(context.skillpacks);
  if (aggregateDiscovery !== undefined) context.discovery = aggregateDiscovery;

  context.targetStates = await buildTargetStates({
    config: context.config!,
    adapters: context.adapters,
    manifest: context.manifest,
    ...(context.discovery === undefined ? {} : {discovery: context.discovery}),
    ...(homeDir === undefined ? {} : {homeDir})
  });
  context.plan = generateLinkPlan({
    adapters: context.adapters,
    skills: (context.discovery?.skills ?? []).map((skill) => ({
      id: skill.ref ?? skill.id,
      targetName: skill.id,
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
  const skillsById = new Map((options.discovery?.skills ?? []).map((skill) => [skill.ref ?? skill.id, skill]));

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

      const targetPath = path.join(resolvedTargetRoot, skillsById.get(skillId)?.id ?? parseSkillReference(skillId)?.skillId ?? skillId);
      states.push(await inspectTargetState(targetPath, options.manifest));
    }
  }

  return states;
}

function qualifyDiscovery(skillpackId: string, discovery: SkillDiscoveryResult): SkillDiscoveryResult {
  return {
    ...discovery,
    skills: discovery.skills.map((skill) => ({
      ...skill,
      skillpackId,
      ref: qualifySkillId(skillpackId, skill.id),
      requires: skill.requires.map((id) => qualifySkillId(skillpackId, id)),
      recommends: skill.recommends.map((id) => qualifySkillId(skillpackId, id)),
      conflictsWith: skill.conflictsWith.map((id) => qualifySkillId(skillpackId, id))
    })),
    bundles: discovery.bundles.map((bundle) => ({
      ...bundle,
      skillpackId,
      ref: qualifySkillId(skillpackId, bundle.id),
      members: bundle.members.map((member) => ({
        ...member,
        ref: qualifySkillId(skillpackId, member.id)
      }))
    }))
  };
}

function aggregateDiscoveries(skillpacks: readonly SkillpackReportContext[]): SkillDiscoveryResult | undefined {
  const ready = skillpacks.filter((item) => item.discovery !== undefined);

  if (ready.length === 0) return undefined;

  return {
    skillpackRoot: ready.length === 1 ? ready[0]!.discovery!.skillpackRoot : '(multiple skillpacks)',
    registryPath: ready.length === 1 ? ready[0]!.discovery!.registryPath : '(multiple registries)',
    source: ready.every((item) => item.discovery?.source === 'registry') ? 'registry' : 'registryless',
    ...(ready.length === 1 && ready[0]!.discovery!.registryVersion !== undefined
      ? {registryVersion: ready[0]!.discovery!.registryVersion}
      : {}),
    registryCounts: {
      skillCount: ready.reduce(
        (total, item) =>
          total + (item.discovery?.registryCounts?.skillCount ?? item.discovery?.skills.length ?? 0),
        0
      ),
      versionedSkillCount: ready.reduce(
        (total, item) => total + (item.discovery?.registryCounts?.versionedSkillCount ?? 0),
        0
      ),
      bundleCount: ready.reduce(
        (total, item) => total + (item.discovery?.registryCounts?.bundleCount ?? 0),
        0
      ),
      validBundleMembershipCount: ready.reduce(
        (total, item) => total + (item.discovery?.registryCounts?.validBundleMembershipCount ?? 0),
        0
      )
    },
    skills: ready.flatMap((item) => item.discovery?.skills ?? []).sort((left, right) =>
      (left.ref ?? left.id).localeCompare(right.ref ?? right.id)
    ),
    bundles: ready.flatMap((item) => item.discovery?.bundles ?? []).sort((left, right) =>
      (left.ref ?? left.id).localeCompare(right.ref ?? right.id)
    ),
    warnings: [
      ...ready.flatMap((item) => item.discovery?.warnings ?? []),
      ...skillpacks
        .filter((item) => !item.checkout.readable || item.discovery === undefined)
        .map((item) => ({
          severity: 'warning' as const,
          code: 'skillpack-not-ready',
          message: `Skillpack "${item.config.id}" is not available to the aggregate catalog: ${item.checkout.message}.`,
          path: item.config.checkoutPath
        }))
    ],
    errors: ready.flatMap((item) => item.discovery?.errors ?? []),
    skillpacks: skillpacks.map((item) => ({
      id: item.config.id,
      checkoutPath: item.config.checkoutPath,
      ready: item.checkout.readable && item.discovery !== undefined,
      ...(item.discovery?.registryPath === undefined ? {} : {registryPath: item.discovery.registryPath}),
      skillCount: item.discovery?.skills.length ?? 0,
      bundleCount: item.discovery?.bundles.length ?? 0,
      warningCount: item.discovery?.warnings.length ?? 0,
      errorCount: item.discovery?.errors.length ?? 0,
      ...(!item.checkout.readable ? {message: item.checkout.message} : {})
    }))
  };
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
