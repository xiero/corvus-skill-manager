import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  type RegistryFetch,
  compareSemver,
  inspectManagerSelfUpdate,
  isNewerVersion
} from './managerPackageUpdate.js';

let tempHome: string;
let managerStateDir: string;

beforeEach(async () => {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'corvus-self-update-test-'));
  managerStateDir = path.join(tempHome, '.agents', 'corvus-skill-manager');
});

afterEach(async () => {
  await fs.rm(tempHome, {recursive: true, force: true});
});

describe('compareSemver', () => {
  it('orders major, minor, patch, equal, and prerelease versions', () => {
    expect(compareSemver('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareSemver('1.2.3', '1.2.2')).toBeGreaterThan(0);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('1.2.3-beta.2', '1.2.3-beta.1')).toBeGreaterThan(0);
    expect(compareSemver('1.2.3', '1.2.3-beta.1')).toBeGreaterThan(0);
    expect(isNewerVersion('1.2.3', '1.2.4')).toBe(false);
  });
});

describe('inspectManagerSelfUpdate', () => {
  it('detects a newer npm release for global installs', async () => {
    const result = await inspectManagerSelfUpdate({
      packageName: '@corvus-tools/skill-manager',
      currentVersion: '0.3.0',
      installKind: 'global',
      managerStateDir,
      now: new Date('2026-05-20T10:00:00.000Z'),
      fetch: fetchLatest('0.4.0')
    });

    expect(result).toMatchObject({
      status: 'update-available',
      updateAvailable: true,
      latestVersion: '0.4.0',
      updateCommand: 'npm install -g @corvus-tools/skill-manager@latest',
      checkedAt: '2026-05-20T10:00:00.000Z',
      fromCache: false
    });
  });

  it('reports up-to-date releases without an update command', async () => {
    const result = await inspectManagerSelfUpdate({
      packageName: '@corvus-tools/skill-manager',
      currentVersion: '0.3.0',
      installKind: 'global',
      managerStateDir,
      fetch: fetchLatest('0.3.0')
    });

    expect(result.status).toBe('up-to-date');
    expect(result.updateAvailable).toBe(false);
    expect(result.updateCommand).toBeUndefined();
  });

  it('uses a fresh cache instead of calling the registry again', async () => {
    const firstFetch = vi.fn(fetchLatest('0.5.0'));

    await inspectManagerSelfUpdate({
      packageName: '@corvus-tools/skill-manager',
      currentVersion: '0.3.0',
      installKind: 'global',
      managerStateDir,
      now: new Date('2026-05-20T10:00:00.000Z'),
      fetch: firstFetch
    });

    const secondFetch = vi.fn(fetchLatest('0.6.0'));
    const cached = await inspectManagerSelfUpdate({
      packageName: '@corvus-tools/skill-manager',
      currentVersion: '0.3.0',
      installKind: 'global',
      managerStateDir,
      now: new Date('2026-05-20T11:00:00.000Z'),
      fetch: secondFetch
    });

    expect(cached.latestVersion).toBe('0.5.0');
    expect(cached.fromCache).toBe(true);
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it('soft-fails and caches registry errors', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('network unavailable');
    });

    const failed = await inspectManagerSelfUpdate({
      packageName: '@corvus-tools/skill-manager',
      currentVersion: '0.3.0',
      installKind: 'global',
      managerStateDir,
      now: new Date('2026-05-20T10:00:00.000Z'),
      fetch
    });

    expect(failed.status).toBe('check-failed');
    expect(failed.message).toContain('network unavailable');

    const cachedFailure = await inspectManagerSelfUpdate({
      packageName: '@corvus-tools/skill-manager',
      currentVersion: '0.3.0',
      installKind: 'global',
      managerStateDir,
      now: new Date('2026-05-20T11:00:00.000Z'),
      fetch
    });

    expect(cachedFailure.status).toBe('check-failed');
    expect(cachedFailure.fromCache).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not check npm for non-global install contexts', async () => {
    const fetch = vi.fn(fetchLatest('0.4.0'));
    const result = await inspectManagerSelfUpdate({
      packageName: '@corvus-tools/skill-manager',
      currentVersion: '0.3.0',
      installKind: 'npx',
      managerStateDir,
      fetch
    });

    expect(result.status).toBe('unsupported-install');
    expect(result.updateAvailable).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

function fetchLatest(version: string): RegistryFetch {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      'dist-tags': {
        latest: version
      }
    })
  });
}
