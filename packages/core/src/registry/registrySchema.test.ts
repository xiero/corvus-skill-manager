import {describe, expect, it} from 'vitest';
import {
  normalizeProseList,
  normalizeSkillIdList,
  normalizeToken,
  normalizeTokenList,
  registryLimits,
  registrySkillEntryV1Schema,
  registrySkillEntryV2Schema,
  registrySkillEntryV3Schema,
  registryBundleV3Schema,
  semanticMetadataFields,
  skillRegistryV1Schema,
  skillRegistryV2Schema,
  skillRegistryV3Schema,
  skillRegistrySchema
} from './registrySchema.js';

const v1Entry = {
  id: 'git-commit',
  path: 'skills/git-commit',
  title: 'Git Commit',
  description: 'Writes conventional commit messages.',
  supportedAgents: ['codex', 'claude'],
  tags: ['git']
};

const v2Entry = {
  ...v1Entry,
  id: 'embedded-driver-development',
  path: 'skills/embedded-driver-development',
  title: 'Embedded Driver Development',
  description: 'Helps implement and review embedded C/C++ drivers.',
  tags: ['firmware'],
  domains: ['embedded', 'firmware'],
  tasks: ['driver-development', 'debugging', 'code-review'],
  languages: ['c', 'cpp'],
  technologies: ['cmake', 'gcc', 'stm32'],
  platforms: ['bare-metal', 'rtos'],
  keywords: ['hal', 'registers', 'interrupts', 'peripherals'],
  useCases: ['Implement a new peripheral driver'],
  nonGoals: ['General-purpose web application development'],
  requires: [],
  recommends: ['embedded-testing'],
  conflictsWith: []
};

const v3Dependency = {
  ...v1Entry,
  id: 'git-basics',
  version: '1.5.0'
};

const v3Entry = {
  ...v2Entry,
  version: '2.1.0',
  requires: [{id: 'git-basics', version: '^1.4.0'}]
};

const v3Bundle = {
  id: 'review-workflow',
  version: '1.0.0',
  title: 'Review Workflow',
  description: 'A maintained review composition.',
  skills: [
    {id: 'embedded-driver-development', version: '~2.1.0'},
    {id: 'git-basics', version: '>=1.4.0 <2.0.0'}
  ],
  tags: ['review'],
  keywords: ['quality gate']
};

describe('registry v1 compatibility', () => {
  it('accepts an unmodified v1 entry under both v1 and v2 schemas', () => {
    expect(registrySkillEntryV1Schema.safeParse(v1Entry).success).toBe(true);
    expect(registrySkillEntryV2Schema.safeParse(v1Entry).success).toBe(true);
  });

  it('accepts a v1 registry with and without a declared version', () => {
    expect(skillRegistryV1Schema.safeParse({skills: [v1Entry]}).success).toBe(true);
    expect(skillRegistryV1Schema.safeParse({version: 1, skills: [v1Entry]}).success).toBe(true);
    expect(skillRegistrySchema.safeParse({skills: [v1Entry]}).success).toBe(true);
  });

  it('rejects v2 semantic fields under the explicit v1 entry schema', () => {
    expect(registrySkillEntryV1Schema.safeParse(v2Entry).success).toBe(false);
  });
});

describe('registry v2', () => {
  it('accepts a fully populated v2 entry and registry', () => {
    expect(registrySkillEntryV2Schema.safeParse(v2Entry).success).toBe(true);
    expect(skillRegistryV2Schema.safeParse({version: 2, skills: [v1Entry, v2Entry]}).success).toBe(true);
  });

  it('rejects misspelled fields in both versions', () => {
    expect(registrySkillEntryV2Schema.safeParse({...v2Entry, domain: ['embedded']}).success).toBe(false);
    expect(registrySkillEntryV2Schema.safeParse({...v2Entry, recommend: ['x']}).success).toBe(false);
    expect(registrySkillEntryV1Schema.safeParse({...v1Entry, tag: ['git']}).success).toBe(false);
  });

  it('rejects blank, untrimmed, and oversized metadata values', () => {
    expect(registrySkillEntryV2Schema.safeParse({...v2Entry, domains: ['']}).success).toBe(false);
    expect(registrySkillEntryV2Schema.safeParse({...v2Entry, domains: [' embedded ']}).success).toBe(false);
    expect(registrySkillEntryV2Schema.safeParse({...v2Entry, domains: ['   ']}).success).toBe(false);
    expect(
      registrySkillEntryV2Schema.safeParse({...v2Entry, domains: ['a'.repeat(registryLimits.tokenLength + 1)]}).success
    ).toBe(false);
    expect(
      registrySkillEntryV2Schema.safeParse({...v2Entry, useCases: ['a'.repeat(registryLimits.proseLength + 1)]}).success
    ).toBe(false);
  });

  it('rejects oversized arrays', () => {
    const tooManyTokens = Array.from({length: registryLimits.tokenArrayLength + 1}, (_, index) => `t${index}`);
    const tooManyUseCases = Array.from({length: registryLimits.proseArrayLength + 1}, (_, index) => `Case ${index}`);

    expect(registrySkillEntryV2Schema.safeParse({...v2Entry, keywords: tooManyTokens}).success).toBe(false);
    expect(registrySkillEntryV2Schema.safeParse({...v2Entry, useCases: tooManyUseCases}).success).toBe(false);
  });

  it('rejects relationship targets that are not valid skill IDs', () => {
    expect(registrySkillEntryV2Schema.safeParse({...v2Entry, requires: ['not a skill id']}).success).toBe(false);
  });

  it('reports the offending field path for invalid metadata', () => {
    const parsed = registrySkillEntryV2Schema.safeParse({...v2Entry, languages: ['C ']});

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['languages', 0]);
    }
  });

  it('covers every documented semantic field', () => {
    for (const field of semanticMetadataFields) {
      expect(Object.keys(v2Entry)).toContain(field);
    }
  });
});

