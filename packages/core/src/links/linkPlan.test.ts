import {describe, expect, it} from 'vitest';
import {getAgentAdapters} from '../agents/adapters.js';
import {generateLinkPlan} from './linkPlan.js';

describe('generateLinkPlan', () => {
  it('creates deterministic link operations for selected supported agents and skills', () => {
    const plan = generateLinkPlan({
      adapters: getAgentAdapters(),
      homeDir: '/tmp/home',
      skills: [
        {id: 'review', absolutePath: '/packs/corvus/skills/review'},
        {id: 'commit', absolutePath: '/packs/corvus/skills/commit'}
      ],
      selections: [
        {
          agentId: 'codex',
          enabled: true,
          selectedSkillIds: ['review', 'commit']
        },
        {
          agentId: 'claude',
          enabled: true,
          targetPath: '~/custom-claude',
          selectedSkillIds: ['review']
        }
      ]
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.operations).toEqual([
      {
        type: 'create-link',
        agentId: 'claude',
        skillId: 'review',
        sourcePath: '/packs/corvus/skills/review',
        targetPath: '/tmp/home/custom-claude/review'
      },
      {
        type: 'create-link',
        agentId: 'codex',
        skillId: 'commit',
        sourcePath: '/packs/corvus/skills/commit',
        targetPath: '/tmp/home/.agents/skills/commit'
      },
      {
        type: 'create-link',
        agentId: 'codex',
        skillId: 'review',
        sourcePath: '/packs/corvus/skills/review',
        targetPath: '/tmp/home/.agents/skills/review'
      }
    ]);
  });

  it('plans removals for previously selected skills that are no longer selected', () => {
    const plan = generateLinkPlan({
      adapters: getAgentAdapters(),
      homeDir: '/tmp/home',
      skills: [{id: 'review', absolutePath: '/packs/corvus/skills/review'}],
      selections: [
        {
          agentId: 'codex',
          enabled: true,
          selectedSkillIds: ['review'],
          previousSelectedSkillIds: ['review', 'old-skill']
        }
      ]
    });

    expect(plan.operations).toContainEqual({
      type: 'remove-link',
      agentId: 'codex',
      skillId: 'old-skill',
      targetPath: '/tmp/home/.agents/skills/old-skill'
    });
  });

  it('reports conflicts for unmanaged existing targets without resolving them', () => {
    const plan = generateLinkPlan({
      adapters: getAgentAdapters(),
      homeDir: '/tmp/home',
      skills: [{id: 'review', absolutePath: '/packs/corvus/skills/review'}],
      targetStates: [
        {
          path: '/tmp/home/.agents/skills/review',
          exists: true,
          managed: false
        }
      ],
      selections: [
        {
          agentId: 'codex',
          enabled: true,
          selectedSkillIds: ['review']
        }
      ]
    });

    expect(plan.operations).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        code: 'unmanaged-target-exists',
        agentId: 'codex',
        skillId: 'review'
      })
    ]);
  });

  it('skips Gemini as deferred', () => {
    const plan = generateLinkPlan({
      adapters: getAgentAdapters(),
      skills: [{id: 'review', absolutePath: '/packs/corvus/skills/review'}],
      selections: [
        {
          agentId: 'gemini',
          enabled: true,
          selectedSkillIds: ['review']
        }
      ]
    });

    expect(plan.operations).toEqual([]);
    expect(plan.warnings).toEqual([
      expect.objectContaining({
        code: 'agent-not-supported',
        agentId: 'gemini'
      })
    ]);
  });
});
