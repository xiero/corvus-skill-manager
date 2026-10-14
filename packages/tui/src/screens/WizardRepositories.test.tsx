import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  type DiscoveredSkill,
  type ManagerConfig,
  type SkillDiscoveryResult,
  parseManagerConfig
} from '@corvus-tools/skill-manager-core';
import {WizardScreen, type WizardOperations} from './WizardScreen.js';

type InputKey = {return?: boolean; upArrow?: boolean; downArrow?: boolean};
type InputHandler = (input: string, key: InputKey) => void;

const inkState = vi.hoisted(() => ({inputHandler: undefined as InputHandler | undefined}));

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useApp: () => ({exit: vi.fn()}),
    useInput: (handler: InputHandler) => { inkState.inputHandler = handler; }
  };
});

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  inkState.inputHandler = undefined;
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('Wizard repository selection', () => {
  it('starts with both repositories checked and can show only the secondary repository', async () => {
    const discoverSkillsFromCheckout = vi.fn(async (checkoutPath: string) => {
      const result = discovery(checkoutPath);
      if (checkoutPath === primaryPath) {
        result.errors.push({
          severity: 'error',
          code: 'duplicate-skill-id',
          message: 'Primary duplicate skill warning.'
        });
      }
      return result;
    });
    await mount({operations: {...readOnlyOperations(), discoverSkillsFromCheckout}});

    expect(screenText()).toContain('[x] corvus-skillpack');
    expect(screenText()).toContain('[x] internal-skills');

    press(' ');
    press('', {return: true});

    expect(screenText()).toContain('5. Bundles + Individual Skills');
    expect(screenText()).toContain('internal-skills:company-helper');
    expect(screenText()).not.toContain('corvus-skillpack:public-helper');
    expect(screenText()).not.toContain('Primary duplicate skill warning.');
    expect(discoverSkillsFromCheckout).toHaveBeenCalledTimes(2);
    expect(discoverSkillsFromCheckout).toHaveBeenCalledWith(primaryPath);
    expect(discoverSkillsFromCheckout).toHaveBeenCalledWith(secondaryPath);
  });

  it('selects all repositories again and restores their combined skill list', async () => {
    await mount();
    press(' ');
    press('', {return: true});
    expect(screenText()).not.toContain('corvus-skillpack:public-helper');

    press('b');
    expect(screenText()).toContain('4. Repositories');
    press('a');
    press('', {return: true});

    expect(screenText()).toContain('corvus-skillpack:public-helper');
    expect(screenText()).toContain('internal-skills:company-helper');
  });

  it('requires at least one repository before continuing', async () => {
    await mount();
    press(' ');
    press('', {downArrow: true});
    press(' ');
    press('', {return: true});

    expect(screenText()).toContain('4. Repositories');
    expect(screenText()).not.toContain('5. Bundles + Individual Skills');
    expect(screenText()).toMatch(/at least one repo/i);
  });

  it('visits repository selection between agents and skills in both directions', async () => {
    await mount({initialStep: 'agents'});
    press('', {return: true});
    expect(screenText()).toContain('4. Repositories');
    press('', {return: true});
    expect(screenText()).toContain('5. Bundles + Individual Skills');
    press('b');
    expect(screenText()).toContain('4. Repositories');
    press('b');
    expect(screenText()).toContain('3. Agents');
  });

  it('retains hidden draft roots through planning and saves both source selections only on approval', async () => {
    const saveConfig = vi.fn<WizardOperations['saveConfig']>(async () => {});
    const applyLinkPlan = vi.fn<WizardOperations['applyLinkPlan']>(async (input) => ({
      dryRun: false,
      manifestPath: '/tmp/corvus/manifest.json',
      applied: input.plan.operations.map((operation) => ({
        operation, status: 'applied' as const, message: 'Applied.'
      })),
      skipped: [],
      planned: input.plan.operations
    }));
    await mount({operations: {...readOnlyOperations(), saveConfig, applyLinkPlan}});

    // Scope the first selection to the public repository, then hide it.
    press('', {downArrow: true});
    press(' ');
    press('', {return: true});
    press(' ');
    expect(screenText()).toContain('[x] corvus-skillpack:public-helper');
    press('b');
    press('a');
    press('', {upArrow: true});
    press(' ');
    press('', {return: true});
    expect(screenText()).not.toContain('[x] corvus-skillpack:public-helper');
    expect(screenText()).toContain('selections from hidden repositories are retained in the plan');

    press(' ');
    press('p');

    expect(screenText()).toContain('create-link codex/corvus-skillpack:public-helper');
    expect(screenText()).toContain('create-link codex/internal-skills:company-helper');
    expect(screenText()).toContain('Conflicts: none');
    expect(saveConfig).not.toHaveBeenCalled();
    expect(applyLinkPlan).not.toHaveBeenCalled();

    press('', {return: true});
    expect(saveConfig).not.toHaveBeenCalled();
    press('a');
    await act(async () => flushPromises());

    expect(saveConfig).toHaveBeenCalledOnce();
    expect(saveConfig.mock.calls[0]?.[0].agents?.codex?.selectedSkillIds).toEqual([
      'corvus-skillpack:public-helper',
      'internal-skills:company-helper'
    ]);
    expect(applyLinkPlan).toHaveBeenCalledOnce();
    expect(applyLinkPlan.mock.calls[0]?.[0].skillpackCheckoutPaths).toEqual([
      primaryPath, secondaryPath
    ]);
  });

  it('keeps matching local skill names distinct and blocks their shared target conflict', async () => {
    await mount({
      operations: {
        ...readOnlyOperations(),
        discoverSkillsFromCheckout: async (checkoutPath) => discovery(checkoutPath, 'shared-helper')
      }
    });
    press('', {return: true});

    expect(screenText()).toContain('[ ] corvus-skillpack:shared-helper');
    expect(screenText()).toContain('[ ] internal-skills:shared-helper');
    press(' ');
    press('', {downArrow: true});
    press(' ');
    press('p');

    expect(screenText()).toContain('share target name "shared-helper"');
    expect(screenText()).toContain('Apply is blocked');
    expect(screenText()).not.toContain('create-link codex/');
  });

  it('waits for discovery before opening the skill list', async () => {
    let finishDiscovery: ((result: SkillDiscoveryResult) => void) | undefined;
    const pending = new Promise<SkillDiscoveryResult>((resolve) => { finishDiscovery = resolve; });
    await mount({
      operations: {
        ...readOnlyOperations(),
        discoverSkillsFromCheckout: async (checkoutPath) =>
          checkoutPath === secondaryPath ? pending : discovery(checkoutPath)
      }
    });
    press('', {return: true});

    expect(screenText()).toContain('4. Repositories');
    expect(screenText()).not.toContain('5. Bundles + Individual Skills');

    await act(async () => {
      finishDiscovery!(discovery(secondaryPath));
      await flushPromises();
    });
    press('', {return: true});
    expect(screenText()).toContain('internal-skills:company-helper');
  });

  it('can plan from the healthy secondary repository when discovery of the primary fails', async () => {
    await mount({
      operations: {
        ...readOnlyOperations(),
        discoverSkillsFromCheckout: async (checkoutPath) => {
          if (checkoutPath === primaryPath) throw new Error('Public checkout cannot be read.');
          return discovery(checkoutPath);
        }
      }
    });
    press(' ');
    press('', {return: true});

    expect(screenText()).toContain('internal-skills:company-helper');
    expect(screenText()).not.toContain('Public checkout cannot be read.');
    press(' ');
    press('p');
    expect(screenText()).toContain('create-link codex/internal-skills:company-helper');
    expect(screenText()).toContain('Conflicts: none');
  });

  it('rediscovers an initial clone when the configured checkout path stays the same', async () => {
    let cloned = false;
    const discoverSkillsFromCheckout = vi.fn(async (checkoutPath: string) => {
      if (checkoutPath === primaryPath && !cloned) throw new Error('Checkout does not exist yet.');
      return discovery(checkoutPath);
    });
    const applyInitialSkillpackSetup = vi.fn<WizardOperations['applyInitialSkillpackSetup']>(async ({config}) => {
      cloned = true;
      return {
        status: 'clone-complete', config, checkoutPath: config.checkoutPath,
        dirty: false, dirtyFiles: [], message: 'Initial clone completed.'
      };
    });
    await mount({
      initialStep: 'skillpack',
      operations: {
        ...readOnlyOperations(),
        saveConfig: async () => {},
        inspectSkillpackCheckout: async (checkoutPath) => ({
          status: cloned ? 'checkout-readable' : 'checkout-missing',
          checkoutPath, exists: cloned, readable: cloned,
          dirty: false, dirtyFiles: [], message: cloned ? 'Readable.' : 'Missing.'
        }),
        discoverSkillsFromCheckout,
        applyInitialSkillpackSetup
      }
    });

    press('a');
    await act(async () => flushPromises());
    expect(applyInitialSkillpackSetup).toHaveBeenCalledOnce();
    expect(screenText()).toContain('2. Update');
    press('', {return: true});
    press('', {return: true});
    press('', {return: true});

    expect(screenText()).toContain('5. Bundles + Individual Skills');
    expect(screenText()).toContain('corvus-skillpack:public-helper');
    expect(discoverSkillsFromCheckout.mock.calls.filter(([checkoutPath]) => checkoutPath === primaryPath).length)
      .toBeGreaterThanOrEqual(2);
  });

  it('refreshes the catalog and plan after an approved update at the same current path', async () => {
    let updated = false;
    const config = managerConfig();
    config.agents!.codex!.selectedSkillIds = ['corvus-skillpack:public-helper'];
    const discoverSkillsFromCheckout = vi.fn(async (checkoutPath: string) => {
      const result = discovery(checkoutPath);
      result.skills = result.skills.map((skill) => ({...skill, version: updated ? '2.0.0' : '1.0.0'}));
      if (checkoutPath === primaryPath && updated) {
        result.skills.push(...discovery(checkoutPath, 'new-after-update').skills);
      }
      return result;
    });
    const applySkillpackUpdate = vi.fn<WizardOperations['applySkillpackUpdate']>(async ({config}) => {
      updated = true;
      return {status: 'update-applied', checkoutPath: config.checkoutPath, message: 'Update applied.'};
    });
    await mount({
      config,
      operations: {
        ...readOnlyOperations(),
        saveConfig: async () => {},
        discoverSkillsFromCheckout,
        inspectSkillpackRemoteUpdate: async (config) => ({
          status: updated ? 'up-to-date' : 'update-available',
          checkoutPath: config.checkoutPath, updateAvailable: !updated,
          message: updated ? 'Up to date.' : 'Update available.'
        }),
        prepareSkillpackUpdatePreview: async ({config}) => ({
          status: 'update-preview-ready', checkoutPath: config.checkoutPath,
          addedSkillIds: ['new-after-update'], removedSkillIds: [], changedSkillIds: ['public-helper'],
          changedFiles: [], skillDeltas: [], bundleDeltas: [], affectedBundles: [],
          message: 'Update preview ready.'
        }),
        applySkillpackUpdate
      }
    });
    press('', {return: true});
    press('p');
    expect(screenText()).toContain('corvus-skillpack:public-helper@1.0.0');

    // Return through skills, repositories and agents to the update step.
    press('b');
    press('b');
    press('b');
    press('b');
    expect(screenText()).toContain('2. Update');
    press('p');
    await act(async () => flushPromises());
    press('a');
    await act(async () => flushPromises());

    expect(applySkillpackUpdate).toHaveBeenCalledOnce();
    expect(screenText()).toContain('3. Agents');
    press('', {return: true});
    press('', {return: true});
    expect(screenText()).toContain('corvus-skillpack:new-after-update');
    expect(screenText()).toContain('[x] corvus-skillpack:public-helper@2.0.0');
    press('p');
    expect(screenText()).toContain('Explicit skills: corvus-skillpack:public-helper@2.0.0');
    expect(screenText()).not.toContain('public-helper@1.0.0');
    expect(discoverSkillsFromCheckout.mock.calls.filter(([checkoutPath]) => checkoutPath === primaryPath).length)
      .toBeGreaterThanOrEqual(2);
  });
});

