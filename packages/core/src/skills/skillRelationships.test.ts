import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {writeSkillpack, v2SkillpackFixture} from '../../../../test/support/skillpackFixtures.js';
import {type DiscoveredSkill, discoverSkillsFromCheckout} from './skillDiscovery.js';
import {
  expandRequiredDependencies,
  findRequiredDependencyCycles,
  findSkillConflicts,
  isSkillSupportedByAgent,
  validateSkillRelationships
} from './skillRelationships.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'corvus-relationships-test-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, {recursive: true, force: true});
});

describe('normalized discovery model', () => {
  it('exposes normalized semantic metadata from a v2 registry', async () => {
    await writeSkillpack(tempRoot, v2SkillpackFixture);

    const result = await discoverSkillsFromCheckout(tempRoot);
    const driverSkill = result.skills.find((skill) => skill.id === 'embedded-driver-development');

    expect(result.source).toBe('registry');
    expect(result.registryVersion).toBe(2);
    expect(result.errors).toEqual([]);
    expect(driverSkill).toMatchObject({
      domains: ['embedded', 'firmware'],
      tasks: ['driver-development', 'debugging', 'code-review'],
      languages: ['c', 'cpp'],
      technologies: ['cmake', 'gcc', 'stm32'],
      platforms: ['bare-metal', 'rtos'],
      keywords: ['hal', 'registers', 'interrupts', 'peripherals'],
      useCases: ['Implement a new peripheral driver'],
      nonGoals: ['General-purpose web application development'],
      requires: ['embedded-toolchain'],
      recommends: ['embedded-testing'],
      conflictsWith: []
    });
  });

  it('normalizes and dedupes metadata written with mixed casing', async () => {
    await writeSkillpack(tempRoot, {
      registry: {
        version: 2,
        skills: [
          {
            id: 'mixed',
            path: 'skills/mixed',
            title: 'Mixed',
            description: 'Mixed casing metadata.',
            supportedAgents: ['codex'],
            languages: ['C', 'c', 'CPP'],
            domains: ['Bare Metal', 'bare  metal']
          }
        ]
      },
      skills: [{relativePath: 'skills/mixed', frontmatter: {name: 'mixed', description: 'Mixed.'}, body: 'Body.'}]
    });

    const result = await discoverSkillsFromCheckout(tempRoot);

    expect(result.skills[0]?.languages).toEqual(['c', 'cpp']);
    expect(result.skills[0]?.domains).toEqual(['bare metal']);
  });

  it('gives registryless skills empty semantic arrays and the registryless tag', async () => {
    await writeSkillpack(tempRoot, {
      skills: [{relativePath: 'solo', frontmatter: {name: 'solo', description: 'Solo skill.'}, body: 'Body.'}]
    });

    const result = await discoverSkillsFromCheckout(tempRoot);

    expect(result.source).toBe('registryless');
    expect(result.registryVersion).toBeUndefined();
    expect(result.skills[0]).toMatchObject({
      id: 'solo',
      supportedAgents: ['codex'],
      tags: ['registryless'],
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
      conflictsWith: []
    });
  });

  it('warns when a v1 registry declares v2 semantic metadata', async () => {
    await writeSkillpack(tempRoot, {
      registry: {
        version: 1,
        skills: [
          {
            id: 'early-adopter',
            path: 'skills/early-adopter',
            title: 'Early Adopter',
            description: 'Uses v2 fields under a v1 version.',
            supportedAgents: ['codex'],
            domains: ['web']
          }
        ]
      },
      skills: [
        {
          relativePath: 'skills/early-adopter',
          frontmatter: {name: 'early-adopter', description: 'Early adopter.'},
          body: 'Body.'
        }
      ]
    });

    const result = await discoverSkillsFromCheckout(tempRoot);

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain('semantic-metadata-in-v1-registry');
  });

  it('reports invalid metadata as a structured discovery error naming the skill and field', async () => {
    await writeSkillpack(tempRoot, {
      registry: {
        version: 2,
        skills: [
          {
            id: 'bad-metadata',
            path: 'skills/bad-metadata',
            title: 'Bad Metadata',
            description: 'Invalid metadata.',
            supportedAgents: ['codex'],
            domains: ['  ']
          }
        ]
      },
      skills: []
    });

    const result = await discoverSkillsFromCheckout(tempRoot);

    expect(result.skills).toEqual([]);
    expect(result.errors[0]?.code).toBe('invalid-skill-entry');
    expect(result.errors[0]?.skillId).toBe('bad-metadata');
    expect(result.errors[0]?.message).toContain('domains.0');
  });
});

