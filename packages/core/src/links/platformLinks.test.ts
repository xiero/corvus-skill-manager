import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {resolveActiveLinkTarget} from '../git/skillpackSetup.js';
import {managedLinkSymlinkType, resolveManagedLinkType} from './applyEngine.js';

/**
 * Cross-platform link semantics, exercised on a single host by injecting the platform. Direct
 * execution on Windows is unavailable in CI, so these assert the decisions rather than the
 * syscalls.
 */
describe('managed link type', () => {
  it('uses a junction only for a directory source on Windows', () => {
    expect(resolveManagedLinkType('win32', true)).toBe('junction');
    expect(resolveManagedLinkType('win32', false)).toBe('symlink');
    expect(resolveManagedLinkType('linux', true)).toBe('symlink');
    expect(resolveManagedLinkType('darwin', true)).toBe('symlink');
  });

  it('maps the managed link type to the fs.symlink type argument', () => {
    expect(managedLinkSymlinkType('junction')).toBe('junction');
    expect(managedLinkSymlinkType('symlink')).toBe('dir');
  });

  it('records a link type that round-trips through the manifest schema values', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as NodeJS.Platform[]) {
      expect(['symlink', 'junction']).toContain(resolveManagedLinkType(platform, true));
    }
  });
});

describe('active skillpack link target', () => {
  const currentPath = path.join('/home/user/.agents/skillpacks/corvus-skillpack', 'current');
  const repoPath = path.join(
    '/home/user/.agents/skillpacks/corvus-skillpack',
    'revisions',
    'abc123',
    'repo'
  );

  it('uses a relative target on POSIX so the skillpack tree stays relocatable', () => {
    const resolved = resolveActiveLinkTarget({platform: 'linux', currentPath, repoPath});

    expect(resolved.linkType).toBe('dir');
    expect(path.isAbsolute(resolved.linkTarget)).toBe(false);
    expect(path.resolve(path.dirname(currentPath), resolved.linkTarget)).toBe(repoPath);
  });

  it('uses an absolute junction target on Windows', () => {
    const resolved = resolveActiveLinkTarget({platform: 'win32', currentPath, repoPath});

    expect(resolved.linkType).toBe('junction');
    expect(resolved.linkTarget).toBe(repoPath);
  });

  it('always resolves to the same revision snapshot on either platform', () => {
    const posix = resolveActiveLinkTarget({platform: 'darwin', currentPath, repoPath});
    const windows = resolveActiveLinkTarget({platform: 'win32', currentPath, repoPath});

    expect(path.resolve(path.dirname(currentPath), posix.linkTarget)).toBe(
      path.resolve(path.dirname(currentPath), windows.linkTarget)
    );
  });
});
