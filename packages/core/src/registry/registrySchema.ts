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

export const registrySkillEntrySchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9._-]+$/, 'Use only letters, numbers, dots, underscores, and hyphens.'),
    path: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    supportedAgents: z.array(supportedAgentSchema).min(1),
    tags: z.array(z.string().min(1)).optional()
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
export type SkillRegistry = z.infer<typeof skillRegistrySchema>;
