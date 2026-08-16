import {z} from 'zod';
import path from 'node:path';
import {defaultSkillpackCheckoutPath} from '../paths.js';
import {
  defaultSkillpackBranch,
  defaultSkillpackId,
  defaultSkillpackRepositoryUrl
} from '../skillpackDefaults.js';

export const agentIdSchema = z.enum(['codex', 'claude', 'copilot', 'opencode', 'pi', 'custom', 'gemini']);

export const skillpackIdPattern = /^[a-zA-Z0-9._-]+$/;
export const skillReferencePattern = /^[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+$/;

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

export const agentConfigSchema = z
  .object({
    enabled: z.boolean(),
    targetPath: z.string().min(1).optional(),
    /** v1 contains local IDs; v2 stores qualified `<skillpack-id>:<skill-id>` references. */
    selectedSkillIds: z.array(z.string().min(1)).default([])
  })
  .strict();

/**
 * The schema deliberately accepts both persisted versions. `parseManagerConfig` always returns
 * the normalized v2 shape without writing it back, keeping read-only commands side-effect free.
 */
const persistedManagerConfigSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    managerStateDir: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    skillpack: skillpackConfigSchema.optional(),
    skillpacks: z.record(skillpackConfigSchema).optional(),
    agents: z.record(agentIdSchema, agentConfigSchema).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.version === 1 && value.skillpacks !== undefined) {
      context.addIssue({code: z.ZodIssueCode.custom, path: ['skillpacks'], message: 'Version 1 uses skillpack.'});
    }

    for (const [id, skillpack] of Object.entries(value.skillpacks ?? {})) {
      if (id !== skillpack.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['skillpacks', id, 'id'],
          message: `Skillpack map key "${id}" must match its id "${skillpack.id}".`
        });
      }
    }
  });

export interface ManagerConfig {
  version: 1 | 2;
  managerStateDir: string;
  createdAt: string;
  updatedAt: string;
  /** Legacy single-pack alias accepted for source and fixture compatibility. */
  skillpack?: SkillpackConfig;
  skillpacks?: Record<string, SkillpackConfig>;
  agents?: Partial<Record<AgentIdConfig, AgentConfig>>;
}

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AgentIdConfig = z.infer<typeof agentIdSchema>;
export type SkillpackConfig = z.infer<typeof skillpackConfigSchema>;
export type PersistedManagerConfig = z.input<typeof persistedManagerConfigSchema>;

// Kept as the public schema export. Parsing through it accepts persisted v1/v2 data.
export const managerConfigSchema = persistedManagerConfigSchema;

export function qualifySkillId(skillpackId: string, skillId: string): string {
  return `${skillpackId}:${skillId}`;
}

export function parseSkillReference(reference: string): {skillpackId: string; skillId: string} | undefined {
  const separator = reference.indexOf(':');

  if (separator <= 0 || separator === reference.length - 1 || reference.indexOf(':', separator + 1) !== -1) {
    return undefined;
  }

  return {skillpackId: reference.slice(0, separator), skillId: reference.slice(separator + 1)};
}

export function resolveSkillReference(reference: string, fallbackSkillpackId = defaultSkillpackId): string {
  return parseSkillReference(reference) === undefined ? qualifySkillId(fallbackSkillpackId, reference) : reference;
}

export function getSkillpacks(config: ManagerConfig | undefined): SkillpackConfig[] {
  const configured = config?.skillpacks ?? (config?.skillpack === undefined ? {} : {[config.skillpack.id]: config.skillpack});
  return Object.values(configured).sort((left, right) => {
    if (left.id === defaultSkillpackId) return -1;
    if (right.id === defaultSkillpackId) return 1;
    return left.id.localeCompare(right.id);
  });
}

export function getSkillpack(config: ManagerConfig | undefined, id = defaultSkillpackId): SkillpackConfig | undefined {
  return config?.skillpacks?.[id] ?? (config?.skillpack?.id === id ? config.skillpack : undefined);
}

export function parseManagerConfig(value: unknown): ManagerConfig {
  const parsed = persistedManagerConfigSchema.parse(value);

  if (parsed.version === 2) {
    const skillpacks: Record<string, SkillpackConfig> = {
      ...(parsed.skillpacks ?? (parsed.skillpack === undefined ? {} : {[parsed.skillpack.id]: parsed.skillpack}))
    };
    if (skillpacks[defaultSkillpackId] === undefined) {
      skillpacks[defaultSkillpackId] = createDefaultSkillpackConfig(
        path.dirname(path.dirname(parsed.managerStateDir))
      );
    }
    const agents = qualifyAgentSelections(parsed.agents, defaultSkillpackId);
    return withPrimaryAlias({
      version: 2,
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
  const agents = qualifyAgentSelections(parsed.agents, legacySelectionPackId);

  return withPrimaryAlias({
    version: 2,
    managerStateDir: parsed.managerStateDir,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    skillpacks,
    ...(agents === undefined ? {} : {agents})
  }, legacySkillpack?.id);
}

function qualifyAgentSelections(
  agents: Partial<Record<AgentIdConfig, AgentConfig>> | undefined,
  fallbackSkillpackId: string
): Partial<Record<AgentIdConfig, AgentConfig>> | undefined {
  if (agents === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(agents).map(([agentId, agent]) => [
      agentId,
      {...agent, selectedSkillIds: agent.selectedSkillIds.map((id) => resolveSkillReference(id, fallbackSkillpackId))}
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
    version: 2,
    managerStateDir: options.managerStateDir,
    createdAt: timestamp,
    updatedAt: timestamp,
    skillpacks: {[defaultSkillpack.id]: defaultSkillpack}
  });
}

function withPrimaryAlias(config: ManagerConfig, preferredId = defaultSkillpackId): ManagerConfig {
  const primary = config.skillpacks?.[preferredId] ?? Object.values(config.skillpacks ?? {})[0];

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
