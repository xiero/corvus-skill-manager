import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {AgentId, ManagerConfig, SkillDiscoveryResult} from '@corvus-tools/skill-manager-core';
import {getAgentAdapters} from '@corvus-tools/skill-manager-core';
import type {WizardDraftAgent} from '../wizard/wizardFlow.js';
import {WizardScreen, WizardSkillSelectionView, type WizardOperations} from './WizardScreen.js';

type InputKey = {
  return?: boolean;
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

describe('Skills step broadcast selection', () => {
  it('applies a toggled skill to every enabled agent at once', async () => {
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <WizardScreen
          config={configWithEnabledAgents(['claude', 'codex'])}
          configPath="/tmp/corvus/config.json"
          initialStep="skills"
          onBackHome={() => {}}
          onConfigSaved={() => {}}
          operations={operationsWithSkills()}
        />
      );
      await flushPromises();
    });

    // Header reflects that more than one agent is targeted.
    expect(collectText(renderer!.toJSON())).toContain('4. Bundles + Individual Skills for 2 agents');

    // Toggle the first skill on, then open the dry-run plan.
    press(' ');
    press('p');

    const text = collectText(renderer!.toJSON());
    expect(text).toContain('create-link claude/corvus-skillpack:review-helper');
    expect(text).toContain('create-link codex/corvus-skillpack:review-helper');
  });

  it('removes a fully-selected skill from every enabled agent', async () => {
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <WizardScreen
          config={configWithEnabledAgents(['claude', 'codex'], ['review-helper'])}
          configPath="/tmp/corvus/config.json"
          initialStep="skills"
          onBackHome={() => {}}
          onConfigSaved={() => {}}
          operations={operationsWithSkills()}
        />
      );
      await flushPromises();
    });

    // Starts fully selected for both agents.
    expect(collectText(renderer!.toJSON())).toContain('[x] corvus-skillpack:review-helper');

    // Toggle off broadcasts the removal to every enabled agent. Because the skill was
    // already saved as selected, the plan records a remove-link for each enabled agent.
    press(' ');
    press('p');

    const text = collectText(renderer!.toJSON());
    expect(text).not.toContain('create-link claude/review-helper');
    expect(text).not.toContain('create-link codex/review-helper');
    expect(text).toContain('remove-link claude/corvus-skillpack:review-helper');
    expect(text).toContain('remove-link codex/corvus-skillpack:review-helper');
  });
});

describe('WizardSkillSelectionView', () => {
  const adapters = getAgentAdapters();
  const enabledAdapters = adapters.filter((adapter) => adapter.id === 'claude' || adapter.id === 'codex');

  it('renders a mixed marker when a skill is selected for only some enabled agents', () => {
    const states = new Map([['review-helper', 'some' as const]]);
    const tree = create(
      <WizardSkillSelectionView
        enabledAdapters={enabledAdapters}
        skills={[{id: 'review-helper', title: 'Review Helper', absolutePath: '/tmp/skills/review-helper'}]}
        selectedSkillIndex={0}
        skillSelectionStates={states}
        discoveryState="loaded"
        discoveryErrors={[]}
      />
    ).toJSON();

    const text = collectText(tree);

    expect(text).toContain('4. Skills for 2 agents');
    expect(text).toContain('applies it to all 2 enabled agents');
    expect(text).toContain('[~] review-helper');
    expect(text).toContain('selected for some, not all');
  });

  it('keeps the single-agent heading when only one agent is enabled', () => {
    const single = adapters.filter((adapter) => adapter.id === 'claude');
    const states = new Map([['review-helper', 'all' as const]]);
    const tree = create(
      <WizardSkillSelectionView
        enabledAdapters={single}
        skills={[{id: 'review-helper', title: 'Review Helper', absolutePath: '/tmp/skills/review-helper'}]}
        selectedSkillIndex={0}
        skillSelectionStates={states}
        discoveryState="loaded"
        discoveryErrors={[]}
      />
    ).toJSON();

    const text = collectText(tree);

    expect(text).toContain('4. Skills for');
    expect(text).not.toContain('agents');
    expect(text).toContain('[x] review-helper');
  });
});

