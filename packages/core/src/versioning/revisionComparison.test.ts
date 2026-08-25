import {describe, expect, it} from 'vitest';
import type {DiscoveredBundle, DiscoveredSkill} from '../skills/skillDiscovery.js';
import {compareSkillpackRevisions, findVersionDisciplineIssues} from './revisionComparison.js';

describe('compareSkillpackRevisions', () => {
  it('classifies deterministic skill and bundle add/remove/version deltas', () => {
    const currentSkills = [
      skill('major', '1.5.0'),
      skill('minor', '1.2.0'),
      skill('patch', '1.2.3'),
      skill('same', '1.0.0'),
      skill('removed', '2.0.0')
    ];
    const candidateSkills = [
      skill('added', '1.0.0'),
      skill('major', '2.0.0'),
      skill('minor', '1.3.0'),
      skill('patch', '1.2.4'),
      skill('same', '1.0.0', {description: 'Changed content.'})
    ];
    const result = compareSkillpackRevisions({
      currentSkills: [...currentSkills].reverse(),
      candidateSkills: [...candidateSkills].reverse(),
      currentBundles: [bundle('flow', '1.0.0', ['same'])],
      candidateBundles: [bundle('flow', '1.1.0', ['same'])]
    });

    expect(result.skillDeltas.map((delta) => [delta.id, delta.change, delta.versionChange])).toEqual([
      ['added', 'added', 'unknown'],
      ['major', 'changed', 'major'],
      ['minor', 'changed', 'minor'],
      ['patch', 'changed', 'patch'],
      ['removed', 'removed', 'unknown'],
      ['same', 'changed', 'same']
    ]);
    expect(result.skillDeltas.find((delta) => delta.id === 'major')?.breakingRisk).toBe(true);
    expect(result.bundleDeltas).toEqual([
      expect.objectContaining({id: 'flow', change: 'changed', versionChange: 'minor'})
    ]);

    const reordered = compareSkillpackRevisions({
      currentSkills,
      candidateSkills,
      currentBundles: [bundle('flow', '1.0.0', ['same'])],
      candidateBundles: [bundle('flow', '1.1.0', ['same'])]
    });
    expect(result).toEqual(reordered);
  });

  it('degrades legacy unversioned changes to an explicit unknown classification', () => {
    const result = compareSkillpackRevisions({
      currentSkills: [skill('legacy')],
      candidateSkills: [skill('legacy', undefined, {description: 'Changed legacy content.'})],
      currentBundles: [],
      candidateBundles: []
    });

    expect(result.skillDeltas).toEqual([
      expect.objectContaining({
        id: 'legacy',
        change: 'changed',
        versionChange: 'unknown',
        breakingRisk: false
      })
    ]);
  });

  it('reports why a selected bundle is affected and flags major member risk', () => {
    const currentSkills = [
      skill('review', '1.4.0', {requires: ['git']}),
      skill('git', '1.0.0'),
      skill('unrelated', '1.0.0')
    ];
    const candidateSkills = [
      skill('review', '2.0.0', {requires: ['git']}),
      skill('git', '1.0.1'),
      skill('unrelated', '1.1.0')
    ];
    const result = compareSkillpackRevisions({
      currentSkills,
      candidateSkills,
      currentBundles: [bundle('selected', '1.0.0', ['review']), bundle('unselected', '1.0.0', ['unrelated'])],
      candidateBundles: [bundle('selected', '1.1.0', ['review', 'git']), bundle('unselected', '1.1.0', ['unrelated'])],
      selectedBundleIds: ['selected']
    });

    expect(result.affectedBundles).toHaveLength(1);
    expect(result.affectedBundles[0]).toMatchObject({bundleId: 'selected', breakingRisk: true});
    expect(result.affectedBundles[0]?.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({kind: 'bundle-changed', entityId: 'selected'}),
      expect.objectContaining({kind: 'member-added', entityId: 'git'}),
      expect.objectContaining({kind: 'effective-skill-changed', entityId: 'review', breakingRisk: true}),
      expect.objectContaining({kind: 'effective-skill-changed', entityId: 'git'})
    ]));
    expect(result.affectedBundles.some((affected) => affected.bundleId === 'unselected')).toBe(false);
  });

  it('does not report a selected bundle for unrelated changes', () => {
    const result = compareSkillpackRevisions({
      currentSkills: [skill('review', '1.0.0'), skill('docs', '1.0.0')],
      candidateSkills: [skill('review', '1.0.0'), skill('docs', '1.1.0')],
      currentBundles: [bundle('selected', '1.0.0', ['review'])],
      candidateBundles: [bundle('selected', '1.0.0', ['review'])],
      selectedBundleIds: ['selected']
    });

    expect(result.affectedBundles).toEqual([]);
  });

  it('explains an unchanged skill newly entering a selected bundle through dependency expansion', () => {
    const result = compareSkillpackRevisions({
      currentSkills: [skill('review', '1.0.0'), skill('helper', '1.0.0')],
      candidateSkills: [skill('review', '1.0.0', {requires: ['helper']}), skill('helper', '1.0.0')],
      currentBundles: [bundle('selected', '1.0.0', ['review'])],
      candidateBundles: [bundle('selected', '1.0.0', ['review'])],
      selectedBundleIds: ['selected']
    });

    expect(result.affectedBundles[0]?.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({kind: 'effective-skill-added', entityId: 'helper'})
    ]));
  });

  it('detects changed skills and bundles whose SemVer precedence was not bumped', () => {
    const inputs = {
      currentSkills: [skill('unchanged', '1.0.0'), skill('same', '1.0.0'), skill('bumped', '1.0.0')],
      candidateSkills: [
        skill('unchanged', '1.0.0'),
        skill('same', '1.0.0', {description: 'Changed without a bump.'}),
        skill('bumped', '1.0.1', {description: 'Changed with a bump.'})
      ],
      currentBundles: [bundle('same-bundle', '2.0.0', ['same']), bundle('bumped-bundle', '2.0.0', ['bumped'])],
      candidateBundles: [
        bundle('same-bundle', '2.0.0+candidate', ['same', 'bumped']),
        bundle('bumped-bundle', '2.1.0', ['bumped', 'same'])
      ]
    };
    const comparison = compareSkillpackRevisions(inputs);

    expect(findVersionDisciplineIssues({comparison, ...inputs})).toEqual([
      {
        code: 'bundle-version-not-bumped',
        entityKind: 'bundle',
        entityId: 'same-bundle',
        declaredVersion: '2.0.0+candidate',
        message: 'Changed bundle "same-bundle" retains SemVer precedence 2.0.0+candidate; declare a maintainer-chosen version bump.'
      },
      {
        code: 'skill-version-not-bumped',
        entityKind: 'skill',
        entityId: 'same',
        declaredVersion: '1.0.0',
        message: 'Changed skill "same" retains SemVer precedence 1.0.0; declare a maintainer-chosen version bump.'
      }
    ]);
  });

  it('passes unchanged entities, changed entities with any precedence bump, and add/remove deltas', () => {
    const inputs = {
      currentSkills: [skill('unchanged', '1.0.0'), skill('bumped', '1.0.0'), skill('removed', '1.0.0')],
      candidateSkills: [
        skill('unchanged', '1.0.0+candidate'),
        skill('bumped', '2.0.0'),
        skill('added', '1.0.0')
      ],
      currentBundles: [bundle('flow', '1.0.0', ['unchanged'])],
      candidateBundles: [bundle('flow', '1.0.1', ['unchanged', 'bumped'])]
    };
    const comparison = compareSkillpackRevisions(inputs);

    expect(findVersionDisciplineIssues({comparison, ...inputs})).toEqual([]);
  });
});

function skill(
  id: string,
  version?: string,
  overrides: Partial<DiscoveredSkill> = {}
): DiscoveredSkill {
  return {
    id,
    ...(version === undefined ? {} : {version}),
    title: id,
    description: `${id} description`,
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
    relativePath: `skills/${id}`,
    absolutePath: `/tmp/current/skills/${id}`,
    skillFilePath: `/tmp/current/skills/${id}/SKILL.md`,
    frontmatter: {name: id, description: `${id} description`},
    riskWarnings: [],
    ...overrides
  };
}

function bundle(id: string, version: string, members: string[]): DiscoveredBundle {
  return {
    id,
    version,
    title: id,
    description: `${id} description`,
    tags: [],
    keywords: [],
    members: members.map((member) => ({
      id: member,
      versionRange: '*'
    }))
  };
}
