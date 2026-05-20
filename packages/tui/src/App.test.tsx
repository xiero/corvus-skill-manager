import React from 'react';
import {act, create} from 'react-test-renderer';
import {describe, expect, it, vi} from 'vitest';
import type {ManagerConfig} from '@corvus-tools/skill-manager-core';
import {App} from './App.js';

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();

  return {
    ...actual,
    useApp: () => ({exit: () => undefined}),
    useInput: () => undefined
  };
});

vi.mock('./screens/WizardScreen.js', async () => {
  const ReactModule = await import('react');

  return {
    WizardScreen: () => ReactModule.createElement('mock-wizard', null, 'Guided Flow App Shell')
  };
});

describe('App', () => {
  it('defaults to Home instead of opening the guided wizard', () => {
    const tree = create(
      <App
        initialConfigState={{
          configPath: '/tmp/corvus/config.json',
          status: 'exists',
          config
        }}
      />
    ).toJSON();

    const text = collectText(tree);

    expect(text).toContain('Corvus Skill Manager');
    expect(text).toContain('██████╗');
    expect(text).toContain('S K I L L   M A N A G E R');
    expect(text).toContain('TUI-first skill wiring for coding agents.');
    expect(text).toContain('Guided Flow');
    expect(text).not.toContain('Guided Flow App Shell');
  });

  it('shows a manager update banner for global installs when npm has a newer release', async () => {
    const inspectSelfUpdate = vi.fn(async () => ({
      packageName: '@corvus-tools/skill-manager',
      currentVersion: '0.3.0',
      installKind: 'global' as const,
      status: 'update-available' as const,
      updateAvailable: true,
      latestVersion: '0.4.0',
      updateCommand: 'npm install -g @corvus-tools/skill-manager@latest',
      checkedAt: '2026-05-20T10:00:00.000Z',
      fromCache: false,
      message: 'A newer Corvus Skill Manager release is available: 0.3.0 -> 0.4.0.'
    }));
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(
        <App
          initialConfigState={{
            configPath: '/tmp/corvus/config.json',
            status: 'exists',
            config
          }}
          managerPackage={{
            packageName: '@corvus-tools/skill-manager',
            currentVersion: '0.3.0',
            installKind: 'global'
          }}
          inspectSelfUpdate={inspectSelfUpdate}
        />
      );
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    });

    const text = collectText(renderer!.toJSON());

    expect(inspectSelfUpdate).toHaveBeenCalledWith({
      packageName: '@corvus-tools/skill-manager',
      currentVersion: '0.3.0',
      installKind: 'global',
      managerStateDir: '/tmp/corvus'
    });
    expect(text).toContain('Manager update available: 0.3.0 -> 0.4.0');
    expect(text).toContain('npm install -g @corvus-tools/skill-manager@latest');
  });

  it('does not run the self-update checker for npx installs', () => {
    const inspectSelfUpdate = vi.fn(async () => {
      throw new Error('must not be called');
    });

    create(
      <App
        initialConfigState={{
          configPath: '/tmp/corvus/config.json',
          status: 'exists',
          config
        }}
        managerPackage={{
          packageName: '@corvus-tools/skill-manager',
          currentVersion: '0.3.0',
          installKind: 'npx'
        }}
        inspectSelfUpdate={inspectSelfUpdate}
      />
    );

    expect(inspectSelfUpdate).not.toHaveBeenCalled();
  });
});

const config: ManagerConfig = {
  version: 1,
  managerStateDir: '/tmp/corvus',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

function collectText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(collectText).join('');
  }

  if (typeof node === 'object' && 'children' in node) {
    const children = (node as {children?: unknown}).children;
    return collectText(children);
  }

  return '';
}