describe('Bundle and skill root selection', () => {
  it('shows and resolves a partial bundle root across enabled agents', async () => {
    let renderer: ReactTestRenderer | undefined;
    const partial = configWithEnabledAgents(
      ['claude', 'codex'],
      [],
      ['corvus-skillpack:review-flow']
    );
    partial.agents!.claude!.selectedBundleIds = [];

    await act(async () => {
      renderer = create(
        <WizardScreen
          config={partial}
          configPath="/tmp/corvus/config.json"
          initialStep="skills"
          onBackHome={() => {}}
          onConfigSaved={() => {}}
          operations={operationsWithBundles()}
        />
      );
      await flushPromises();
    });

    expect(collectText(renderer!.toJSON())).toContain('[~] corvus-skillpack:review-flow@2.0.0');
    press(' ');
    expect(collectText(renderer!.toJSON())).toContain('[x] corvus-skillpack:review-flow@2.0.0');
  });

  it('broadcasts a bundle root and previews roots, members, dependencies, and link operations', async () => {
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <WizardScreen
          config={configWithEnabledAgents(['claude', 'codex'])}
          configPath="/tmp/corvus/config.json"
          initialStep="skills"
          onBackHome={() => {}}
          onConfigSaved={() => {}}
          operations={operationsWithBundles()}
        />
      );
      await flushPromises();
    });

    expect(collectText(renderer!.toJSON())).toContain('[ ] corvus-skillpack:review-flow@2.0.0');
    press(' ');
    press('p');

    const text = collectText(renderer!.toJSON());
    expect(text).toContain('Explicit bundles: corvus-skillpack:review-flow@2.0.0');
    expect(text).toContain('Bundle members: corvus-skillpack:review-helper');
    expect(text).toContain('Dependencies: corvus-skillpack:base-helper');
    expect(text).toContain('create-link claude/corvus-skillpack:review-helper');
    expect(text).toContain('create-link codex/corvus-skillpack:base-helper');
  });

  it('keeps an incompatible bundle visible but blocks its toggle', async () => {
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <WizardScreen
          config={configWithEnabledAgents(['claude', 'codex'])}
          configPath="/tmp/corvus/config.json"
          initialStep="skills"
          onBackHome={() => {}}
          onConfigSaved={() => {}}
          operations={operationsWithBundles(['codex'])}
        />
      );
      await flushPromises();
    });

    expect(collectText(renderer!.toJSON())).toContain('[!] corvus-skillpack:review-flow@2.0.0');
    press(' ');

    expect(collectText(renderer!.toJSON())).toContain('is incompatible with claude');
    expect(collectText(renderer!.toJSON())).not.toContain('[x] corvus-skillpack:review-flow');
  });

  it('allows a previously selected incompatible bundle to be removed safely', async () => {
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <WizardScreen
          config={configWithEnabledAgents(
            ['claude', 'codex'],
            [],
            ['corvus-skillpack:review-flow']
          )}
          configPath="/tmp/corvus/config.json"
          initialStep="skills"
          onBackHome={() => {}}
          onConfigSaved={() => {}}
          operations={operationsWithBundles(['codex'])}
        />
      );
      await flushPromises();
    });

    expect(collectText(renderer!.toJSON())).toContain('[!x] corvus-skillpack:review-flow@2.0.0');
    press(' ');
    expect(collectText(renderer!.toJSON())).toContain('[!] corvus-skillpack:review-flow@2.0.0');
    expect(collectText(renderer!.toJSON())).toContain('Removed incompatible bundle');
  });

  it('supports mixed bundle and individual skill roots with one bundle-first cursor', async () => {
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <WizardScreen
          config={configWithEnabledAgents(['codex'])}
          configPath="/tmp/corvus/config.json"
          initialStep="skills"
          onBackHome={() => {}}
          onConfigSaved={() => {}}
          operations={operationsWithBundles()}
        />
      );
      await flushPromises();
    });

    press(' ');
    press('', {downArrow: true});
    press(' ');
    press('p');

    const text = collectText(renderer!.toJSON());
    expect(text).toContain('Explicit bundles: corvus-skillpack:review-flow@2.0.0');
    expect(text).toContain('Explicit skills: corvus-skillpack:base-helper');
  });

  it('discards unsaved bundle roots when returning Home', async () => {
    const saveConfig = vi.fn();
    const onBackHome = vi.fn();

    await act(async () => {
      create(
        <WizardScreen
          config={configWithEnabledAgents(['codex'])}
          configPath="/tmp/corvus/config.json"
          initialStep="skills"
          onBackHome={onBackHome}
          onConfigSaved={() => {}}
          operations={{...operationsWithBundles(), saveConfig}}
        />
      );
      await flushPromises();
    });

    press(' ');
    press('h');

    expect(onBackHome).toHaveBeenCalledOnce();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('persists bundle roots only after the existing explicit apply approval', async () => {
    const saveConfig = vi.fn(async () => {});
    const applyLinkPlan = vi.fn(async (input) => ({
      dryRun: false,
      manifestPath: '/tmp/corvus/manifest.json',
      applied: input.plan.operations.map((operation) => ({operation, status: 'applied' as const, message: 'Applied.'})),
      skipped: [],
      planned: input.plan.operations
    }));

    await act(async () => {
      create(
        <WizardScreen
          config={configWithEnabledAgents(['codex'])}
          configPath="/tmp/corvus/config.json"
          initialStep="skills"
          onBackHome={() => {}}
          onConfigSaved={() => {}}
          operations={{...operationsWithBundles(), saveConfig, applyLinkPlan}}
        />
      );
      await flushPromises();
    });

    press(' ');
    expect(saveConfig).not.toHaveBeenCalled();
    press('p');
    expect(saveConfig).not.toHaveBeenCalled();
    press('', {return: true});
    expect(saveConfig).not.toHaveBeenCalled();
    press('a');
    await act(async () => flushPromises());

    expect(saveConfig).toHaveBeenCalledOnce();
    expect(saveConfig.mock.calls[0]?.[0].agents.codex.selectedBundleIds).toEqual([
      'corvus-skillpack:review-flow'
    ]);
    expect(applyLinkPlan).toHaveBeenCalledOnce();
  });
});

