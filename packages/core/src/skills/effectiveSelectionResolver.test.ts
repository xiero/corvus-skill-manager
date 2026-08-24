import {describe, expect, it} from 'vitest';
import type {DiscoveredBundle, DiscoveredSkill} from './skillDiscovery.js';
import {resolveEffectiveSelection} from './effectiveSelectionResolver.js';

describe('effective selection resolver', () => {
  it('composes explicit roots, bundle members, and shared dependencies without duplicates', () => {
    const result = resolveEffectiveSelection({
      rootSkillSelections: [{skillRef: 'team:review', provenance: [{kind: 'explicit', reason: 'explicit'}]}],
      rootBundleRefs: ['team:quality', 'team:workflow'],
      bundles: [bundle('quality', ['test']), bundle('workflow', ['review', 'test'])],
      skills: [
        skill('review', {requires: ['team:foundation']}),
        skill('test', {requires: ['team:foundation']}),
        skill('foundation')
      ]
    });

    expect(result.errors).toEqual([]);
    expect(result.bundleMembersAdded).toEqual(['team:test']);
    expect(result.dependenciesAdded).toEqual(['team:foundation']);
    expect(result.selection.effectiveSkills).toEqual([
      {
        skillRef: 'team:foundation',
        provenance: [
          {kind: 'dependency-of', reason: 'dependency-of:team:review'},
          {kind: 'dependency-of', reason: 'dependency-of:team:test'}
        ]
      },
      {
        skillRef: 'team:review',
        provenance: [
          {kind: 'explicit', reason: 'explicit'},
          {kind: 'bundle-member', reason: 'bundle:team:workflow'}
        ]
      },
      {
        skillRef: 'team:test',
        provenance: [
          {kind: 'bundle-member', reason: 'bundle:team:quality'},
          {kind: 'bundle-member', reason: 'bundle:team:workflow'}
        ]
      }
    ]);
    expect(result.bundleOriginsBySkill).toEqual({
      'team:foundation': ['team:quality', 'team:workflow'],
      'team:review': ['team:workflow'],
      'team:test': ['team:quality', 'team:workflow']
    });
  });

  it('terminates dependency cycles and is deterministic across equivalent root order', () => {
    const skills = [skill('a', {requires: ['team:b']}), skill('b', {requires: ['team:a']})];
    const first = resolveEffectiveSelection({
      rootSkillSelections: [
        {skillRef: 'team:b', provenance: [{kind: 'explicit', reason: 'explicit'}]},
        {skillRef: 'team:a', provenance: [{kind: 'explicit', reason: 'explicit'}]}
      ],
      rootBundleRefs: [], bundles: [], skills
    });
    const second = resolveEffectiveSelection({
      rootSkillSelections: [...first.selection.roots.skillRefs].map((skillRef) => ({
        skillRef,
        provenance: [{kind: 'explicit' as const, reason: 'explicit'}]
      })),
      rootBundleRefs: [], bundles: [], skills
    });

    expect(second).toEqual(first);
    expect(first.selection.effectiveSkills).toHaveLength(2);
  });

  it('reports missing dependencies with transitive bundle provenance', () => {
    const result = resolveEffectiveSelection({
      rootSkillSelections: [],
      rootBundleRefs: ['team:workflow'],
      bundles: [bundle('workflow', ['review'])],
      skills: [skill('review', {requires: ['team:middle']}), skill('middle', {requires: ['team:ghost']})]
    });

    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'required-skill-not-found',
        skillRef: 'team:ghost',
        requiredBy: 'team:middle',
        bundleRefs: ['team:workflow']
      })
    ]);
  });
});

function bundle(id: string, members: readonly string[]): DiscoveredBundle {
  return {
    id, skillpackId: 'team', ref: `team:${id}`, version: '1.0.0', title: id,
    description: `${id} bundle`, tags: [], keywords: [],
    members: members.map((memberId) => ({
      id: memberId, ref: `team:${memberId}`, versionRange: '*', actualVersion: '1.0.0'
    }))
  };
}

function skill(id: string, overrides: Partial<DiscoveredSkill> = {}): DiscoveredSkill {
  return {
    id, skillpackId: 'team', ref: `team:${id}`, title: id, description: `${id} skill`,
    supportedAgents: ['codex'], tags: [], domains: [], tasks: [], languages: [], technologies: [],
    platforms: [], keywords: [], useCases: [], nonGoals: [], requires: [], recommends: [], conflictsWith: [],
    relativePath: `skills/${id}`, absolutePath: `/tmp/skills/${id}`,
    skillFilePath: `/tmp/skills/${id}/SKILL.md`,
    frontmatter: {name: id, description: `${id} skill`}, riskWarnings: [], ...overrides
  };
}
