import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
  type AgentId,
  type ManagerConfig,
  type SkillpackConfig,
  discoverSkillpacks,
  getAgentAdapters
} from '@corvus-tools/skill-manager-core';
import {type SkillpackFixture, writeSkillpack} from '../../../../test/support/skillpackFixtures.js';
import {createWizardSelectionPlan, type WizardSelectionDraft} from './wizardSelection.js';

describe('wizard planning from discovered repository metadata', () => {
  let root: string;
  let primary: SkillpackConfig;
  let secondary: SkillpackConfig;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'corvus-wizard-registryless-'));
    primary = packConfig('corvus-skillpack', root);
    secondary = packConfig('team-pack', root);
  });

  afterEach(async () => {
    await fs.rm(root, {recursive: true, force: true});
  });

  it('plans both registryless repositories for Codex, Claude, OpenCode and Gemini', async () => {
    await Promise.all([
      writeSkillpack(primary.checkoutPath, fixture('primary-helper')),
      writeSkillpack(secondary.checkoutPath, fixture('private-review'))
    ]);
    const discovery = await discoverSkillpacks([primary, secondary]);
    expect(discovery.errors).toEqual([]);
    const targetAgents: AgentId[] = ['codex', 'claude', 'opencode', 'gemini'];
    const result = createWizardSelectionPlan({
      adapters: getAgentAdapters(),
      skills: discovery.skills,
      bundles: discovery.bundles,
      draftAgents: drafts(root, targetAgents),
      config: config(root, primary, secondary)
    });

    expect(result.linkPlan.conflicts).toEqual([]);
    expect(result.linkPlan.operations).toHaveLength(8);
    for (const agentId of targetAgents) {
      expect(result.linkPlan.operations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'create-link',
          agentId,
          skillId: 'corvus-skillpack:primary-helper',
          sourcePath: path.join(primary.checkoutPath, 'skills', 'primary-helper'),
          targetPath: path.join(root, 'targets', agentId, 'primary-helper')
        }),
        expect.objectContaining({
          type: 'create-link',
          agentId,
          skillId: 'team-pack:private-review',
          sourcePath: path.join(secondary.checkoutPath, 'skills', 'private-review'),
          targetPath: path.join(root, 'targets', agentId, 'private-review')
        })
      ]));
    }
  });

  it('still blocks Claude for an explicit Codex-only registry skill', async () => {
    await Promise.all([
      writeSkillpack(primary.checkoutPath, fixture('primary-helper')),
      writeSkillpack(secondary.checkoutPath, fixture('private-review', ['codex']))
    ]);
    const discovery = await discoverSkillpacks([primary, secondary]);
    expect(discovery.errors).toEqual([]);
    const result = createWizardSelectionPlan({
      adapters: getAgentAdapters(),
      skills: discovery.skills,
      bundles: discovery.bundles,
      draftAgents: drafts(root, ['claude']),
      config: config(root, primary, secondary)
    });

    expect(result.linkPlan.conflicts).toEqual([
      expect.objectContaining({
        code: 'skill-not-supported-by-agent',
        agentId: 'claude',
        skillId: 'team-pack:private-review'
      })
    ]);
  });
});

function fixture(id: string, supportedAgents?: AgentId[]): SkillpackFixture {
  return {
    ...(supportedAgents === undefined ? {} : {
      registry: {
        version: 1,
        skills: [{id, path: `skills/${id}`, title: id, description: `Use ${id}.`, supportedAgents, tags: []}]
      }
    }),
    skills: [{relativePath: `skills/${id}`, frontmatter: {name: id, description: `Use ${id}.`}, body: `# ${id}`}]
  };
}

function packConfig(id: string, root: string): SkillpackConfig {
  return {id, repositoryUrl: `https://example.invalid/${id}.git`, branch: 'main', checkoutPath: path.join(root, id)};
}

function config(root: string, primary: SkillpackConfig, secondary: SkillpackConfig): ManagerConfig {
  return {
    version: 3,
    managerStateDir: path.join(root, 'state'),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    skillpack: primary,
    skillpacks: {[primary.id]: primary, [secondary.id]: secondary},
    agents: {}
  };
}

function drafts(root: string, enabledAgents: AgentId[]): Record<AgentId, WizardSelectionDraft> {
  return Object.fromEntries(getAgentAdapters().map((adapter) => [adapter.id, {
    enabled: enabledAgents.includes(adapter.id),
    targetPath: path.join(root, 'targets', adapter.id),
    selectedSkillIds: enabledAgents.includes(adapter.id) ? ['corvus-skillpack:primary-helper', 'team-pack:private-review'] : [],
    selectedBundleIds: []
  }])) as Record<AgentId, WizardSelectionDraft>;
}