function configWithEnabledAgents(
  enabledIds: AgentId[],
  selectedSkillIds: string[] = [],
  selectedBundleIds: string[] = []
): ManagerConfig {
  const adapters = getAgentAdapters();
  const agents = Object.fromEntries(
    adapters.map((adapter) => {
      const enabled = enabledIds.includes(adapter.id);

      return [
        adapter.id,
        {
          enabled,
          targetPath: adapter.defaultTargetPath ?? `/tmp/${adapter.id}/skills`,
          selectedSkillIds: enabled ? selectedSkillIds : [],
          selectedBundleIds: enabled ? selectedBundleIds : []
        }
      ];
    })
  ) as Record<AgentId, WizardDraftAgent>;

  return {
    version: 1,
    managerStateDir: '/tmp/corvus',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    skillpack: {
      id: 'corvus-skillpack',
      repositoryUrl: 'https://example.com/corvus.git',
      branch: 'main',
      checkoutPath: '/tmp/skillpacks/corvus/current'
    },
    agents
  };
}

function operationsWithSkills(): Partial<WizardOperations> {
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
      skillpackRoot: '/tmp/skillpacks/corvus/current',
      registryPath: '/tmp/skillpacks/corvus/current/registry.json',
      source: 'registry',
      skills: [discoveredSkill('review-helper', ['claude', 'codex'])],
      bundles: [],
      warnings: [],
      errors: []
    })
  };
}

function operationsWithBundles(supportedAgents: AgentId[] = ['claude', 'codex']): Partial<WizardOperations> {
  const operations = operationsWithSkills();

  return {
    ...operations,
    discoverSkillsFromCheckout: async (): Promise<SkillDiscoveryResult> => ({
      skillpackRoot: '/tmp/skillpacks/corvus/current',
      registryPath: '/tmp/skillpacks/corvus/current/registry.json',
      source: 'registry',
      registryVersion: 3,
      skills: [
        discoveredSkill('base-helper', supportedAgents),
        discoveredSkill('review-helper', supportedAgents, ['base-helper'])
      ],
      bundles: [{
        id: 'review-flow',
        version: '2.0.0',
        title: 'Review Flow',
        description: 'A maintained review workflow.',
        tags: ['review'],
        keywords: ['review'],
        members: [{id: 'review-helper', versionRange: '^1.0.0', actualVersion: '1.2.0'}]
      }],
      warnings: [],
      errors: []
    })
  };
}

function discoveredSkill(id: string, supportedAgents: AgentId[], requires: string[] = []) {
  return {
    id,
    version: id === 'review-helper' ? '1.2.0' : '1.0.0',
    title: id === 'review-helper' ? 'Review Helper' : 'Base Helper',
    description: `${id} description`,
    supportedAgents,
    tags: [],
    domains: [],
    tasks: [],
    languages: [],
    technologies: [],
    platforms: [],
    keywords: [],
    useCases: [],
    nonGoals: [],
    requires,
    recommends: [],
    conflictsWith: [],
    relativePath: id,
    absolutePath: `/tmp/skillpacks/corvus/current/${id}`,
    skillFilePath: `/tmp/skillpacks/corvus/current/${id}/SKILL.md`,
    frontmatter: {name: id, description: `${id} description`},
    riskWarnings: []
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
