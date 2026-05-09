import {z} from 'zod';
import {agentIdSchema} from '../config/configSchema.js';

export const managedLinkTypeSchema = z.enum(['symlink', 'junction']);

export const managedLinkManifestEntrySchema = z
  .object({
    agentId: agentIdSchema,
    skillId: z.string().min(1),
    targetPath: z.string().min(1),
    sourcePath: z.string().min(1),
    linkType: managedLinkTypeSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict();

export const managerManifestSchema = z
  .object({
    version: z.literal(1),
    updatedAt: z.string().datetime(),
    links: z.record(managedLinkManifestEntrySchema)
  })
  .strict();

export type ManagedLinkType = z.infer<typeof managedLinkTypeSchema>;
export type ManagedLinkManifestEntry = z.infer<typeof managedLinkManifestEntrySchema>;
export type ManagerManifest = z.infer<typeof managerManifestSchema>;

export function createEmptyManagerManifest(now = new Date()): ManagerManifest {
  return {
    version: 1,
    updatedAt: now.toISOString(),
    links: {}
  };
}

export function parseManagerManifest(value: unknown): ManagerManifest {
  return managerManifestSchema.parse(value);
}
