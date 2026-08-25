import path from 'node:path';
import {z} from 'zod';
import {defaultSkillpackCheckoutPath} from '../paths.js';
import {
  defaultSkillpackBranch,
  defaultSkillpackId,
  defaultSkillpackRepositoryUrl
} from '../skillpackDefaults.js';

export const agentIdSchema = z.enum(['codex', 'claude', 'copilot', 'opencode', 'pi', 'custom', 'gemini']);

export const skillpackIdPattern = /^[a-zA-Z0-9._-]+$/;
export const skillReferencePattern = /^[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+$/;

const qualifiedReferenceSchema = z
  .string()
  .regex(skillReferencePattern, 'Use a qualified <skillpack-id>:<local-id> reference.');

const canonicalQualifiedReferencesSchema = z
  .array(qualifiedReferenceSchema)
  .transform((references) => uniqueSorted(references));

export const skillpackConfigSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(skillpackIdPattern, 'Use only letters, numbers, dots, underscores, and hyphens.'),
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1),
    checkoutPath: z.string().min(1)
  })
  .strict();

const legacyAgentConfigSchema = z
  .object({
    enabled: z.boolean(),
    targetPath: z.string().min(1).optional(),
    /** v1 contains local IDs; v2 stores qualified `<skillpack-id>:<skill-id>` references. */
    selectedSkillIds: z.array(z.string().min(1)).default([])
  })
  .strict();

type LegacyAgentConfig = z.infer<typeof legacyAgentConfigSchema>;

/** Manager Config v3 stores only explicit skill and bundle roots. */
export const agentConfigSchema = z
  .object({
    enabled: z.boolean(),
    targetPath: z.string().min(1).optional(),
    selectedSkillIds: canonicalQualifiedReferencesSchema.default([]),
    selectedBundleIds: canonicalQualifiedReferencesSchema.default([])
  })
  .strict();

const managerConfigFields = {
  managerStateDir: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
};

const persistedManagerConfigV1Schema = z
  .object({
    version: z.literal(1),
    ...managerConfigFields,
    skillpack: skillpackConfigSchema.optional(),
    agents: z.record(agentIdSchema, legacyAgentConfigSchema).optional()
  })
  .strict();

const persistedManagerConfigV2Schema = z
  .object({
    version: z.literal(2),
    ...managerConfigFields,
    /** Accepted for compatibility with early v2 files; normalized to `skillpacks`. */
    skillpack: skillpackConfigSchema.optional(),
    skillpacks: z.record(skillpackConfigSchema).optional(),
    agents: z.record(agentIdSchema, legacyAgentConfigSchema).optional()
  })
  .strict()
  .superRefine(validateSkillpackMapKeys);

const persistedManagerConfigV3Schema = z
  .object({
    version: z.literal(3),
    ...managerConfigFields,
    skillpacks: z.record(skillpackConfigSchema),
    agents: z.record(agentIdSchema, agentConfigSchema).optional()
  })
  .strict()
  .superRefine(validateSkillpackMapKeys);

/**
 * Persisted v1/v2/v3 inputs are accepted. `parseManagerConfig` always returns the normalized v3
 * shape without writing it back, keeping read-only commands side-effect free.
 */
const persistedManagerConfigSchema = z.union([
  persistedManagerConfigV1Schema,
  persistedManagerConfigV2Schema,
  persistedManagerConfigV3Schema
]);

export interface ManagerConfig {
  version: 3;
  managerStateDir: string;
  createdAt: string;
  updatedAt: string;
  /** Legacy single-pack alias retained as a non-enumerable in-memory compatibility property. */
  skillpack?: SkillpackConfig;
  skillpacks: Record<string, SkillpackConfig>;
  agents?: Partial<Record<AgentIdConfig, AgentConfig>>;
}

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AgentIdConfig = z.infer<typeof agentIdSchema>;
export type SkillpackConfig = z.infer<typeof skillpackConfigSchema>;
export type PersistedManagerConfig = z.input<typeof persistedManagerConfigSchema>;

// Kept as the public schema export. Parsing through it accepts persisted v1/v2/v3 data.
export const managerConfigSchema = persistedManagerConfigSchema;

export function qualifySkillId(skillpackId: string, skillId: string): string {
  return qualifyReference(skillpackId, skillId);
}

export function qualifyBundleId(skillpackId: string, bundleId: string): string {
  return qualifyReference(skillpackId, bundleId);
}

export function parseSkillReference(reference: string): {skillpackId: string; skillId: string} | undefined {
  const parsed = parseQualifiedReference(reference);
  return parsed === undefined ? undefined : {skillpackId: parsed.skillpackId, skillId: parsed.localId};
}

export function parseBundleReference(reference: string): {skillpackId: string; bundleId: string} | undefined {
  const parsed = parseQualifiedReference(reference);
  return parsed === undefined ? undefined : {skillpackId: parsed.skillpackId, bundleId: parsed.localId};
}

export function resolveSkillReference(reference: string, fallbackSkillpackId = defaultSkillpackId): string {
  return parseSkillReference(reference) === undefined ? qualifySkillId(fallbackSkillpackId, reference) : reference;
}

export function resolveBundleReference(reference: string, fallbackSkillpackId = defaultSkillpackId): string {
  return parseBundleReference(reference) === undefined ? qualifyBundleId(fallbackSkillpackId, reference) : reference;
}

export function getSkillpacks(config: ManagerConfig | undefined): SkillpackConfig[] {
  const configured = config?.skillpacks ?? {};
  return Object.values(configured).sort((left, right) => {
    if (left.id === defaultSkillpackId) return -1;
    if (right.id === defaultSkillpackId) return 1;
    return left.id.localeCompare(right.id);
  });
}

