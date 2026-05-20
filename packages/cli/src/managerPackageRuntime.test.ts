import {describe, expect, it} from 'vitest';
import {detectManagerInstallKind} from './managerPackageRuntime.js';

describe('detectManagerInstallKind', () => {
  it('classifies source runs as development', () => {
    expect(
      detectManagerInstallKind({
        entryPath: '/repo/packages/cli/src/index.ts',
        cwd: '/repo',
        env: {}
      })
    ).toBe('development');
  });

  it('classifies npm exec temp installs as npx', () => {
    expect(
      detectManagerInstallKind({
        entryPath: '/home/user/.npm/_npx/abc/node_modules/@corvus-tools/skill-manager/dist/index.js',
        cwd: '/work',
        env: {}
      })
    ).toBe('npx');
  });

  it('does not treat a local project node_modules binary as global', () => {
    expect(
      detectManagerInstallKind({
        entryPath: '/work/node_modules/@corvus-tools/skill-manager/dist/index.js',
        cwd: '/work',
        env: {}
      })
    ).toBe('unknown');
  });

  it('classifies package paths outside cwd as global when they are not npx-like', () => {
    expect(
      detectManagerInstallKind({
        entryPath: '/usr/local/lib/node_modules/@corvus-tools/skill-manager/dist/index.js',
        cwd: '/work',
        env: {}
      })
    ).toBe('global');
  });
});
