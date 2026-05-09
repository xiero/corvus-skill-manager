import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {ZodError} from 'zod';
import {defaultConfigPath, defaultManagerStateDir, defaultSkillpackCheckoutPath} from '../paths.js';
import {defaultSkillpackBranch, defaultSkillpackId, defaultSkillpackRepositoryUrl} from '../skillpackDefaults.js';
import {createDefaultManagerConfig, parseManagerConfig} from './configSchema.js';
import {ensureDefaultConfig, loadConfig, migrateLoadedConfig, saveConfig} from './configStore.js';

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
    expect(result.migrated).toBe(false);
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

  it('migrates the legacy default skillpack checkout out of manager state', async () => {
    const managerStateDir = defaultManagerStateDir(tempHome);
    const configPath = defaultConfigPath(tempHome);
    const config = createDefaultManagerConfig({
      managerStateDir,
      now: new Date('2026-02-03T04:05:06.000Z')
    });

    await saveConfig(
      {
        ...config,
        skillpack: {
          id: defaultSkillpackId,
          repositoryUrl: defaultSkillpackRepositoryUrl,
          branch: defaultSkillpackBranch,
          checkoutPath: path.join(managerStateDir, 'skills')
        }
      },
      {configPath}
    );

    const result = await ensureDefaultConfig({
      homeDir: tempHome,
      now: new Date('2026-03-04T05:06:07.000Z')
    });
    const savedConfig = await loadConfig(configPath);

    expect(result.created).toBe(false);
    expect(result.migrated).toBe(true);
    expect(result.config.skillpack?.checkoutPath).toBe(defaultSkillpackCheckoutPath(defaultSkillpackId, tempHome));
    expect(result.config.updatedAt).toBe('2026-03-04T05:06:07.000Z');
    expect(savedConfig).toEqual(result.config);
  });

  it('does not migrate custom skillpack checkout paths', () => {
    const managerStateDir = defaultManagerStateDir(tempHome);
    const config = createDefaultManagerConfig({
      managerStateDir,
      now: new Date('2026-02-03T04:05:06.000Z')
    });

    const migration = migrateLoadedConfig({
      ...config,
      skillpack: {
        id: defaultSkillpackId,
        repositoryUrl: 'https://example.test/custom.git',
        branch: defaultSkillpackBranch,
        checkoutPath: path.join(managerStateDir, 'skills')
      }
    });

    expect(migration.migrated).toBe(false);
    expect(migration.config.skillpack?.checkoutPath).toBe(path.join(managerStateDir, 'skills'));
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

  it('allows agent config without a target path override', () => {
    const managerStateDir = defaultManagerStateDir(tempHome);
    const config = createDefaultManagerConfig({
      managerStateDir,
      now: new Date('2026-02-03T04:05:06.000Z')
    });

    expect(
      parseManagerConfig({
        ...config,
        agents: {
          custom: {
            enabled: false,
            selectedSkillIds: []
          },
          gemini: {
            enabled: false,
            selectedSkillIds: []
          }
        }
      })
    ).toMatchObject({
      agents: {
        custom: {
          enabled: false,
          selectedSkillIds: []
        },
        gemini: {
          enabled: false,
          selectedSkillIds: []
        }
      }
    });
  });

  it('rejects blank agent target path overrides', () => {
    const managerStateDir = defaultManagerStateDir(tempHome);
    const config = createDefaultManagerConfig({
      managerStateDir,
      now: new Date('2026-02-03T04:05:06.000Z')
    });

    expect(() =>
      parseManagerConfig({
        ...config,
        agents: {
          custom: {
            enabled: false,
            targetPath: '',
            selectedSkillIds: []
          }
        }
      })
    ).toThrow(ZodError);
  });
});
