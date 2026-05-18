import React from 'react';
import {create} from 'react-test-renderer';
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