const primaryPath = '/tmp/skillpacks/corvus-skillpack/current';
const secondaryPath = '/tmp/skillpacks/internal-skills/current';

function managerConfig(): ManagerConfig {
  return parseManagerConfig({
    version: 3,
    managerStateDir: '/tmp/corvus',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    skillpacks: {
      'corvus-skillpack': {
        id: 'corvus-skillpack', repositoryUrl: 'https://example.com/public.git',
        branch: 'main', checkoutPath: primaryPath
      },
      'internal-skills': {
        id: 'internal-skills', repositoryUrl: 'https://example.com/internal.git',
        branch: 'main', checkoutPath: secondaryPath
      }
    },
    agents: {
      codex: {
        enabled: true, targetPath: '/tmp/codex/skills', selectedSkillIds: [], selectedBundleIds: []
      }
    }
  });
}

async function mount(options: {
  config?: ManagerConfig;
  initialStep?: 'repositories' | 'agents' | 'skillpack';
  operations?: Partial<WizardOperations>;
} = {}): Promise<void> {
  const operations = options.operations ?? readOnlyOperations();
  function ManagedWizard(): React.ReactElement {
    const [config, setConfig] = React.useState(options.config ?? managerConfig());
    return (
      <WizardScreen
        config={config}
        configPath="/tmp/corvus/config.json"
        initialStep={options.initialStep ?? 'repositories'}
        onBackHome={() => {}}
        onConfigSaved={setConfig}
        operations={operations}
      />
    );
  }
  await act(async () => {
    renderer = create(<ManagedWizard />);
    await flushPromises();
  });
}

