import {z} from 'zod';

export const managerConfigSchema = z
  .object({
    version: z.literal(1),
    managerStateDir: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict();

export type ManagerConfig = z.infer<typeof managerConfigSchema>;

export function parseManagerConfig(value: unknown): ManagerConfig {
  return managerConfigSchema.parse(value);
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
