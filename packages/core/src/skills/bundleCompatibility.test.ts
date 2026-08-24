import {describe, expect, it} from 'vitest';
import type {DiscoveredBundle, DiscoveredSkill} from './skillDiscovery.js';
import {
  deriveBundleAgentCompatibility,
  deriveBundleSupportedAgents
} from './bundleCompatibility.js';

describe('bundle compatibility', () => {
  it('accepts a bundle only when every member and transitive dependency supports the agent', () => {
    const skills = [
      makeSkill({id: 'review', supportedAgents: ['codex', 'claude'], requires: ['foundation']}),
      makeSkill({id: 'foundation', supportedAgents: ['codex', 'claude']})
    ];
    const bundle = makeBundle(['review']);

    expect(deriveBundleAgentCompatibility(bundle, skills, 'codex')).toEqual({
      agentId: 'codex',
      compatible: true,
      issues: []
    });
    expect(deriveBundleSupportedAgents(bundle, skills)).toEqual(['codex', 'claude']);
  });

  it('reports a direct incompatible member and never treats the bundle as partially compatible', () => {
    const skills = [
      makeSkill({id: 'review', supportedAgents: ['codex', 'claude']}),
      makeSkill({id: 'tests', supportedAgents: ['codex']})
    ];
    const result = deriveBundleAgentCompatibility(makeBundle(['review', 'tests']), skills, 'claude');

    expect(result.compatible).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'bundle-member-unsupported',
        memberId: 'tests',
        skillId: 'tests',
        agentId: 'claude'
      })
    ]);
  });

  it('identifies the direct member and immediate parent for an incompatible transitive dependency', () => {
    const skills = [
      makeSkill({id: 'review', supportedAgents: ['codex', 'claude'], requires: ['foundation']}),
      makeSkill({id: 'foundation', supportedAgents: ['codex'], requires: ['shared']}),
      makeSkill({id: 'shared', supportedAgents: ['codex', 'claude']})
    ];
    const result = deriveBundleAgentCompatibility(makeBundle(['review']), skills, 'claude');

    expect(result.compatible).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'bundle-dependency-unsupported',
        memberId: 'review',
        skillId: 'foundation',
        requiredBy: 'review'
      })
    ]);
  });

  it('reports missing members/dependencies deterministically and terminates dependency cycles', () => {
    const skills = [
      makeSkill({id: 'a', requires: ['missing-dependency', 'b']}),
      makeSkill({id: 'b', requires: ['a']})
    ];
    const bundle = makeBundle(['missing-member', 'a']);
    const first = deriveBundleAgentCompatibility(bundle, skills, 'codex');
    const second = deriveBundleAgentCompatibility(bundle, skills, 'codex');

    expect(second).toEqual(first);
    expect(first.issues.map((issue) => issue.code)).toEqual([
      'bundle-dependency-not-found',
      'bundle-member-not-found'
    ]);
    expect(first.issues[0]).toMatchObject({
      memberId: 'a',
      skillId: 'missing-dependency',
      requiredBy: 'a'
    });
  });
});

function makeBundle(memberIds: readonly string[]): DiscoveredBundle {
  return {
    id: 'workflow',
    version: '1.0.0',
    title: 'Workflow',
    description: 'A test composition.',
    tags: [],
    keywords: [],
    members: memberIds.map((id) => ({id, versionRange: '*', actualVersion: '1.0.0'}))
  };
}

function makeSkill(
  overrides: Partial<DiscoveredSkill> & {id: string}
): DiscoveredSkill {
  return {
    title: overrides.id,
    description: `${overrides.id} description`,
    supportedAgents: ['codex'],
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
    relativePath: `skills/${overrides.id}`,
    absolutePath: `/tmp/skills/${overrides.id}`,
    skillFilePath: `/tmp/skills/${overrides.id}/SKILL.md`,
    frontmatter: {name: overrides.id, description: `${overrides.id} description`},
    riskWarnings: [],
    ...overrides
  };
}
