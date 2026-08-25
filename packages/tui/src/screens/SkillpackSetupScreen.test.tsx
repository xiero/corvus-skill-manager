import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  type CorvusApplication,
  type ManagerConfig,
  defaultSkillpackCheckoutPath,
  defaultSkillpackId,
  defaultSkillpackRepositoryUrl
} from '@corvus-tools/skill-manager-core';
import {CorvusApplicationContext} from '../application/applicationContext.js';
import {SkillpackSetupScreen, suggestSkillpackId} from './SkillpackSetupScreen.js';

type InputKey = {
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  escape?: boolean;
};
type InputHandler = (input: string, key: InputKey) => void;

const inkState = vi.hoisted(() => ({inputHandler: undefined as InputHandler | undefined}));

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: (handler: InputHandler) => {
      inkState.inputHandler = handler;
    }
  };
});

beforeEach(() => {
  inkState.inputHandler = undefined;
});

describe('SkillpackSetupScreen repository manager', () => {
  it('separates the protected default from additional repositories without relying on color', async () => {
    const renderer = await renderScreen();
    const text = collectText(renderer.toJSON());

    expect(text).toContain('DEFAULT REPOSITORY');
    expect(text).toContain('corvus-skillpack [DEFAULT] [PROTECTED]');
    expect(text).toContain('ADDITIONAL REPOSITORIES');
    expect(text).toContain('team-skills [ADDITIONAL]');
    expect(text).toContain('+ Add repository');
  });

  it('uses a URL-first add flow and shows generated values before preview', async () => {
    const renderer = await renderScreen();

    press('a');
    press('', {return: true});
    press('https://github.com/acme/review-tools.git');
    press('', {return: true});

    const text = collectText(renderer.toJSON());
    expect(text).toContain('Generated ID: review-tools');
    expect(text).toContain(`Active path: ${defaultSkillpackCheckoutPath('review-tools')}`);
    expect(text).toContain('Advanced settings');
  });

  it('keeps repository ids read-only after registration and omits remove for the default', async () => {
    const renderer = await renderScreen();

    press('', {return: true});
    expect(collectText(renderer.toJSON())).toContain('[DEFAULT] [PROTECTED]');
    expect(collectText(renderer.toJSON())).not.toContain('Remove registration');
    press('b');
    press('', {downArrow: true});
    press('', {return: true});
    expect(collectText(renderer.toJSON())).toContain('Remove registration');
    press('e');

    const editText = collectText(renderer.toJSON());
    expect(editText).toContain('Repository ID: team-skills [READ ONLY]');
    expect(editText).toContain('cannot be changed');
  });

  it('previews and applies addition through the shared application layer', async () => {
    const onConfigSaved = vi.fn();
    const application = fakeApplication();
    const renderer = await renderScreen(application, onConfigSaved);

    press('a');
    press('', {return: true});
    press('https://github.com/acme/review-tools.git');
    press('', {return: true});
    press('', {downArrow: true});
    press('', {downArrow: true});
    press('', {return: true});
    await flushPromises();

    expect(application.skillpackSetupPlan).toHaveBeenCalledWith({
      skillpackId: 'review-tools',
      repositoryUrl: 'https://github.com/acme/review-tools.git',
      branch: 'main',
      checkoutPath: defaultSkillpackCheckoutPath('review-tools')
    });
    expect(collectText(renderer.toJSON())).toContain('ADD ADDITIONAL REPOSITORY');
    expect(collectText(renderer.toJSON())).toContain('Type: ADDITIONAL');

    press('a');
    await flushPromises();

    expect(application.skillpackSetupApply).toHaveBeenCalledWith({planId: 'setup-plan-1', confirm: 'setup-plan-1'});
    expect(onConfigSaved).toHaveBeenCalledTimes(1);
    const saved = onConfigSaved.mock.calls[0]?.[0] as ManagerConfig;
    expect(saved.skillpacks?.['review-tools']?.repositoryUrl).toBe('https://github.com/acme/review-tools.git');
    expect(collectText(renderer.toJSON())).toContain('Initial revision snapshot active.');
  });

  it('blocks an advanced add form from reusing an existing repository id', async () => {
    const application = fakeApplication();
    const renderer = await renderScreen(application);

    press('a');
    press('', {return: true});
    press('https://github.com/acme/new-source.git');
    press('', {return: true});
    press('v');
    press('', {downArrow: true});
    press('', {return: true});
    press('u', {ctrl: true});
    press('team-skills');
    press('', {return: true});
    for (let index = 0; index < 4; index += 1) press('', {downArrow: true});
    press('', {return: true});

    expect(collectText(renderer.toJSON())).toContain('Repository ID "team-skills" is already configured.');
    expect(application.skillpackSetupPlan).not.toHaveBeenCalled();
  });

  it('renders core semantic update intelligence without applying from preview', async () => {
    const application = fakeApplication();
    application.skillpackUpdatePreview.mockResolvedValue({
      ok: true,
      changed: true,
      data: {
        planId: 'skillpack-update-plan-1',
        requiresConfirmation: true,
        status: 'update-preview-ready',
        message: 'Downloaded update preview snapshot.',
        plan: {
          addedSkillIds: [],
          changedSkillIds: ['review-helper'],
          removedSkillIds: [],
          skillDeltas: [{
            id: 'review-helper',
            change: 'changed',
            previousVersion: '1.4.0',
            nextVersion: '2.0.0',
            versionChange: 'major',
            breakingRisk: true
          }],
          bundleDeltas: [],
          affectedBundles: [{
            bundleId: 'default',
            breakingRisk: true,
            reasons: [{
              kind: 'effective-skill-changed',
              entityId: 'review-helper',
              versionChange: 'major',
              breakingRisk: true,
              message: 'Selected bundle "default" has a major review-helper update.'
            }]
          }]
        }
      },
      warnings: [],
      errors: [],
      nextActions: []
    });
    const renderer = await renderScreen(application);

    press('', {return: true});
    press('u');
    await flushPromises();

    const text = collectText(renderer.toJSON());
    expect(text).toContain('UPDATE PREVIEW');
    expect(text).toContain('MAJOR VERSION RISK');
    expect(text).toContain('review-helper: changed, 1.4.0 -> 2.0.0');
    expect(text).toContain('default [MAJOR RISK]');
    expect(application.skillpackUpdateApply).not.toHaveBeenCalled();
  });
});

