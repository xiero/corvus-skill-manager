import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  type ManagerConfig,
  type SkillDiscoveryResult,
  defaultSkillpackCheckoutPath,
  defaultSkillpackId
} from '@corvus-tools/skill-manager-core';
import {ConfigureAgentsScreen} from './ConfigureAgentsScreen.js';
import {SkillpackSetupScreen} from './SkillpackSetupScreen.js';
import {WizardScreen, type WizardOperations} from './WizardScreen.js';

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

describe('cancelable TUI field editing', () => {
  it('cancels manual skillpack id edits with q before Home navigation', () => {
    const onBack = vi.fn();
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(
        <SkillpackSetupScreen
          config={baseConfig}
          configPath="/tmp/corvus/config.json"
          onBack={onBack}
          onConfigSaved={() => {}}
        />
      );
    });

    press('', {return: true});
    press('x');
    expect(collectText(renderer!.toJSON())).toContain(`Skillpack ID: [${defaultSkillpackId}x]`);

    press('q');
    const afterCancel = collectText(renderer!.toJSON());

    expect(onBack).not.toHaveBeenCalled();
    expect(afterCancel).toContain(`Skillpack ID: ${defaultSkillpackId}`);
    expect(afterCancel).not.toContain(`${defaultSkillpackId}x`);

    press('q');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('restores the manual active path default when editing is canceled with h', () => {
    const onBack = vi.fn();
    let renderer: ReactTestRenderer | undefined;
    const defaultCheckoutPath = defaultSkillpackCheckoutPath(defaultSkillpackId);

    act(() => {
      renderer = create(
        <SkillpackSetupScreen
          config={baseConfig}
          configPath="/tmp/corvus/config.json"
          onBack={onBack}
          onConfigSaved={() => {}}
        />
      );
    });

    press('', {downArrow: true});
    press('', {downArrow: true});
    press('', {downArrow: true});
    press('', {return: true});
    press('x');
    expect(collectText(renderer!.toJSON())).toContain(`${defaultCheckoutPath}x`);

    press('h');

    expect(onBack).not.toHaveBeenCalled();
    expect(collectText(renderer!.toJSON())).toContain(`Active path: ${defaultCheckoutPath}`);
  });

  it('keeps a manual edit when it is accepted with Enter', () => {
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(
        <SkillpackSetupScreen
          config={customSkillpackConfig}
          configPath="/tmp/corvus/config.json"
          onBack={() => {}}
          onConfigSaved={() => {}}
        />
      );
    });

    press('', {return: true});
    press('x');
    press('', {return: true});

    expect(collectText(renderer!.toJSON())).toContain('Skillpack ID: custom-packx');
  });

  it('cancels manual agent target edits with q before Home navigation', () => {
    const onBack = vi.fn();
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(
        <ConfigureAgentsScreen
          config={agentConfig}
          configPath="/tmp/corvus/config.json"
          onBack={onBack}
          onConfigSaved={() => {}}
        />
      );
    });

    press('t');
    press('x');
    expect(collectText(renderer!.toJSON())).toContain('/tmp/codex-skillsx');

    press('q');
    const afterCancel = collectText(renderer!.toJSON());

    expect(onBack).not.toHaveBeenCalled();
    expect(afterCancel).toContain('/tmp/codex-skills');
    expect(afterCancel).not.toContain('/tmp/codex-skillsx');

    press('q');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('cancels guided skillpack id edits and restores dependent default path', async () => {
    const onBackHome = vi.fn();
    let renderer: ReactTestRenderer | undefined;
    const defaultCheckoutPath = defaultSkillpackCheckoutPath(defaultSkillpackId);
    const editedCheckoutPath = defaultSkillpackCheckoutPath(`${defaultSkillpackId}x`);

    await act(async () => {
      renderer = create(
        <WizardScreen
          config={baseConfig}
          configPath="/tmp/corvus/config.json"
          onBackHome={onBackHome}
          onConfigSaved={() => {}}
          operations={wizardReadOnlyOperations()}
        />
      );
      await flushPromises();
    });

    press('', {return: true});
    press('x');
    expect(collectText(renderer!.toJSON())).toContain(`${defaultSkillpackId}x`);
    expect(collectText(renderer!.toJSON())).toContain(editedCheckoutPath);

    press('q');
    const afterCancel = collectText(renderer!.toJSON());

    expect(onBackHome).not.toHaveBeenCalled();
    expect(afterCancel).toContain(`Skillpack ID: ${defaultSkillpackId}`);
    expect(afterCancel).toContain(`Active path: ${defaultCheckoutPath}`);
    expect(afterCancel).not.toContain(`${defaultSkillpackId}x`);
  });

  it('cancels guided target edits with h before Home navigation', async () => {
    const onBackHome = vi.fn();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <WizardScreen
          config={baseConfig}
          configPath="/tmp/corvus/config.json"
          initialStep="agents"
          onBackHome={onBackHome}
          onConfigSaved={() => {}}
          operations={wizardReadOnlyOperations()}
        />
      );
      await flushPromises();
    });

    press('t');
    press('x');
    expect(collectText(renderer!.toJSON())).toContain('~/.agents/skillsx');

    press('h');
    const afterCancel = collectText(renderer!.toJSON());

    expect(onBackHome).not.toHaveBeenCalled();
    expect(afterCancel).toContain('~/.agents/skills');
    expect(afterCancel).not.toContain('~/.agents/skillsx');

    press('h');
    expect(onBackHome).toHaveBeenCalledTimes(1);
  });
});

const baseConfig: ManagerConfig = {
  version: 1,
  managerStateDir: '/tmp/corvus',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

const customSkillpackConfig: ManagerConfig = {
  ...baseConfig,
  skillpack: {
    id: 'custom-pack',
    repositoryUrl: 'https://example.com/custom.git',
    branch: 'main',
    checkoutPath: '/tmp/custom-pack/current'
  }
};

const agentConfig: ManagerConfig = {
  ...baseConfig,
  agents: {
    codex: {
      enabled: true,
      targetPath: '/tmp/codex-skills',
      selectedSkillIds: []
    }
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
