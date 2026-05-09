import {promises as fs} from 'node:fs';
import path from 'node:path';
import {type AgentId} from '../agents/AgentAdapter.js';
import {isPathInside, resolveUserPath} from '../paths.js';
import {
  type ManagedLinkManifestEntry,
  type ManagedLinkType,
  type ManagerManifest
} from '../manifest/manifestSchema.js';
import {
  type ManifestStoreOptions,
  loadManifestOrDefault,
  saveManifest
} from '../manifest/manifestStore.js';
import type {LinkCreateOperation, LinkPlan, LinkPlanOperation, LinkRemoveOperation} from './linkPlan.js';

export type ApplyActionStatus = 'applied' | 'skipped' | 'planned';

export interface ApplyActionResult {
  status: ApplyActionStatus;
  code: string;
  message: string;
  operation: LinkPlanOperation;
}

export interface ApplyLinkPlanResult {
  dryRun: boolean;
  manifestPath: string;
  applied: ApplyActionResult[];
  skipped: ApplyActionResult[];
  planned: ApplyActionResult[];
}

export interface ApplyLinkPlanOptions extends ManifestStoreOptions {
  plan: LinkPlan;
  skillpackCheckoutPath: string;
  dryRun?: boolean;
  confirmReplaceBrokenManagedLinks?: boolean;
}

export async function applyLinkPlan(options: ApplyLinkPlanOptions): Promise<ApplyLinkPlanResult> {
  const dryRun = options.dryRun ?? false;
  const loadedManifest = await loadManifestOrDefault(options);
  const manifest = cloneManifest(loadedManifest.manifest);
  const skillpackCheckoutPath = resolveUserPath(options.skillpackCheckoutPath, options.homeDir);
  const applied: ApplyActionResult[] = [];
  const skipped: ApplyActionResult[] = [];
  const planned: ApplyActionResult[] = [];

  for (const operation of options.plan.operations) {
    const nowOption = options.now === undefined ? {} : {now: options.now};
    const result = operation.type === 'create-link' ?
      await planOrApplyCreate(operation, {
        manifest,
        skillpackCheckoutPath,
        dryRun,
        confirmReplaceBrokenManagedLinks: options.confirmReplaceBrokenManagedLinks ?? false,
        ...nowOption
      }) :
      await planOrApplyRemove(operation, {
        manifest,
        dryRun,
        ...nowOption
      });

    if (result.status === 'applied') {
      applied.push(result);
    } else if (result.status === 'planned') {
      planned.push(result);
    } else {
      skipped.push(result);
    }
  }

  if (!dryRun) {
    manifest.updatedAt = (options.now ?? new Date()).toISOString();
    await saveManifest(manifest, options);
  }

  return {
    dryRun,
    manifestPath: loadedManifest.manifestPath,
    applied,
    skipped,
    planned
  };
}

async function planOrApplyCreate(
  operation: LinkCreateOperation,
  options: {
    manifest: ManagerManifest;
    skillpackCheckoutPath: string;
    dryRun: boolean;
    confirmReplaceBrokenManagedLinks: boolean;
    now?: Date;
  }
): Promise<ApplyActionResult> {
  const sourcePath = resolveUserPath(operation.sourcePath);
  const targetPath = resolveUserPath(operation.targetPath);

  if (!isPathInside(options.skillpackCheckoutPath, sourcePath)) {
    return skipped(operation, 'source-outside-skillpack', `Source is outside the configured skillpack checkout: ${sourcePath}`);
  }

  if (!(await pathExists(sourcePath))) {
    return skipped(operation, 'missing-source', `Source does not exist: ${sourcePath}`);
  }

  const manifestEntry = options.manifest.links[targetPath];
  const targetInspection = await inspectTarget(targetPath);

  if (targetInspection.kind === 'missing') {
    if (options.dryRun) {
      return planned(operation, 'create-link', `Would create manager-owned link at ${targetPath}`);
    }

    const linkType = await createManagedLink({sourcePath, targetPath});
    const nowOption = options.now === undefined ? {} : {now: options.now};
    upsertManifestEntry(options.manifest, {
      agentId: operation.agentId,
      skillId: operation.skillId,
      sourcePath,
      targetPath,
      linkType,
      ...nowOption
    });
    return applied(operation, 'created-link', `Created manager-owned link at ${targetPath}`);
  }

  if (targetInspection.kind === 'file') {
    return skipped(operation, 'unmanaged-file-exists', `Refusing to overwrite real file: ${targetPath}`);
  }

  if (targetInspection.kind === 'directory') {
    return skipped(operation, 'unmanaged-directory-exists', `Refusing to overwrite real directory: ${targetPath}`);
  }

  if (manifestEntry === undefined) {
    return skipped(operation, 'unmanaged-symlink-exists', `Refusing to overwrite unmanaged symlink: ${targetPath}`);
  }

  if (!manifestMatchesOwnership(manifestEntry, operation, targetPath)) {
    return skipped(operation, 'manifest-mismatch', `Manifest ownership does not match requested link: ${targetPath}`);
  }

  if (targetInspection.broken && !options.confirmReplaceBrokenManagedLinks) {
    return skipped(
      operation,
      'broken-managed-link-needs-confirmation',
      `Broken manager-owned link requires explicit confirmation before replacement: ${targetPath}`
    );
  }

  if (targetInspection.broken) {
    if (options.dryRun) {
      return planned(operation, 'replace-broken-managed-link', `Would replace broken manager-owned link at ${targetPath}`);
    }

    await fs.unlink(targetPath);
    const linkType = await createManagedLink({sourcePath, targetPath});
    const nowOption = options.now === undefined ? {} : {now: options.now};
    upsertManifestEntry(options.manifest, {
      agentId: operation.agentId,
      skillId: operation.skillId,
      sourcePath,
      targetPath,
      linkType,
      existingCreatedAt: manifestEntry.createdAt,
      ...nowOption
    });

    return applied(operation, 'replaced-broken-managed-link', `Replaced broken manager-owned link at ${targetPath}`);
  }

  if (manifestEntry.sourcePath !== sourcePath || targetInspection.resolvedSourcePath !== sourcePath) {
    return skipped(operation, 'link-target-mismatch', `Existing link target does not match expected source: ${targetPath}`);
  }

  return skipped(operation, 'managed-link-already-present', `Managed link already exists: ${targetPath}`);
}

