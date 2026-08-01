import {z} from 'zod';

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
 * Bounds for registry v2 metadata. They keep catalog/search output token-efficient and stop a
 * skillpack from producing unbounded machine payloads. They apply only to fields introduced in
 * v2, so no previously valid v1 registry becomes invalid.
 */
export const registryLimits = {
  tokenLength: 64,
  tokenArrayLength: 32,
  proseLength: 280,
  proseArrayLength: 16,
  relationshipArrayLength: 32
} as const;

const skillIdSchema = z
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

export const registrySkillEntryV1Schema = z.object(registrySkillEntryBaseShape).strict();

export const registrySkillEntryV2Schema = z
  .object({
    ...registrySkillEntryBaseShape,
    ...registrySkillEntrySemanticShape,
    ...registrySkillEntryRelationshipShape
  })
  .strict();

/**
 * The entry schema applied during discovery. v2 is a strict superset of v1, so every valid v1
 * entry validates unchanged while misspelled fields are still rejected.
 */
export const registrySkillEntrySchema = registrySkillEntryV2Schema;

export const registryVersions = [1, 2] as const;
export const currentRegistryVersion = 2;

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

export const skillRegistrySchema = z
  .object({
    version: z.number().int().positive().optional(),
    skills: z.array(registrySkillEntrySchema)
  })
  .strict();

export type SupportedAgent = z.infer<typeof supportedAgentSchema>;
export type RegistrySkillEntry = z.infer<typeof registrySkillEntrySchema>;
export type RegistrySkillEntryV1 = z.infer<typeof registrySkillEntryV1Schema>;
export type RegistrySkillEntryV2 = z.infer<typeof registrySkillEntryV2Schema>;
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

export function parseSkillRegistry(value: unknown): SkillRegistry {
  return skillRegistrySchema.parse(value);
}
