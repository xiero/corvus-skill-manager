import {z} from 'zod';
import {parseSemanticVersion, parseSemanticVersionRange} from '../versioning/semver.js';

export const supportedAgentSchema = z.enum([
  'codex',
  'claude',
  'copilot',
  'opencode',
  'pi',
  'custom',
  'gemini'
]);

export const skillIdPattern = /^[a-zA-Z0-9._-]+$/;

/**
 * Bounds for registry v2/v3 catalog metadata. They keep catalog/search output token-efficient
 * and stop a skillpack from producing unbounded machine payloads. They do not change v1 fields.
 */
export const registryLimits = {
  tokenLength: 64,
  tokenArrayLength: 32,
  proseLength: 280,
  proseArrayLength: 16,
  relationshipArrayLength: 32
} as const;

export const skillIdSchema = z
  .string()
  .min(1)
  .regex(skillIdPattern, 'Use only letters, numbers, dots, underscores, and hyphens.');

/**
 * A short classification token: trimmed, non-empty, bounded. Tokens are compared
 * case-insensitively during normalization (see `normalizeToken`).
 */
const tokenSchema = z
  .string()
  .min(1)
  .max(registryLimits.tokenLength)
  .refine((value) => value.trim() !== '', {message: 'Must not be blank.'})
  .refine((value) => value === value.trim(), {message: 'Must not have leading or trailing whitespace.'});

/** A short sentence: trimmed, non-empty, bounded. */
const proseSchema = z
  .string()
  .min(1)
  .max(registryLimits.proseLength)
  .refine((value) => value.trim() !== '', {message: 'Must not be blank.'})
  .refine((value) => value === value.trim(), {message: 'Must not have leading or trailing whitespace.'});

const tokenArraySchema = z.array(tokenSchema).max(registryLimits.tokenArrayLength);
const proseArraySchema = z.array(proseSchema).max(registryLimits.proseArrayLength);
const relationshipArraySchema = z.array(skillIdSchema).max(registryLimits.relationshipArrayLength);

export const semanticVersionSchema = z.string().superRefine((value, context) => {
  try {
    parseSemanticVersion(value);
  } catch {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Must be a canonical Semantic Versioning 2.0.0 version.'
    });
  }
});

export const semanticVersionRangeSchema = z
  .string()
  .superRefine((value, context) => {
    try {
      parseSemanticVersionRange(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must be a valid, non-empty semantic version range.'
      });
    }
  });

export const versionedSkillReferenceSchema = z
  .object({
    id: skillIdSchema,
    version: semanticVersionRangeSchema
  })
  .strict();

/** Fields present since registry v1. Unchanged, so existing registries stay valid verbatim. */
const registrySkillEntryBaseShape = {
  id: skillIdSchema,
  path: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  supportedAgents: z.array(supportedAgentSchema).min(1),
  tags: z.array(z.string().min(1)).optional()
};

/** Optional semantic classification added in registry v2. */
const registrySkillEntrySemanticShape = {
  domains: tokenArraySchema.optional(),
  tasks: tokenArraySchema.optional(),
  languages: tokenArraySchema.optional(),
  technologies: tokenArraySchema.optional(),
  platforms: tokenArraySchema.optional(),
  keywords: tokenArraySchema.optional(),
  useCases: proseArraySchema.optional(),
  nonGoals: proseArraySchema.optional()
};

/** Optional inter-skill relationships added in registry v2. */
const registrySkillEntryRelationshipShape = {
  requires: relationshipArraySchema.optional(),
  recommends: relationshipArraySchema.optional(),
  conflictsWith: relationshipArraySchema.optional()
};

/** Registry v3 keeps soft relationships local and adds ranges only to hard dependencies. */
const registrySkillEntryV3RelationshipShape = {
  requires: z.array(versionedSkillReferenceSchema).max(registryLimits.relationshipArrayLength).optional(),
  recommends: relationshipArraySchema.optional(),
  conflictsWith: relationshipArraySchema.optional()
};

export const registrySkillEntryV1Schema = z.object(registrySkillEntryBaseShape).strict();

export const registrySkillEntryV2Schema = z
  .object({
    ...registrySkillEntryBaseShape,
    ...registrySkillEntrySemanticShape,
    ...registrySkillEntryRelationshipShape
  })
  .strict();

export const registrySkillEntryV3Schema = z
  .object({
    ...registrySkillEntryBaseShape,
    version: semanticVersionSchema,
    ...registrySkillEntrySemanticShape,
    ...registrySkillEntryV3RelationshipShape
  })
  .strict();

const bundleMemberIdSchema = skillIdSchema.refine((value) => !value.includes(':'), {
  message: 'Bundle members must use an unqualified local skill ID.'
});

export const registryBundleMemberV3Schema = z
  .object({
    id: bundleMemberIdSchema,
    version: semanticVersionRangeSchema
  })
  .strict();

