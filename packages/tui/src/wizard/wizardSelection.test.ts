import {describe, expect, it} from 'vitest';
import {
  type AgentId,
  type DiscoveredBundle,
  type DiscoveredSkill,
  type ManagerConfig,
  getAgentAdapters
} from '@corvus-tools/skill-manager-core';
import {createWizardSelectionPlan, type WizardSelectionDraft} from './wizardSelection.js';

const pack = 'corvus-skillpack';
const bundleRef = `${pack}:review-flow`;

describe('createWizardSelectionPlan', () => {
  it('expands bundle roots and dependencies with provenance before link planning', () => {
    const result = createWizardSelectionPlan({
      adapters: getAgentAdapters(),
      skills: skills(),
      bundles: bundles(),
      draftAgents: drafts({codex: {selectedBundleIds: [bundleRef]}}),
      config: config()
    });

    expect(result.linkPlan.operations.map((operation) => operation.skillId)).toEqual([
      `${pack}:base-helper`,
      `${pack}:review-helper`
    ]);
    expect(result.preview.agents.find((agent) => agent.agentId === 'codex')).toMatchObject({
      rootBundleIds: [bundleRef],
      bundleMemberIds: [`${pack}:review-helper`],
      dependencyIds: [`${pack}:base-helper`]
    });
    expect(result.preview.agents.find((agent) => agent.agentId === 'codex')?.effectiveSkills)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({skillId: `${pack}:review-helper`, version: '1.2.0'}),
        expect.objectContaining({skillId: `${pack}:base-helper`, version: '1.0.0'})
      ]));
  });

  it('recomputes previous effective roots so removing a saved bundle removes its links', () => {
    const previous = config({selectedBundleIds: [bundleRef]});
    const result = createWizardSelectionPlan({
      adapters: getAgentAdapters(),
      skills: skills(),
      bundles: bundles(),
      draftAgents: drafts({codex: {}}),
      config: previous
    });

    expect(result.linkPlan.operations.map((operation) => `${operation.type}:${operation.skillId}`)).toEqual([
      `remove-link:${pack}:base-helper`,
      `remove-link:${pack}:review-helper`
    ]);
  });

  it('blocks a bundle whose effective member does not support an enabled agent', () => {
    const result = createWizardSelectionPlan({
      adapters: getAgentAdapters(),
      skills: skills().map((skill) =>
        skill.id === 'review-helper' ? {...skill, supportedAgents: ['codex']} : skill
      ),
      bundles: bundles(),
      draftAgents: drafts({claude: {selectedBundleIds: [bundleRef]}}),
      config: config()
    });

    expect(result.linkPlan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'bundle-not-supported-by-agent', agentId: 'claude'})
    ]));
  });

  it('keeps recommendations visible without selecting them', () => {
    const selected = `${pack}:review-helper`;
    const result = createWizardSelectionPlan({
      adapters: getAgentAdapters(),
      skills: skills().map((skill) =>
        skill.id === 'review-helper' ? {...skill, recommends: [`${pack}:optional-helper`]} : skill
      ),
      bundles: bundles(),
      draftAgents: drafts({codex: {selectedSkillIds: [selected]}}),
      config: config()
    });

    expect(result.linkPlan.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'recommendation-not-selected', skillId: `${pack}:optional-helper`})
    ]));
    expect(result.linkPlan.operations.map((operation) => operation.skillId)).not.toContain(`${pack}:optional-helper`);
  });
});

function skill(id: string, options: Partial<DiscoveredSkill> = {}): DiscoveredSkill {
  return {
    skillpackId: pack,
    ref: `${pack}:${id}`,
    id,
    version: '1.0.0',
    title: id,
    description: `${id} description`,
    supportedAgents: ['claude', 'codex'],
    tags: [],
    domains: [],
    tasks: [],
    languages: [],
    technologies: [],
    platforms: [],
    keywords: [],
    useCases: [],
    nonGoals: [],
    requires: [],
    recommends: [],
    conflictsWith: [],
    relativePath: `skills/${id}`,
    absolutePath: `/tmp/skillpack/skills/${id}`,
    skillFilePath: `/tmp/skillpack/skills/${id}/SKILL.md`,
    frontmatter: {name: id, description: `${id} description`},
    riskWarnings: [],
    ...options
  };
}

function skills(): DiscoveredSkill[] {
  return [
    skill('base-helper'),
    skill('optional-helper'),
    skill('review-helper', {version: '1.2.0', requires: [`${pack}:base-helper`]})
  ];
}

function bundles(): DiscoveredBundle[] {
  return [{
    skillpackId: pack,
    ref: bundleRef,
    id: 'review-flow',
    version: '2.1.0',
    title: 'Review Flow',
    description: 'A maintained review workflow.',
    tags: ['review'],
    keywords: ['review'],
    members: [{id: 'review-helper', ref: `${pack}:review-helper`, versionRange: '^1.0.0', actualVersion: '1.2.0'}]
  }];
}

function drafts(
  overrides: Partial<Record<AgentId, Partial<WizardSelectionDraft>>> = {}
): Record<AgentId, WizardSelectionDraft> {
  return Object.fromEntries(getAgentAdapters().map((adapter) => [
    adapter.id,
    {
      enabled: overrides[adapter.id] !== undefined,
      targetPath: `/tmp/${adapter.id}`,
      selectedSkillIds: [],
      selectedBundleIds: [],
      ...overrides[adapter.id]
    }
  ])) as Record<AgentId, WizardSelectionDraft>;
}

function config(codex: {selectedBundleIds?: string[]} = {}): ManagerConfig {
  return {
    version: 3,
    managerStateDir: '/tmp/corvus',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    skillpack: {
      id: pack,
      repositoryUrl: 'https://example.com/corvus.git',
      branch: 'main',
      checkoutPath: '/tmp/skillpack'
    },
    agents: {
      codex: {
        enabled: true,
        targetPath: '/tmp/codex',
        selectedSkillIds: [],
        selectedBundleIds: codex.selectedBundleIds ?? []
      }
    }
  };
}