describe('relationship validation', () => {
  it('reports unknown requires and conflicts as errors and unknown recommends as a warning', () => {
    const skills = [
      makeSkill({id: 'a', requires: ['missing-required'], conflictsWith: ['missing-conflict'], recommends: ['missing-recommend']})
    ];
    const result = validateSkillRelationships(skills);

    expect(result.errors.map((issue) => issue.code).sort()).toEqual([
      'unknown-conflicting-skill',
      'unknown-required-skill'
    ]);
    expect(result.warnings.map((issue) => issue.code)).toEqual(['unknown-recommended-skill']);
    expect(result.errors[0]?.skillId).toBe('a');
  });

  it('rejects self-dependency and self-conflict', () => {
    const result = validateSkillRelationships([makeSkill({id: 'a', requires: ['a'], conflictsWith: ['a']})]);

    expect(result.errors.map((issue) => issue.code).sort()).toEqual(['self-conflict', 'self-dependency']);
  });

  it('rejects required dependency cycles and reports each cycle once', () => {
    const skills = [
      makeSkill({id: 'a', requires: ['b']}),
      makeSkill({id: 'b', requires: ['c']}),
      makeSkill({id: 'c', requires: ['a']})
    ];
    const cycles = findRequiredDependencyCycles(skills);
    const result = validateSkillRelationships(skills);

    expect(cycles).toHaveLength(1);
    expect(result.errors.filter((issue) => issue.code === 'required-dependency-cycle')).toHaveLength(1);
  });

  it('accepts a diamond dependency graph without reporting a cycle', () => {
    const skills = [
      makeSkill({id: 'a', requires: ['b', 'c']}),
      makeSkill({id: 'b', requires: ['d']}),
      makeSkill({id: 'c', requires: ['d']}),
      makeSkill({id: 'd'})
    ];

    expect(findRequiredDependencyCycles(skills)).toEqual([]);
    expect(validateSkillRelationships(skills).errors).toEqual([]);
  });

  it('surfaces relationship errors through discovery', async () => {
    await writeSkillpack(tempRoot, {
      registry: {
        version: 2,
        skills: [
          {
            id: 'needs-ghost',
            path: 'skills/needs-ghost',
            title: 'Needs Ghost',
            description: 'Requires a skill that does not exist.',
            supportedAgents: ['codex'],
            requires: ['ghost']
          }
        ]
      },
      skills: [
        {relativePath: 'skills/needs-ghost', frontmatter: {name: 'needs-ghost', description: 'Needs.'}, body: 'Body.'}
      ]
    });

    const result = await discoverSkillsFromCheckout(tempRoot);

    expect(result.skills).toHaveLength(1);
    expect(result.errors.map((error) => error.code)).toEqual(['unknown-required-skill']);
  });
});

describe('dependency expansion and compatibility helpers', () => {
  it('expands required dependencies transitively and deterministically', () => {
    const skills = [
      makeSkill({id: 'a', requires: ['b']}),
      makeSkill({id: 'b', requires: ['c']}),
      makeSkill({id: 'c'})
    ];
    const first = expandRequiredDependencies(skills, [
      {skillId: 'a', reason: 'explicit', reasonKind: 'explicit'}
    ]);
    const second = expandRequiredDependencies(skills, [
      {skillId: 'a', reason: 'explicit', reasonKind: 'explicit'}
    ]);

    expect(first.selections).toEqual([
      {skillId: 'a', reason: 'explicit', reasonKind: 'explicit'},
      {skillId: 'b', reason: 'dependency-of:a', reasonKind: 'dependency-of'},
      {skillId: 'c', reason: 'dependency-of:b', reasonKind: 'dependency-of'}
    ]);
    expect(second.selections).toEqual(first.selections);
    expect(first.missing).toEqual([]);
  });

  it('terminates on a required dependency cycle', () => {
    const skills = [makeSkill({id: 'a', requires: ['b']}), makeSkill({id: 'b', requires: ['a']})];
    const result = expandRequiredDependencies(skills, [{skillId: 'a', reason: 'explicit', reasonKind: 'explicit'}]);

    expect(result.selections.map((selection) => selection.skillId)).toEqual(['a', 'b']);
  });

  it('keeps an explicit reason when a skill is also a dependency', () => {
    const skills = [makeSkill({id: 'a', requires: ['b']}), makeSkill({id: 'b'})];
    const result = expandRequiredDependencies(skills, [
      {skillId: 'a', reason: 'explicit', reasonKind: 'explicit'},
      {skillId: 'b', reason: 'explicit', reasonKind: 'explicit'}
    ]);

    expect(result.selections[1]).toEqual({skillId: 'b', reason: 'explicit', reasonKind: 'explicit'});
  });

  it('reports required dependencies that are not discovered', () => {
    const result = expandRequiredDependencies(
      [makeSkill({id: 'a', requires: ['ghost']})],
      [{skillId: 'a', reason: 'explicit', reasonKind: 'explicit'}]
    );

    expect(result.missing).toEqual([{skillId: 'ghost', requiredBy: 'a'}]);
  });

  it('finds declared conflicts symmetrically and reports each pair once', () => {
    const skills = [makeSkill({id: 'a', conflictsWith: ['b']}), makeSkill({id: 'b', conflictsWith: ['a']})];

    expect(findSkillConflicts(skills, ['a', 'b'])).toEqual([{skillId: 'a', conflictsWithSkillId: 'b'}]);
    expect(findSkillConflicts(skills, ['a'])).toEqual([]);
  });

  it('checks agent compatibility from supportedAgents', () => {
    const skill = makeSkill({id: 'a', supportedAgents: ['codex', 'claude']});

    expect(isSkillSupportedByAgent(skill, 'codex')).toBe(true);
    expect(isSkillSupportedByAgent(skill, 'gemini')).toBe(false);
  });
});

function makeSkill(overrides: Partial<DiscoveredSkill> & {id: string}): DiscoveredSkill {
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
    absolutePath: `/tmp/skillpack/skills/${overrides.id}`,
    skillFilePath: `/tmp/skillpack/skills/${overrides.id}/SKILL.md`,
    frontmatter: {name: overrides.id, description: `${overrides.id} description`},
    riskWarnings: [],
    ...overrides
  };
}
