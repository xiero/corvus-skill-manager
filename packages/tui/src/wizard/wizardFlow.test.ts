import {describe, expect, it} from 'vitest';
import type {
  ApplyLinkPlanResult,
  DiscoveredSkill,
  LinkPlan,
  ManagerConfig,
  SkillpackInspection,
  SkillpackRemoteUpdateInspection
} from '@corvus-tools/skill-manager-core';
import {deriveWizardFlow, isWizardAgentSelectable, type WizardStepId} from './wizardFlow.js';

const config: ManagerConfig = {
  version: 1,
  managerStateDir: '/tmp/corvus-state',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  skillpack: {
    id: 'corvus',
    repositoryUrl: 'https://example.com/skills.git',
    branch: 'main',
    checkoutPath: '/tmp/skillpacks/corvus/current'
  }
};

const readableInspection: SkillpackInspection = {
  status: 'checkout-readable',
  checkoutPath: '/tmp/skillpacks/corvus/current',
  exists: true,
  readable: true,
  commitHash: 'abcdef1',
  dirty: false,
  dirtyFiles: [],
  message: 'Checkout exists and is readable'
};

const upToDateRemote: SkillpackRemoteUpdateInspection = {
  status: 'up-to-date',
  checkoutPath: '/tmp/skillpacks/corvus/current',
  activeCommitHash: 'abcdef1',
  remoteCommitHash: 'abcdef1',
  updateAvailable: false,
  message: 'Active snapshot is up to date with main.'
};

const discoveredSkill: DiscoveredSkill = {
  id: 'review-helper',
  title: 'Review Helper',
  description: 'Helps with reviews.',
  supportedAgents: ['codex'],
  tags: ['review'],
  relativePath: 'skills/review-helper',
  absolutePath: '/tmp/skillpacks/corvus/current/skills/review-helper',
  skillFilePath: '/tmp/skillpacks/corvus/current/skills/review-helper/SKILL.md',
  frontmatter: {
    name: 'review-helper',
    description: 'Review pull requests.'
  },
  riskWarnings: []
};

