import {promises as fs} from 'node:fs';
import path from 'node:path';
import {
  assertPathInside,
  configFileName,
  defaultConfigPath,
  defaultManagerStateDir,
  defaultSkillpackCheckoutPath,
  defaultSkillpackRootPath,
  resolveUserPath
} from '../paths.js';
import {
  defaultSkillpackId,
  defaultSkillpackRepositoryUrl
} from '../skillpackDefaults.js';
import {
  type ManagerConfig,
  createDefaultManagerConfig,
  parseManagerConfig
} from './configSchema.js';

export interface ConfigStoreOptions {
  homeDir?: string;
  managerStateDir?: string;
  configPath?: string;
  now?: Date;
}

export interface ConfigLoadResult {
  config: ManagerConfig;
  configPath: string;
  managerStateDir: string;
  created: boolean;
  migrated: boolean;
}

interface ConfigMigrationResult {
  config: ManagerConfig;
  migrated: boolean;
}

function resolveStorePaths(options: ConfigStoreOptions = {}): {
  managerStateDir: string;
  configPath: string;
} {
  const homeDir = options.homeDir;
  const managerStateDir = resolveUserPath(
    options.managerStateDir ?? (homeDir === undefined ? defaultManagerStateDir() : defaultManagerStateDir(homeDir)),
    homeDir
  );
  const configPath = resolveUserPath(
    options.configPath ?? path.join(managerStateDir, configFileName),
    homeDir
  );

  assertPathInside(managerStateDir, configPath);

  return {managerStateDir, configPath};
}

export async function loadConfig(configPath: string): Promise<ManagerConfig> {
  const rawConfig = await fs.readFile(configPath, 'utf8');
  return parseManagerConfig(JSON.parse(rawConfig));
}

export async function saveConfig(
  config: ManagerConfig,
  options: Pick<ConfigStoreOptions, 'configPath'> = {}
): Promise<void> {
  const explicitLegacySkillpack = Object.prototype.propertyIsEnumerable.call(config, 'skillpack')
    ? config.skillpack
    : undefined;
  const configWithoutAlias = {...config};
  delete configWithoutAlias.skillpack;
  const parsedConfig = parseManagerConfig(
    explicitLegacySkillpack === undefined
      ? configWithoutAlias
      : {
          ...configWithoutAlias,
          version: 3,
          skillpacks: {...config.skillpacks, [explicitLegacySkillpack.id]: explicitLegacySkillpack}
        }
  );
  const configPath = resolveUserPath(
    options.configPath ?? path.join(parsedConfig.managerStateDir, configFileName)
  );

  assertPathInside(parsedConfig.managerStateDir, configPath);
  await fs.mkdir(path.dirname(configPath), {recursive: true});
  const persisted = {
    version: 3 as const,
    managerStateDir: parsedConfig.managerStateDir,
    createdAt: parsedConfig.createdAt,
    updatedAt: parsedConfig.updatedAt,
    skillpacks: parsedConfig.skillpacks,
    ...(parsedConfig.agents === undefined ? {} : {agents: parsedConfig.agents})
  };
  await fs.writeFile(configPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
}

export async function ensureDefaultConfig(options: ConfigStoreOptions = {}): Promise<ConfigLoadResult> {
  const {managerStateDir, configPath} = resolveStorePaths(options);

  try {
    const config = await loadConfig(configPath);
    const migrationOptions: Pick<ConfigStoreOptions, 'homeDir' | 'now'> = {};

    if (options.homeDir !== undefined) {
      migrationOptions.homeDir = options.homeDir;
    }

    if (options.now !== undefined) {
      migrationOptions.now = options.now;
    }

    const migration = migrateLoadedConfig(config, migrationOptions);

    if (migration.migrated) {
      await saveConfig(migration.config, {configPath});
    }

    return {config: migration.config, configPath, managerStateDir, created: false, migrated: migration.migrated};
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const config = createDefaultManagerConfig(
    options.now === undefined
      ? {managerStateDir, ...(options.homeDir === undefined ? {} : {homeDir: options.homeDir})}
      : {managerStateDir, now: options.now, ...(options.homeDir === undefined ? {} : {homeDir: options.homeDir})}
  );
  await saveConfig(config, {configPath});
  return {config, configPath, managerStateDir, created: true, migrated: false};
}

export function migrateLoadedConfig(
  config: ManagerConfig,
  options: Pick<ConfigStoreOptions, 'homeDir' | 'now'> = {}
): ConfigMigrationResult {
  const explicitSkillpack = Object.prototype.propertyIsEnumerable.call(config, 'skillpack')
    ? config.skillpack
    : undefined;
  const defaultSkillpack = (explicitSkillpack?.id === defaultSkillpackId ? explicitSkillpack : undefined) ??
    config.skillpacks?.[defaultSkillpackId] ??
    (config.skillpack?.id === defaultSkillpackId ? config.skillpack : undefined);

  if (defaultSkillpack === undefined) return {config, migrated: false};

  const legacyCheckoutPath = path.join(resolveUserPath(config.managerStateDir, options.homeDir), 'skills');
  const legacyFlatSkillpackPath = path.join(defaultSkillpackRootPath(defaultSkillpack.id, options.homeDir), 'repo');
  const configuredCheckoutPath = resolveUserPath(defaultSkillpack.checkoutPath, options.homeDir);
  const shouldMigrateLegacyDefaultSkillpack =
    defaultSkillpack.repositoryUrl === defaultSkillpackRepositoryUrl &&
    (configuredCheckoutPath === legacyCheckoutPath || configuredCheckoutPath === legacyFlatSkillpackPath);

  if (!shouldMigrateLegacyDefaultSkillpack) {
    return {config, migrated: false};
  }

  const nextConfig: ManagerConfig = {
    ...config,
    updatedAt: (options.now ?? new Date()).toISOString(),
    skillpacks: {
      ...config.skillpacks,
      [defaultSkillpackId]: {
        ...defaultSkillpack,
        checkoutPath: defaultSkillpackCheckoutPath(defaultSkillpack.id, options.homeDir)
      }
    }
  };

  Object.defineProperty(nextConfig, 'skillpack', {
    value: nextConfig.skillpacks?.[defaultSkillpackId],
    enumerable: false,
    configurable: true,
    writable: true
  });

  return {config: nextConfig, migrated: true};
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
