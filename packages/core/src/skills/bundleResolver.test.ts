import {describe, expect, it} from 'vitest';
import type {DiscoveredBundle, DiscoveredSkill} from './skillDiscovery.js';
import {expandBundleSelection} from './bundleResolver.js';

describe('bundle resolver', () => {
  it('expands one bundle in authored member order and ignores duplicate roots', () => {
    const result = expandBundleSelection({
      selectedBundleRefs: ['team:workflow', 'team:workflow'],
      bundles: [bundle('workflow', ['review', 'test'])],
      skills: [skill('test'), skill('review')]
    });

    expect(result.errors).toEqual([]);
    expect(result.selections).toEqual([
      {
        skillRef: 'team:review',
        provenance: [{kind: 'bundle-member', reason: 'bundle:team:workflow'}]
      },
      {
        skillRef: 'team:test',
        provenance: [{kind: 'bundle-member', reason: 'bundle:team:workflow'}]
      }
    ]);
  });

  it('deduplicates overlapping members while retaining both bundle origins', () => {
    const result = expandBundleSelection({
      selectedBundleRefs: ['team:z-flow', 'team:a-flow'],
      bundles: [bundle('z-flow', ['shared']), bundle('a-flow', ['shared'])],
      skills: [skill('shared')]
    });

    expect(result.selections).toEqual([
      {
        skillRef: 'team:shared',
        provenance: [
          {kind: 'bundle-member', reason: 'bundle:team:a-flow'},
          {kind: 'bundle-member', reason: 'bundle:team:z-flow'}
        ]
      }
    ]);
  });

  it('returns deterministic blocking errors for unknown, missing, and cross-pack members', () => {
    const result = expandBundleSelection({
      selectedBundleRefs: ['team:unknown', 'team:broken', 'team:cross'],
      bundles: [
        bundle('broken', ['ghost']),
        {...bundle('cross', ['review']), members: [{id: 'review', ref: 'other:review', versionRange: '*'}]}
      ],
      skills: [skill('review')]
    });

    expect(result.errors.map((error) => error.code)).toEqual([
      'bundle-member-not-found',
      'bundle-member-outside-skillpack',
      'bundle-not-found'
    ]);
    expect(expandBundleSelection({
      selectedBundleRefs: ['team:unknown', 'team:broken', 'team:cross'],
      bundles: [
        bundle('broken', ['ghost']),
        {...bundle('cross', ['review']), members: [{id: 'review', ref: 'other:review', versionRange: '*'}]}
      ],
      skills: [skill('review')]
    })).toEqual(result);
  });
});

function bundle(id: string, members: readonly string[]): DiscoveredBundle {
  return {
    id,
    skillpackId: 'team',
    ref: `team:${id}`,
    version: '1.0.0',
    title: id,
    description: `${id} bundle`,
    tags: [],
    keywords: [],
    members: members.map((memberId) => ({
      id: memberId,
      ref: `team:${memberId}`,
      versionRange: '*',
      actualVersion: '1.0.0'
    }))
  };
}

function skill(id: string): DiscoveredSkill {
  return {
    id,
    skillpackId: 'team',
    ref: `team:${id}`,
    title: id,
    description: `${id} skill`,
    supportedAgents: ['codex'],
    tags: [], domains: [], tasks: [], languages: [], technologies: [], platforms: [], keywords: [],
    useCases: [], nonGoals: [], requires: [], recommends: [], conflictsWith: [],
    relativePath: `skills/${id}`,
    absolutePath: `/tmp/skills/${id}`,
    skillFilePath: `/tmp/skills/${id}/SKILL.md`,
    frontmatter: {name: id, description: `${id} skill`},
    riskWarnings: []
  };
}