export const registryBundleV3Schema = z
  .object({
    id: skillIdSchema,
    version: semanticVersionSchema,
    title: tokenSchema,
    description: proseSchema,
    skills: z
      .array(registryBundleMemberV3Schema)
      .min(1)
      .max(registryLimits.relationshipArrayLength),
    tags: tokenArraySchema.optional(),
    keywords: tokenArraySchema.optional()
  })
  .strict()
  .superRefine((bundle, context) => {
    const seenMemberIds = new Set<string>();

    bundle.skills.forEach((member, index) => {
      if (seenMemberIds.has(member.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate bundle member "${member.id}".`,
          path: ['skills', index, 'id']
        });
      }

      seenMemberIds.add(member.id);
    });
  });

/**
 * General entry parsing accepts legacy v1/v2 entries and versioned v3 entries. Discovery uses
 * the explicit version schema so v3 requirements cannot leak into legacy registries.
 */
export const registrySkillEntrySchema = z.union([
  registrySkillEntryV2Schema,
  registrySkillEntryV3Schema
]);

export const registryVersions = [1, 2, 3] as const;
export const currentRegistryVersion = 3;

export const skillRegistryV1Schema = z
  .object({
    version: z.literal(1).optional(),
    skills: z.array(registrySkillEntryV1Schema)
  })
  .strict();

export const skillRegistryV2Schema = z
  .object({
    version: z.literal(2),
    skills: z.array(registrySkillEntryV2Schema)
  })
  .strict();

export const skillRegistryV3Schema = z
  .object({
    version: z.literal(3),
    skills: z.array(registrySkillEntryV3Schema),
    bundles: z.array(registryBundleV3Schema)
  })
  .strict()
  .superRefine((registry, context) => {
    const seenBundleIds = new Set<string>();

    registry.bundles.forEach((bundle, index) => {
      if (seenBundleIds.has(bundle.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate bundle id "${bundle.id}".`,
          path: ['bundles', index, 'id']
        });
      }

      seenBundleIds.add(bundle.id);
    });
  });

const skillRegistryV1CompatibleSchema = z
  .object({
    version: z.literal(1).optional(),
    skills: z.array(registrySkillEntryV2Schema)
  })
  .strict();

/**
 * General registry parsing preserves discovery's established tolerance for v2 metadata authored
 * under a v1 declaration, while the explicit v1 schema remains strict for contract tests.
 */
export const skillRegistrySchema = z.union([
  skillRegistryV1CompatibleSchema,
  skillRegistryV2Schema,
  skillRegistryV3Schema
]);

export type SupportedAgent = z.infer<typeof supportedAgentSchema>;
export type RegistrySkillEntry = z.infer<typeof registrySkillEntrySchema>;
export type RegistrySkillEntryV1 = z.infer<typeof registrySkillEntryV1Schema>;
export type RegistrySkillEntryV2 = z.infer<typeof registrySkillEntryV2Schema>;
export type RegistrySkillEntryV3 = z.infer<typeof registrySkillEntryV3Schema>;
export type RegistryBundleMemberV3 = z.infer<typeof registryBundleMemberV3Schema>;
export type RegistryBundleV3 = z.infer<typeof registryBundleV3Schema>;
export type VersionedSkillReference = z.infer<typeof versionedSkillReferenceSchema>;
export type SkillRegistry = z.infer<typeof skillRegistrySchema>;

/** Semantic metadata fields, in the order used for reporting and coverage statistics. */
export const semanticMetadataFields = [
  'domains',
  'tasks',
  'languages',
  'technologies',
  'platforms',
  'keywords',
  'useCases',
  'nonGoals'
] as const;

export type SemanticMetadataField = (typeof semanticMetadataFields)[number];

export const relationshipFields = ['requires', 'recommends', 'conflictsWith'] as const;

export type RelationshipField = (typeof relationshipFields)[number];

/**
 * Case-normalization rule for classification tokens: trim, lowercase, and collapse internal
 * whitespace runs to a single space. Duplicates after normalization are dropped, keeping the
 * first occurrence so authored order is preserved.
 */
export function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeTokenList(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values ?? []) {
    const normalized = normalizeToken(value);

    if (normalized === '' || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

/**
 * Prose is deduplicated case-insensitively but keeps the authored casing of the first
 * occurrence, because these strings are shown to humans and to calling agents.
 */
export function normalizeProseList(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values ?? []) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();

    if (trimmed === '' || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

/** Skill IDs are compared exactly; only duplicates are removed. */
export function normalizeSkillIdList(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values ?? []) {
    const trimmed = value.trim();

    if (trimmed === '' || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

/** Normalizes legacy string dependencies and v3 versioned references to local runtime IDs. */
export function normalizeRequiredSkillIds(
  values: readonly string[] | readonly VersionedSkillReference[] | undefined
): string[] {
  return normalizeSkillIdList(values?.map((value) => (typeof value === 'string' ? value : value.id)));
}

export function parseSkillRegistry(value: unknown): SkillRegistry {
  return skillRegistrySchema.parse(value);
}
