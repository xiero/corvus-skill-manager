import {z} from 'zod';

export const agentIdSchema = z.enum(['codex', 'claude', 'copilot', 'opencode', 'pi', 'custom', 'gemini']);

export const skillpackConfigSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9._-]+$/, 'Use only letters, numbers, dots, underscores, and hyphens.'),
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1),
    checkoutPath: z.string().min(1)
  })
  .strict();

export const agentConfigSchema = z
  .object({
    enabled: z.boolean(),
    targetPath: z.string().min(1).optional(),
    selectedSkillIds: z.array(z.string().min(1)).default([])
  })
  .strict();

export const managerConfigSchema = z
  .object({
    version: z.literal(1),
    managerStateDir: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    skillpack: skillpackConfigSchema.optional(),
    agents: z.record(agentIdSchema, agentConfigSchema).optional()
  })
  .strict();

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AgentIdConfig = z.infer<typeof agentIdSchema>;
export type SkillpackConfig = z.infer<typeof skillpackConfigSchema>;
export type ManagerConfig = z.infer<typeof managerConfigSchema>;

export function parseManagerConfig(value: unknown): ManagerConfig {
  return managerConfigSchema.parse(value);
}

export function parseSkillpackConfig(value: unknown): SkillpackConfig {
  return skillpackConfigSchema.parse(value);
}

export function createDefaultManagerConfig(options: {
  managerStateDir: string;
  now?: Date;
}): ManagerConfig {
  const timestamp = (options.now ?? new Date()).toISOString();

  return {
    version: 1,
    managerStateDir: options.managerStateDir,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}
