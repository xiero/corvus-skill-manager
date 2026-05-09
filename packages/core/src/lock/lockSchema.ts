import {z} from 'zod';

export const skillpackLockEntrySchema = z
  .object({
    id: z.string().min(1),
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1),
    checkoutPath: z.string().min(1),
    commitHash: z.string().min(1),
    dirty: z.boolean(),
    recordedAt: z.string().datetime()
  })
  .strict();

export const managerLockSchema = z
  .object({
    version: z.literal(1),
    updatedAt: z.string().datetime(),
    skillpacks: z.record(skillpackLockEntrySchema)
  })
  .strict();

export type SkillpackLockEntry = z.infer<typeof skillpackLockEntrySchema>;
export type ManagerLock = z.infer<typeof managerLockSchema>;

export function createEmptyManagerLock(now = new Date()): ManagerLock {
  return {
    version: 1,
    updatedAt: now.toISOString(),
    skillpacks: {}
  };
}

export function parseManagerLock(value: unknown): ManagerLock {
  return managerLockSchema.parse(value);
}