describe('registry v3', () => {
  it('requires canonical skill versions without changing v1/v2 parsing', () => {
    expect(skillRegistryV1Schema.safeParse({version: 1, skills: [v1Entry]}).success).toBe(true);
    expect(skillRegistryV2Schema.safeParse({version: 2, skills: [v2Entry]}).success).toBe(true);
    expect(registrySkillEntryV3Schema.safeParse(v3Entry).success).toBe(true);
    expect(registrySkillEntryV3Schema.safeParse({...v3Entry, version: undefined}).success).toBe(false);
    expect(registrySkillEntryV3Schema.safeParse({...v3Entry, version: 'v2.1.0'}).success).toBe(false);
    expect(registrySkillEntryV3Schema.safeParse({...v3Entry, version: '2.1'}).success).toBe(false);
  });

  it.each(['1.5.0', '^1.4.0', '~1.4.0', '>=1.4.0 <2.0.0'])(
    'accepts the hard-dependency range %s',
    (version) => {
      expect(
        registrySkillEntryV3Schema.safeParse({...v3Entry, requires: [{id: 'git-basics', version}]})
          .success
      ).toBe(true);
    }
  );

  it('rejects legacy strings and malformed dependency references in v3', () => {
    expect(registrySkillEntryV3Schema.safeParse({...v3Entry, requires: ['git-basics']}).success).toBe(false);
    expect(
      registrySkillEntryV3Schema.safeParse({...v3Entry, requires: [{id: 'bad id', version: '^1.0.0'}]}).success
    ).toBe(false);
    expect(
      registrySkillEntryV3Schema.safeParse({...v3Entry, requires: [{id: 'git-basics', version: 'not-a-range'}]}).success
    ).toBe(false);
    expect(
      registrySkillEntryV3Schema.safeParse({...v3Entry, requires: [{id: 'git-basics', version: '^1.0.0', extra: true}]}).success
    ).toBe(false);
  });

  it('accepts bundles and an explicitly empty bundle collection', () => {
    expect(registryBundleV3Schema.safeParse(v3Bundle).success).toBe(true);
    expect(
      skillRegistryV3Schema.safeParse({version: 3, skills: [v3Entry, v3Dependency], bundles: []}).success
    ).toBe(true);
    expect(
      skillRegistryV3Schema.safeParse({version: 3, skills: [v3Entry, v3Dependency], bundles: [v3Bundle]}).success
    ).toBe(true);
  });

  it('rejects empty, duplicate, malformed, qualified, and over-specified bundle members', () => {
    expect(registryBundleV3Schema.safeParse({...v3Bundle, skills: []}).success).toBe(false);
    expect(
      registryBundleV3Schema.safeParse({...v3Bundle, skills: [v3Bundle.skills[0], v3Bundle.skills[0]]}).success
    ).toBe(false);
    expect(
      registryBundleV3Schema.safeParse({...v3Bundle, skills: [{id: 'bad id', version: '^1.0.0'}]}).success
    ).toBe(false);
    expect(
      registryBundleV3Schema.safeParse({...v3Bundle, skills: [{id: 'team:git-basics', version: '^1.0.0'}]}).success
    ).toBe(false);
    expect(
      registryBundleV3Schema.safeParse({...v3Bundle, skills: [{id: 'git-basics', version: '^1.0.0', type: 'bundle'}]}).success
    ).toBe(false);
  });

  it('rejects invalid bundle IDs, versions, member ranges, unknown fields, and duplicate bundle IDs', () => {
    expect(registryBundleV3Schema.safeParse({...v3Bundle, id: 'bad id'}).success).toBe(false);
    expect(registryBundleV3Schema.safeParse({...v3Bundle, version: '1'}).success).toBe(false);
    expect(
      registryBundleV3Schema.safeParse({...v3Bundle, skills: [{id: 'git-basics', version: ''}]}).success
    ).toBe(false);
    expect(registryBundleV3Schema.safeParse({...v3Bundle, path: 'bundles/review'}).success).toBe(false);
    expect(
      skillRegistryV3Schema.safeParse({
        version: 3,
        skills: [v3Entry, v3Dependency],
        bundles: [v3Bundle, {...v3Bundle, title: 'Duplicate'}]
      }).success
    ).toBe(false);
  });
});

describe('normalization rules', () => {
  it('lowercases, trims, and collapses whitespace in tokens', () => {
    expect(normalizeToken('  Bare   Metal ')).toBe('bare metal');
    expect(normalizeTokenList(['C', 'c', 'CPP', ' cpp '])).toEqual(['c', 'cpp']);
    expect(normalizeTokenList(undefined)).toEqual([]);
  });

  it('preserves first-seen order when deduplicating', () => {
    expect(normalizeTokenList(['zeta', 'alpha', 'ZETA'])).toEqual(['zeta', 'alpha']);
  });

  it('keeps authored casing for prose but dedupes case-insensitively', () => {
    expect(normalizeProseList(['Implement a driver', 'implement a driver', '  Test it  '])).toEqual([
      'Implement a driver',
      'Test it'
    ]);
  });

  it('dedupes skill IDs exactly and case-sensitively', () => {
    expect(normalizeSkillIdList(['a', 'a', 'A'])).toEqual(['a', 'A']);
    expect(normalizeSkillIdList(undefined)).toEqual([]);
  });
});
