import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {ZodError} from 'zod';
import {defaultConfigPath, defaultManagerStateDir} from '../paths.js';
import {createDefaultManagerConfig} from './configSchema.js';
import {ensureDefaultConfig, loadConfig, saveConfig} from './configStore.js';

let tempHome: string;

beforeEach(async () => {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'corvus-config-test-'));
});

afterEach(async () => {
  await fs.rm(tempHome, {recursive: true, force: true});
});

describe('config store', () => {
  it('creates a default config on first run', async () => {
    const result = await ensureDefaultConfig({
      homeDir: tempHome,
      now: new Date('2026-01-02T03:04:05.000Z')
    });

    expect(result.created).toBe(true);
    expect(result.managerStateDir).toBe(defaultManagerStateDir(tempHome));
    expect(result.configPath).toBe(defaultConfigPath(tempHome));
    expect(result.config).toEqual({
      version: 1,
      managerStateDir: defaultManagerStateDir(tempHome),
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-01-02T03:04:05.000Z'
    });
    await expect(fs.access(result.configPath)).resolves.toBeUndefined();
  });

  it('loads and saves a valid config', async () => {
    const managerStateDir = defaultManagerStateDir(tempHome);
    const configPath = defaultConfigPath(tempHome);
    const config = createDefaultManagerConfig({
      managerStateDir,
      now: new Date('2026-02-03T04:05:06.000Z')
    });

    await saveConfig(config, {configPath});
    const loadedConfig = await loadConfig(configPath);

    expect(loadedConfig).toEqual(config);
  });

  it('rejects invalid existing config files', async () => {
    const managerStateDir = defaultManagerStateDir(tempHome);
    const configPath = defaultConfigPath(tempHome);

    await fs.mkdir(managerStateDir, {recursive: true});
    await fs.writeFile(
      configPath,
      JSON.stringify({version: 2, managerStateDir, createdAt: 'nope', updatedAt: 'nope'}),
      'utf8'
    );

    await expect(ensureDefaultConfig({homeDir: tempHome})).rejects.toBeInstanceOf(ZodError);
  });
});