describe('suggestSkillpackId', () => {
  it('normalizes repo names and adds deterministic collision suffixes', () => {
    expect(suggestSkillpackId('git@github.com:Acme/Review Tools.git', [])).toBe('review-tools');
    expect(suggestSkillpackId('https://github.com/acme/review-tools.git?ref=main', ['review-tools', 'review-tools-2'])).toBe('review-tools-3');
  });
});

async function renderScreen(
  application = fakeApplication(),
  onConfigSaved: (config: ManagerConfig) => void = () => undefined
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <CorvusApplicationContext.Provider value={application}>
        <SkillpackSetupScreen
          config={config}
          configPath="/tmp/corvus/config.json"
          onBack={() => undefined}
          onConfigSaved={onConfigSaved}
        />
      </CorvusApplicationContext.Provider>
    );
    await flushPromises();
  });
  return renderer!;
}

function fakeApplication(): CorvusApplication & {
  skillpackSetupPlan: ReturnType<typeof vi.fn>;
  skillpackSetupApply: ReturnType<typeof vi.fn>;
  skillpackUpdatePreview: ReturnType<typeof vi.fn>;
  skillpackUpdateApply: ReturnType<typeof vi.fn>;
} {
  const application = {
    skillpackStatus: vi.fn(async () => ({
      ok: true,
      changed: false,
      data: {
        configured: true,
        skillpacks: [],
        configPath: '/tmp/corvus/config.json',
        configExists: true,
        configValid: true
      },
      warnings: [],
      errors: [],
      nextActions: []
    })),
    skillpackSetupPlan: vi.fn(async () => ({
      ok: true,
      changed: false,
      data: {
        planId: 'setup-plan-1',
        digest: 'digest',
        requiresConfirmation: true,
        planPath: '/tmp/plan.json',
        plan: {
          alreadyPresent: false,
          expectedRevisionPath: '/tmp/revisions/abc/repo'
        }
      },
      warnings: [],
      errors: [],
      nextActions: []
    })),
    skillpackSetupApply: vi.fn(async () => ({
      ok: true,
      changed: true,
      data: {
        planId: 'setup-plan-1',
        status: 'clone-complete',
        checkoutPath: '/tmp/current',
        message: 'Initial revision snapshot active.'
      },
      warnings: [],
      errors: [],
      nextActions: []
    })),
    skillpackUpdatePreview: vi.fn(),
    skillpackUpdateApply: vi.fn(),
    skillpackRemovePlan: vi.fn(),
    skillpackRemoveApply: vi.fn()
  };
  return application as unknown as CorvusApplication & {
    skillpackSetupPlan: ReturnType<typeof vi.fn>;
    skillpackSetupApply: ReturnType<typeof vi.fn>;
    skillpackUpdatePreview: ReturnType<typeof vi.fn>;
    skillpackUpdateApply: ReturnType<typeof vi.fn>;
  };
}

function press(input: string, key: InputKey = {}): void {
  act(() => {
    if (inkState.inputHandler === undefined) throw new Error('No input handler registered.');
    inkState.inputHandler(input, key);
  });
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
}

function collectText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (typeof node === 'object' && 'children' in node) return collectText((node as {children?: unknown}).children);
  return '';
}

const defaultPack = {
  id: defaultSkillpackId,
  repositoryUrl: defaultSkillpackRepositoryUrl,
  branch: 'main',
  checkoutPath: defaultSkillpackCheckoutPath(defaultSkillpackId)
};

const config: ManagerConfig = {
  version: 2,
  managerStateDir: '/tmp/corvus',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  skillpacks: {
    [defaultSkillpackId]: defaultPack,
    'team-skills': {
      id: 'team-skills',
      repositoryUrl: 'https://github.com/acme/team-skills.git',
      branch: 'main',
      checkoutPath: defaultSkillpackCheckoutPath('team-skills')
    }
  }
};
