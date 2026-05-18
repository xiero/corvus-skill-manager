import React from 'react';
import {create} from 'react-test-renderer';
import {describe, expect, it} from 'vitest';
import type {AgentId, LinkPlan} from '@corvus-tools/skill-manager-core';
import {getAgentAdapters} from '@corvus-tools/skill-manager-core';
import {deriveWizardFlow, type WizardDraftAgent} from '../wizard/wizardFlow.js';
import {
  WizardAgentListView,
  WizardCommandFooter,
  WizardPlanView,
  WizardProgressRail
} from './WizardScreen.js';

describe('WizardProgressRail', () => {
  it('renders a vertical flow rail with the active step and Apply label', () => {
    const flow = deriveWizardFlow({});
    const tree = create(
      <WizardProgressRail currentStep="agents" recommendedStepId="agents" steps={flow.steps} />
    ).toJSON();

    const text = collectText(tree);

    expect(text).toContain('flow');
    expect(text).toContain('◆ Agents');
    expect(text).toContain('│');
    expect(text).toContain('◇ Skillpack');
    expect(text).toContain('Apply');
  });
});

describe('WizardCommandFooter', () => {
  it('uses a as the Apply approval key', () => {
    const tree = create(
      <WizardCommandFooter currentStep="confirm" editingSkillpackField={undefined} editingTarget={false} />
    ).toJSON();

    const text = collectText(tree);

    expect(text).toContain('keys');
    expect(text).toContain('a');
    expect(text).toContain('apply');
    expect(text).toContain('│');
    expect(text).not.toContain('Press y');
    expect(text).not.toContain('u to approve');
  });
});

describe('WizardAgentListView', () => {
  it('renders Gemini as deferred and unavailable', () => {
    const adapters = getAgentAdapters();
    const tree = create(
      <WizardAgentListView
        adapters={adapters}
        draftAgents={createDraftAgents()}
        selectedAgentIndex={adapters.findIndex((adapter) => adapter.id === 'gemini')}
        editingTarget={false}
        discoveryState="loaded"
        discoveryWarnings={[]}
        discoveryErrors={[]}
      />
    ).toJSON();

    const text = collectText(tree);

    expect(text).toContain('Gemini CLI');
    expect(text).toContain('deferred');
    expect(text).toContain('cannot be selected');
  });
});

describe('WizardPlanView', () => {
  it('renders no-op plan guidance', () => {
    const tree = create(<WizardPlanView plan={{operations: [], warnings: [], conflicts: []}} />).toJSON();
    const text = collectText(tree);

    expect(text).toContain('Nothing to apply');
    expect(text).toContain('Go back to agents or skills');
  });

  it('shows the Apply entry point when a plan has safe operations', () => {
    const tree = create(<WizardPlanView plan={operationPlan()} />).toJSON();
    const text = collectText(tree);

    expect(text).toContain('Press Enter to open the Apply step');
  });

  it('blocks apply when conflicts exist', () => {
    const tree = create(<WizardPlanView plan={conflictPlan()} />).toJSON();
    const text = collectText(tree);

    expect(text).toContain('Apply is blocked');
    expect(text).toContain('Resolve unmanaged target conflicts');
    expect(text).toContain('Target already exists and is not manager-owned');
  });
});

function createDraftAgents(): Record<AgentId, WizardDraftAgent> {
  return Object.fromEntries(
    getAgentAdapters().map((adapter) => [
      adapter.id,
      {
        enabled: false,
        targetPath: adapter.defaultTargetPath ?? '',
        selectedSkillIds: []
      }
    ])
  ) as Record<AgentId, WizardDraftAgent>;
}

function operationPlan(): LinkPlan {
  return {
    operations: [
      {
        type: 'create-link',
        agentId: 'codex',
        skillId: 'review-helper',
        sourcePath: '/tmp/skillpacks/corvus/current/review-helper',
        targetPath: '/tmp/codex/review-helper'
      }
    ],
    warnings: [],
    conflicts: []
  };
}

function conflictPlan(): LinkPlan {
  return {
    operations: [],
    warnings: [],
    conflicts: [
      {
        severity: 'conflict',
        code: 'unmanaged-target-exists',
        message: 'Target already exists and is not manager-owned: /tmp/codex/review-helper',
        agentId: 'codex',
        skillId: 'review-helper',
        path: '/tmp/codex/review-helper'
      }
    ]
  };
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