function readOnlyOperations(): Partial<WizardOperations> {
  return {
    inspectSkillpackCheckout: async (checkoutPath) => ({
      status: 'checkout-readable', checkoutPath, exists: true, readable: true,
      commitHash: '1111111111111111111111111111111111111111',
      dirty: false, dirtyFiles: [], message: 'Checkout exists and is readable.'
    }),
    inspectSkillpackRemoteUpdate: async (config) => ({
      status: 'up-to-date', checkoutPath: config.checkoutPath,
      activeCommitHash: '1111111111111111111111111111111111111111',
      remoteCommitHash: '1111111111111111111111111111111111111111',
      updateAvailable: false, message: 'Active snapshot is up to date.'
    }),
    discoverSkillsFromCheckout: async (checkoutPath) => discovery(checkoutPath)
  };
}

function discovery(checkoutPath: string, localId?: string): SkillDiscoveryResult {
  const id = localId ?? (checkoutPath === primaryPath ? 'public-helper' : 'company-helper');
  const skill: DiscoveredSkill = {
    id, title: id, description: `${id} description`, supportedAgents: ['codex'],
    tags: [], domains: [], tasks: [], languages: [], technologies: [], platforms: [], keywords: [],
    useCases: [], nonGoals: [], requires: [], recommends: [], conflictsWith: [],
    relativePath: id, absolutePath: `${checkoutPath}/${id}`,
    skillFilePath: `${checkoutPath}/${id}/SKILL.md`,
    frontmatter: {name: id, description: `${id} description`}, riskWarnings: []
  };
  return {
    skillpackRoot: checkoutPath, registryPath: `${checkoutPath}/registry.json`,
    source: 'registry', skills: [skill], bundles: [], warnings: [], errors: []
  };
}

function press(input: string, key: InputKey = {}): void {
  act(() => {
    if (inkState.inputHandler === undefined) throw new Error('No input handler registered.');
    inkState.inputHandler(input, key);
  });
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => { setImmediate(resolve); });
}

function screenText(): string {
  return collectText(renderer?.toJSON());
}

function collectText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (typeof node === 'object' && 'children' in node) {
    return collectText((node as {children?: unknown}).children);
  }
  return '';
}
