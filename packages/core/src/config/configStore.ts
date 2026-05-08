import {promises as fs} from 'node:fs';
import path from 'node:path';
import {
  assertPathInside,
  configFileName,
  defaultConfigPath,
  defaultManagerStateDir,
  resolveUserPath
} from '../paths.js';
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
    return {config, configPath, managerStateDir, created: false};
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const config = createDefaultManagerConfig(
    options.now === undefined ? {managerStateDir} : {managerStateDir, now: options.now}
  );
  await saveConfig(config, {configPath});
  return {config, configPath, managerStateDir, created: true};
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