async function planOrApplyRemove(
  operation: LinkRemoveOperation,
  options: {
    manifest: ManagerManifest;
    dryRun: boolean;
    now?: Date;
  }
): Promise<ApplyActionResult> {
  const targetPath = resolveUserPath(operation.targetPath);
  const manifestEntry = options.manifest.links[targetPath];
  const targetInspection = await inspectTarget(targetPath);

  if (manifestEntry === undefined) {
    return skipped(operation, 'not-manager-owned', `Refusing to remove target not owned by manifest: ${targetPath}`);
  }

  if (!manifestMatchesRemoveOperation(manifestEntry, operation, targetPath)) {
    return skipped(operation, 'manifest-mismatch', `Manifest ownership does not match requested removal: ${targetPath}`);
  }

  if (targetInspection.kind === 'missing') {
    if (options.dryRun) {
      return planned(operation, 'remove-stale-manifest-entry', `Would remove stale manifest entry for ${targetPath}`);
    }

    delete options.manifest.links[targetPath];
    return applied(operation, 'removed-stale-manifest-entry', `Removed stale manifest entry for ${targetPath}`);
  }

  if (targetInspection.kind !== 'symlink') {
    return skipped(operation, 'target-is-not-link', `Refusing to remove non-link target: ${targetPath}`);
  }

  if (targetInspection.resolvedSourcePath !== manifestEntry.sourcePath) {
    return skipped(operation, 'link-target-mismatch', `Refusing to remove link whose target differs from manifest: ${targetPath}`);
  }

  if (options.dryRun) {
    return planned(operation, 'remove-managed-link', `Would remove manager-owned link at ${targetPath}`);
  }

  await fs.unlink(targetPath);
  delete options.manifest.links[targetPath];
  return applied(operation, 'removed-managed-link', `Removed manager-owned link at ${targetPath}`);
}

async function createManagedLink(options: {sourcePath: string; targetPath: string}): Promise<ManagedLinkType> {
  await fs.mkdir(path.dirname(options.targetPath), {recursive: true});
  const sourceStat = await fs.stat(options.sourcePath);
  const linkType: ManagedLinkType = process.platform === 'win32' && sourceStat.isDirectory() ? 'junction' : 'symlink';

  await fs.symlink(options.sourcePath, options.targetPath, linkType === 'junction' ? 'junction' : 'dir');
  return linkType;
}

async function inspectTarget(targetPath: string): Promise<
  | {kind: 'missing'}
  | {kind: 'file'}
  | {kind: 'directory'}
  | {kind: 'symlink'; resolvedSourcePath: string; broken: boolean}
> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>;

  try {
    stat = await fs.lstat(targetPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return {kind: 'missing'};
    }

    throw error;
  }

  if (stat.isSymbolicLink()) {
    const linkTarget = await fs.readlink(targetPath);
    const resolvedSourcePath = path.resolve(path.dirname(targetPath), linkTarget);
    const broken = !(await pathExists(resolvedSourcePath));

    return {
      kind: 'symlink',
      resolvedSourcePath,
      broken
    };
  }

  if (stat.isDirectory()) {
    return {kind: 'directory'};
  }

  return {kind: 'file'};
}

function upsertManifestEntry(
  manifest: ManagerManifest,
  options: {
    agentId: AgentId;
    skillId: string;
    targetPath: string;
    sourcePath: string;
    linkType: ManagedLinkType;
    now?: Date;
    existingCreatedAt?: string;
  }
): void {
  const timestamp = (options.now ?? new Date()).toISOString();

  manifest.links[options.targetPath] = {
    agentId: options.agentId,
    skillId: options.skillId,
    targetPath: options.targetPath,
    sourcePath: options.sourcePath,
    linkType: options.linkType,
    createdAt: options.existingCreatedAt ?? timestamp,
    updatedAt: timestamp
  };
}

function manifestMatchesOwnership(
  entry: ManagedLinkManifestEntry,
  operation: LinkCreateOperation,
  targetPath: string
): boolean {
  return (
    entry.agentId === operation.agentId &&
    entry.skillId === operation.skillId &&
    entry.targetPath === targetPath
  );
}

function manifestMatchesRemoveOperation(
  entry: ManagedLinkManifestEntry,
  operation: LinkRemoveOperation,
  targetPath: string
): boolean {
  return entry.agentId === operation.agentId && entry.skillId === operation.skillId && entry.targetPath === targetPath;
}

function cloneManifest(manifest: ManagerManifest): ManagerManifest {
  return {
    ...manifest,
    links: Object.fromEntries(
      Object.entries(manifest.links).map(([targetPath, entry]) => [targetPath, {...entry}])
    )
  };
}

function planned(operation: LinkPlanOperation, code: string, message: string): ApplyActionResult {
  return {status: 'planned', code, message, operation};
}

function applied(operation: LinkPlanOperation, code: string, message: string): ApplyActionResult {
  return {status: 'applied', code, message, operation};
}

function skipped(operation: LinkPlanOperation, code: string, message: string): ApplyActionResult {
  return {status: 'skipped', code, message, operation};
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