export function getSkillpack(config: ManagerConfig | undefined, id = defaultSkillpackId): SkillpackConfig | undefined {
  return config?.skillpacks[id] ?? (config?.skillpack?.id === id ? config.skillpack : undefined);
}

/** Returns canonical local bundle roots selected by enabled agents for one skillpack. */
export function getSelectedBundleIdsForSkillpack(
  config: ManagerConfig | undefined,
  skillpackId: string
): string[] {
  const selected = new Set<string>();

  for (const agent of Object.values(config?.agents ?? {})) {
    if (agent?.enabled !== true) continue;
    for (const bundleRef of agent?.selectedBundleIds ?? []) {
      const parsed = parseBundleReference(bundleRef);
      if (parsed?.skillpackId === skillpackId) selected.add(parsed.bundleId);
    }
  }

  return [...selected].sort((left, right) => left.localeCompare(right));
}

export function parseManagerConfig(value: unknown): ManagerConfig {
  const parsed = persistedManagerConfigSchema.parse(value);

  if (parsed.version === 3) {
    return withPrimaryAlias({
      version: 3,
      managerStateDir: parsed.managerStateDir,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      skillpacks: {...parsed.skillpacks},
      ...(parsed.agents === undefined ? {} : {agents: parsed.agents})
    });
  }

  if (parsed.version === 2) {
    const skillpacks: Record<string, SkillpackConfig> = {
      ...(parsed.skillpacks ?? (parsed.skillpack === undefined ? {} : {[parsed.skillpack.id]: parsed.skillpack}))
    };
    if (skillpacks[defaultSkillpackId] === undefined) {
      skillpacks[defaultSkillpackId] = createDefaultSkillpackConfig(
        path.dirname(path.dirname(parsed.managerStateDir))
      );
    }
    const agents = normalizeLegacyAgentSelections(parsed.agents, defaultSkillpackId);
    return withPrimaryAlias({
      version: 3,
      managerStateDir: parsed.managerStateDir,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      skillpacks,
      ...(agents === undefined ? {} : {agents})
    });
  }

  const legacySkillpack = parsed.skillpack;
  const skillpacks: Record<string, SkillpackConfig> = {
    ...(legacySkillpack === undefined ? {} : {[legacySkillpack.id]: legacySkillpack})
  };

  if (legacySkillpack === undefined || legacySkillpack.id !== defaultSkillpackId) {
    skillpacks[defaultSkillpackId] = createDefaultSkillpackConfig(
      path.dirname(path.dirname(parsed.managerStateDir))
    );
  }

  const legacySelectionPackId = legacySkillpack?.id ?? defaultSkillpackId;
  const agents = normalizeLegacyAgentSelections(parsed.agents, legacySelectionPackId);

  return withPrimaryAlias({
    version: 3,
    managerStateDir: parsed.managerStateDir,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    skillpacks,
    ...(agents === undefined ? {} : {agents})
  }, legacySkillpack?.id);
}

function normalizeLegacyAgentSelections(
  agents: Partial<Record<AgentIdConfig, LegacyAgentConfig>> | undefined,
  fallbackSkillpackId: string
): Partial<Record<AgentIdConfig, AgentConfig>> | undefined {
  if (agents === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(agents).map(([agentId, agent]) => [
      agentId,
      {
        ...agent,
        selectedSkillIds: uniqueSorted(
          agent.selectedSkillIds.map((id) => resolveSkillReference(id, fallbackSkillpackId))
        ),
        selectedBundleIds: []
      }
    ])
  );
}

export function parseSkillpackConfig(value: unknown): SkillpackConfig {
  return skillpackConfigSchema.parse(value);
}

export function createDefaultSkillpackConfig(homeDir?: string): SkillpackConfig {
  return {
    id: defaultSkillpackId,
    repositoryUrl: defaultSkillpackRepositoryUrl,
    branch: defaultSkillpackBranch,
    checkoutPath: defaultSkillpackCheckoutPath(defaultSkillpackId, homeDir)
  };
}

export function createDefaultManagerConfig(options: {
  managerStateDir: string;
  homeDir?: string;
  now?: Date;
}): ManagerConfig {
  const timestamp = (options.now ?? new Date()).toISOString();
  const defaultSkillpack = createDefaultSkillpackConfig(options.homeDir);

  return withPrimaryAlias({
    version: 3,
    managerStateDir: options.managerStateDir,
    createdAt: timestamp,
    updatedAt: timestamp,
    skillpacks: {[defaultSkillpack.id]: defaultSkillpack}
  });
}

function withPrimaryAlias(config: ManagerConfig, preferredId = defaultSkillpackId): ManagerConfig {
  const primary = config.skillpacks[preferredId] ?? Object.values(config.skillpacks)[0];

  if (primary !== undefined) {
    Object.defineProperty(config, 'skillpack', {
      value: primary,
      enumerable: false,
      configurable: true,
      writable: true
    });
  }

  return config;
}

function qualifyReference(skillpackId: string, localId: string): string {
  return `${skillpackId}:${localId}`;
}

function parseQualifiedReference(reference: string): {skillpackId: string; localId: string} | undefined {
  const separator = reference.indexOf(':');

  if (separator <= 0 || separator === reference.length - 1 || reference.indexOf(':', separator + 1) !== -1) {
    return undefined;
  }

  return {skillpackId: reference.slice(0, separator), localId: reference.slice(separator + 1)};
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function validateSkillpackMapKeys(
  value: {skillpacks?: Record<string, SkillpackConfig> | undefined},
  context: z.RefinementCtx
): void {
  for (const [id, skillpack] of Object.entries(value.skillpacks ?? {})) {
    if (id !== skillpack.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['skillpacks', id, 'id'],
        message: `Skillpack map key "${id}" must match its id "${skillpack.id}".`
      });
    }
  }
}