describe('deriveWizardFlow', () => {
  it('marks first-run missing checkout as the active skillpack step', () => {
    const flow = deriveWizardFlow({
      config,
      inspection: {
        status: 'checkout-missing',
        checkoutPath: '/tmp/skillpacks/corvus/current',
        exists: false,
        readable: false,
        dirty: false,
        dirtyFiles: [],
        message: 'Checkout missing'
      }
    });

    expect(stepStatus(flow, 'skillpack')).toBe('active');
    expect(flow.recommendedStepId).toBe('skillpack');
  });

  it('marks an existing readable checkout complete', () => {
    const flow = deriveWizardFlow({
      config,
      inspection: readableInspection,
      remoteUpdate: upToDateRemote
    });

    expect(stepStatus(flow, 'skillpack')).toBe('complete');
  });

  it('reports dirty checkouts as warnings without blocking configuration', () => {
    const flow = deriveWizardFlow({
      config,
      inspection: {
        ...readableInspection,
        status: 'checkout-dirty',
        dirty: true,
        dirtyFiles: ['M SKILL.md'],
        message: 'Checkout exists and is dirty'
      },
      remoteUpdate: upToDateRemote
    });

    expect(stepStatus(flow, 'skillpack')).toBe('warning');
    expect(stepStatus(flow, 'agents')).toBe('active');
  });

  it('recommends the update step when a remote update is available', () => {
    const flow = deriveWizardFlow({
      config,
      inspection: readableInspection,
      remoteUpdate: {
        status: 'update-available',
        checkoutPath: '/tmp/skillpacks/corvus/current',
        activeCommitHash: 'abcdef1',
        remoteCommitHash: '1234567',
        updateAvailable: true,
        message: 'Remote main is at 1234567.'
      }
    });

    expect(stepStatus(flow, 'update')).toBe('active');
    expect(flow.recommendedStepId).toBe('update');
  });

  it('keeps remote unavailable as a warning and allows agent configuration', () => {
    const flow = deriveWizardFlow({
      config,
      inspection: readableInspection,
      remoteUpdate: {
        status: 'remote-unavailable',
        checkoutPath: '/tmp/skillpacks/corvus/current',
        activeCommitHash: 'abcdef1',
        updateAvailable: false,
        message: 'Remote update check failed.'
      }
    });

    expect(stepStatus(flow, 'update')).toBe('warning');
    expect(flow.recommendedStepId).toBe('agents');
  });

  it('recommends agents when no agents are selected', () => {
    const flow = deriveWizardFlow({
      config,
      inspection: readableInspection,
      remoteUpdate: upToDateRemote,
      draftAgents: {
        codex: {enabled: false, targetPath: '/tmp/codex', selectedSkillIds: []}
      }
    });

    expect(stepStatus(flow, 'agents')).toBe('active');
    expect(flow.recommendedStepId).toBe('agents');
  });

  it('recommends skills when an enabled agent has no selected skills', () => {
    const flow = deriveWizardFlow({
      config,
      inspection: readableInspection,
      remoteUpdate: upToDateRemote,
      discoveredSkills: [discoveredSkill],
      draftAgents: {
        codex: {enabled: true, targetPath: '/tmp/codex', selectedSkillIds: []}
      }
    });

    expect(stepStatus(flow, 'skills')).toBe('active');
    expect(flow.recommendedStepId).toBe('skills');
  });

  it('explains no-op plans', () => {
    const flow = deriveWizardFlow({
      config,
      inspection: readableInspection,
      remoteUpdate: upToDateRemote,
      discoveredSkills: [discoveredSkill],
      draftAgents: {
        codex: {enabled: true, targetPath: '/tmp/codex', selectedSkillIds: ['review-helper']}
      },
      plan: emptyPlan()
    });

    expect(stepStatus(flow, 'plan')).toBe('warning');
    expect(stepStatus(flow, 'confirm')).toBe('pending');
  });

  it('blocks apply confirmation for plan conflicts', () => {
    const flow = deriveWizardFlow({
      config,
      inspection: readableInspection,
      remoteUpdate: upToDateRemote,
      discoveredSkills: [discoveredSkill],
      draftAgents: {
        codex: {enabled: true, targetPath: '/tmp/codex', selectedSkillIds: ['review-helper']}
      },
      plan: {
        operations: [],
        warnings: [],
        conflicts: [
          {
            severity: 'conflict',
            code: 'unmanaged-target-exists',
            message: 'Target already exists.',
            agentId: 'codex',
            skillId: 'review-helper',
            path: '/tmp/codex/review-helper'
          }
        ]
      }
    });

    expect(stepStatus(flow, 'plan')).toBe('blocked');
    expect(stepStatus(flow, 'confirm')).toBe('blocked');
  });

  it('marks the flow complete after apply result', () => {
    const flow = deriveWizardFlow({
      config,
      inspection: readableInspection,
      remoteUpdate: upToDateRemote,
      applyResult: applyResult()
    });

    expect(stepStatus(flow, 'complete')).toBe('complete');
    expect(flow.recommendedStepId).toBe('complete');
  });
});

describe('isWizardAgentSelectable', () => {
  it('keeps Gemini visible but unavailable', () => {
    expect(isWizardAgentSelectable({id: 'gemini', displayName: 'Gemini CLI', supportStatus: 'deferred'})).toBe(false);
  });
});

function stepStatus(flow: ReturnType<typeof deriveWizardFlow>, id: WizardStepId): string | undefined {
  return flow.steps.find((step) => step.id === id)?.status;
}

function emptyPlan(): LinkPlan {
  return {
    operations: [],
    conflicts: [],
    warnings: []
  };
}

function applyResult(): ApplyLinkPlanResult {
  return {
    dryRun: false,
    manifestPath: '/tmp/corvus-state/manifest.json',
    applied: [],
    skipped: [],
    planned: []
  };
}
