import {promises as fs} from 'node:fs';
import path from 'node:path';
import {
  assertPathInside,
  configFileName,
  defaultConfigPath,
  defaultManagerStateDir,
  defaultSkillpackCheckoutPath,
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
  const parsedConfig = parseManagerConfig(config);
  const configPath = resolveUserPath(
    options.configPath ?? path.join(parsedConfig.managerStateDir, configFileName)
  );

  assertPathInside(parsedConfig.managerStateDir, configPath);
  await fs.mkdir(path.dirname(configPath), {recursive: true});
  await fs.writeFile(configPath, `${JSON.stringify(parsedConfig, null, 2)}\n`, 'utf8');
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
    options.now === undefined ? {managerStateDir} : {managerStateDir, now: options.now}
  );
  await saveConfig(config, {configPath});
  return {config, configPath, managerStateDir, created: true, migrated: false};
}

export function migrateLoadedConfig(
  config: ManagerConfig,
  options: Pick<ConfigStoreOptions, 'homeDir' | 'now'> = {}
): ConfigMigrationResult {
  if (config.skillpack === undefined) {
    return {config, migrated: false};
  }

  const legacyCheckoutPath = path.join(resolveUserPath(config.managerStateDir, options.homeDir), 'skills');
  const configuredCheckoutPath = resolveUserPath(config.skillpack.checkoutPath, options.homeDir);
  const shouldMigrateLegacyDefaultSkillpack =
    config.skillpack.id === defaultSkillpackId &&
    config.skillpack.repositoryUrl === defaultSkillpackRepositoryUrl &&
    configuredCheckoutPath === legacyCheckoutPath;

  if (!shouldMigrateLegacyDefaultSkillpack) {
    return {config, migrated: false};
  }

  const nextConfig: ManagerConfig = {
    ...config,
    updatedAt: (options.now ?? new Date()).toISOString(),
    skillpack: {
      ...config.skillpack,
      checkoutPath: defaultSkillpackCheckoutPath(config.skillpack.id, options.homeDir)
    }
  };

  return {config: nextConfig, migrated: true};
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
