import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {
  ManagerConfig,
  SkillDiscoveryResult
} from '@corvus-tools/skill-manager-core';
import {WizardCommandFooter, WizardScreen, type WizardOperations} from './WizardScreen.js';

type InputKey = {
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
};
type InputHandler = (input: string, key: InputKey) => void;

const inkState = vi.hoisted(() => ({
  inputHandler: undefined as InputHandler | undefined,
  exit: vi.fn()
}));

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();

  return {
    ...actual,
    useApp: () => ({exit: inkState.exit}),
    useInput: (handler: InputHandler) => {
      inkState.inputHandler = handler;
    }
  };
});

beforeEach(() => {
  inkState.inputHandler = undefined;
  inkState.exit.mockClear();
});

describe('Wizard back navigation', () => {
  it('goes from Update back to Skillpack with b', async () => {
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <WizardScreen
          config={configuredManager}
          configPath="/tmp/corvus/config.json"
          initialStep="update"
          onBackHome={() => {}}
          onConfigSaved={() => {}}
          operations={wizardReadOnlyOperations()}
        />
      );
      await flushPromises();
    });

    expect(collectText(renderer!.toJSON())).toContain('2. Update');

    press('b');

    const text = collectText(renderer!.toJSON());
    expect(text).toContain('1. Skillpack');
    expect(text).toContain('Returned to the Skillpack step.');
  });

  it('goes from Agents back to Update with b', async () => {
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <WizardScreen
          config={configuredManager}
          configPath="/tmp/corvus/config.json"
          initialStep="agents"
          onBackHome={() => {}}
          onConfigSaved={() => {}}
          operations={wizardReadOnlyOperations()}
        />
      );
      await flushPromises();
    });

    expect(collectText(renderer!.toJSON())).toContain('3. Agents');

    press('b');

    const text = collectText(renderer!.toJSON());
    expect(text).toContain('2. Update');
    expect(text).toContain('Returned to the Update step.');
  });

  it('shows back hints for update and agent steps', () => {
    const updateTree = create(
      <WizardCommandFooter currentStep="update" editingSkillpackField={undefined} editingTarget={false} />
    ).toJSON();
    const agentsTree = create(
      <WizardCommandFooter currentStep="agents" editingSkillpackField={undefined} editingTarget={false} />
    ).toJSON();

    expect(collectText(updateTree)).toContain('skillpack');
    expect(collectText(agentsTree)).toContain('update');
  });
});

const configuredManager: ManagerConfig = {
  version: 1,
  managerStateDir: '/tmp/corvus',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  skillpack: {
    id: 'corvus-skillpack',
    repositoryUrl: 'https://example.com/corvus.git',
    branch: 'main',
    checkoutPath: '/tmp/skillpacks/corvus/current'
  }
};

function wizardReadOnlyOperations(): Partial<WizardOperations> {
  return {
    inspectSkillpackCheckout: async (checkoutPath) => ({
      status: 'checkout-readable',
      checkoutPath,
      exists: true,
      readable: true,
      commitHash: '1111111111111111111111111111111111111111',
      dirty: false,
      dirtyFiles: [],
      message: 'Checkout exists and is readable'
    }),
    inspectSkillpackRemoteUpdate: async (config) => ({
      status: 'up-to-date',
      checkoutPath: config.checkoutPath,
      activeCommitHash: '1111111111111111111111111111111111111111',
      remoteCommitHash: '1111111111111111111111111111111111111111',
      updateAvailable: false,
      message: 'Active snapshot is up to date with main.'
    }),
    discoverSkillsFromCheckout: async (): Promise<SkillDiscoveryResult> => ({
      skills: [],
      warnings: [],
      errors: []
    })
  };
}

function press(input: string, key: InputKey = {}): void {
  act(() => {
    if (inkState.inputHandler === undefined) {
      throw new Error('No input handler registered.');
    }

    inkState.inputHandler(input, key);
  });
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

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
