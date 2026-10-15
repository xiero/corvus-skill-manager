import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {ManagedLinkManifestEntry, ManagerManifest} from '../manifest/manifestSchema.js';
import {resolveUserPath} from '../paths.js';
import {sameScope} from '../profiles/profileScope.js';
import type {LinkPlanOperation} from './linkPlan.js';

export type TargetOwners = Map<string, ManagedLinkManifestEntry[]>;

/** Resolve directory aliases without following the skill link itself into its source. */
export async function physicalTargetPath(target: string): Promise<string> {
  const suffix = [path.basename(target)];
  let parent = path.dirname(target);
  for (;;) {
    try {
      return path.join(await fs.realpath(parent), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === path.dirname(parent)) throw error;
      suffix.unshift(path.basename(parent));
      parent = path.dirname(parent);
    }
  }
}

export async function inspectTargetOwners(manifest: ManagerManifest, homeDir?: string): Promise<TargetOwners> {
  const owners: TargetOwners = new Map();
  for (const entry of Object.values(manifest.links)) {
    const physical = await physicalTargetPath(resolveUserPath(entry.targetPath, homeDir));
    owners.set(physical, [...(owners.get(physical) ?? []), entry]);
  }
  return owners;
}

export async function assertTargetOwnership(
  owners: TargetOwners,
  operation: LinkPlanOperation,
  homeDir?: string
): Promise<void> {
  const target = resolveUserPath(operation.targetPath, homeDir);
  const physical = await physicalTargetPath(target);
  for (const entry of owners.get(physical) ?? []) {
    if (entry.targetPath !== target || !sameScope(entry.scope, operation.scope) ||
        entry.agentId !== operation.agentId || entry.skillId !== operation.skillId) {
      throw new Error(`Target belongs to another profile, agent or recorded path: ${target} (${entry.targetPath})`);
    }
  }
}
