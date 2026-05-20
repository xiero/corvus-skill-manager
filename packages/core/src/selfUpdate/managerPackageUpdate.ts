import {promises as fs} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {
  assertPathInside,
  defaultManagerStateDir,
  resolveUserPath
} from '../paths.js';

export type ManagerInstallKind = 'global' | 'npx' | 'development' | 'unknown';

export type ManagerSelfUpdateStatus =
  | 'unsupported-install'
  | 'up-to-date'
  | 'update-available'
  | 'check-failed';

export interface ManagerPackageRuntime {
  packageName: string;
  currentVersion: string;
  installKind: ManagerInstallKind;
}

export interface ManagerSelfUpdateInspection extends ManagerPackageRuntime {
  status: ManagerSelfUpdateStatus;
  updateAvailable: boolean;
  latestVersion?: string;
  updateCommand?: string;
  checkedAt?: string;
  fromCache: boolean;
  message: string;
}

export interface ManagerSelfUpdateOptions extends ManagerPackageRuntime {
  homeDir?: string;
  managerStateDir?: string;
  now?: Date;
  fetch?: RegistryFetch;
  cacheTtlMs?: number;
  timeoutMs?: number;
  forceRefresh?: boolean;
}

interface RegistryFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type RegistryFetch = (
  url: string,
  init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }
) => Promise<RegistryFetchResponse>;

const defaultCacheTtlMs = 6 * 60 * 60 * 1000;
const defaultTimeoutMs = 3000;
const selfUpdateCacheFileName = 'self-update.json';

const selfUpdateCacheSchema = z
  .object({
    version: z.literal(1),
    packageName: z.string().min(1),
    currentVersion: z.string().min(1),
    installKind: z.enum(['global', 'npx', 'development', 'unknown']),
    status: z.enum(['up-to-date', 'update-available', 'check-failed']),
    updateAvailable: z.boolean(),
    latestVersion: z.string().min(1).optional(),
    updateCommand: z.string().min(1).optional(),
    checkedAt: z.string().datetime(),
    message: z.string()
  })
  .strict();

type SelfUpdateCache = z.infer<typeof selfUpdateCacheSchema>;

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export async function inspectManagerSelfUpdate(
  options: ManagerSelfUpdateOptions
): Promise<ManagerSelfUpdateInspection> {
  if (options.installKind !== 'global') {
    return {
      packageName: options.packageName,
      currentVersion: options.currentVersion,
      installKind: options.installKind,
      status: 'unsupported-install',
      updateAvailable: false,
      fromCache: false,
      message: 'Self-update checks are only shown for global installs.'
    };
  }

  const managerStateDir = resolveUserPath(
    options.managerStateDir ?? (
      options.homeDir === undefined ? defaultManagerStateDir() : defaultManagerStateDir(options.homeDir)
    ),
    options.homeDir
  );
  const cachePath = path.join(managerStateDir, selfUpdateCacheFileName);
  const now = options.now ?? new Date();
  const cacheTtlMs = options.cacheTtlMs ?? defaultCacheTtlMs;
  const cached = await loadFreshCache({
    cachePath,
    managerStateDir,
    packageName: options.packageName,
    currentVersion: options.currentVersion,
    now,
    cacheTtlMs,
    forceRefresh: options.forceRefresh === true
  });

  if (cached !== undefined) {
    return cacheToInspection(cached, true);
  }

  const inspection = await checkRegistryForUpdate(options, now);
  await saveSelfUpdateCache(inspectionToCache(inspection), {cachePath, managerStateDir});
  return inspection;
}

export function isNewerVersion(candidateVersion: string, currentVersion: string): boolean {
  return compareSemver(candidateVersion, currentVersion) > 0;
}

export function compareSemver(leftVersion: string, rightVersion: string): number {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);
  const coreComparison =
    compareNumber(left.major, right.major) ||
    compareNumber(left.minor, right.minor) ||
    compareNumber(left.patch, right.patch);

  if (coreComparison !== 0) {
    return coreComparison;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

async function checkRegistryForUpdate(
  options: ManagerSelfUpdateOptions,
  now: Date
): Promise<ManagerSelfUpdateInspection> {
  try {
    const latestVersion = await fetchLatestVersion({
      packageName: options.packageName,
      fetch: options.fetch ?? globalThis.fetch,
      timeoutMs: options.timeoutMs ?? defaultTimeoutMs
    });
    const updateAvailable = isNewerVersion(latestVersion, options.currentVersion);
    const updateCommand = updateAvailable ? updateCommandFor(options.packageName) : undefined;
    const checkedAt = now.toISOString();

    return {
      packageName: options.packageName,
      currentVersion: options.currentVersion,
      installKind: options.installKind,
      status: updateAvailable ? 'update-available' : 'up-to-date',
      updateAvailable,
      latestVersion,
      ...(updateCommand === undefined ? {} : {updateCommand}),
      checkedAt,
      fromCache: false,
      message: updateAvailable ?
        `A newer Corvus Skill Manager release is available: ${options.currentVersion} -> ${latestVersion}.` :
        `Corvus Skill Manager ${options.currentVersion} is up to date.`
    };
  } catch (error) {
    return {
      packageName: options.packageName,
      currentVersion: options.currentVersion,
      installKind: options.installKind,
      status: 'check-failed',
      updateAvailable: false,
      checkedAt: now.toISOString(),
      fromCache: false,
      message: `Manager update check failed: ${formatError(error)}.`
    };
  }
}

async function fetchLatestVersion(options: {
  packageName: string;
  fetch: RegistryFetch | undefined;
  timeoutMs: number;
}): Promise<string> {
  if (options.fetch === undefined) {
    throw new Error('fetch is not available in this Node runtime');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);

  try {
    const response = await options.fetch(registryPackageUrl(options.packageName), {
      headers: {
        accept: 'application/vnd.npm.install-v1+json'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`npm registry returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    const latestVersion = readLatestVersion(payload);

    parseSemver(latestVersion);
    return latestVersion;
  } finally {
    clearTimeout(timeout);
  }
}

function readLatestVersion(payload: unknown): string {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    'dist-tags' in payload &&
    payload['dist-tags'] !== null &&
    typeof payload['dist-tags'] === 'object' &&
    'latest' in payload['dist-tags'] &&
    typeof payload['dist-tags'].latest === 'string'
  ) {
    return payload['dist-tags'].latest;
  }

  throw new Error('npm registry response did not include dist-tags.latest');
}

function registryPackageUrl(packageName: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
}

function updateCommandFor(packageName: string): string {
  return `npm install -g ${packageName}@latest`;
}

async function loadFreshCache(options: {
  cachePath: string;
  managerStateDir: string;
  packageName: string;
  currentVersion: string;
  now: Date;
  cacheTtlMs: number;
  forceRefresh: boolean;
}): Promise<SelfUpdateCache | undefined> {
  if (options.forceRefresh) {
    return undefined;
  }

  const cache = await loadSelfUpdateCache(options.cachePath);

  if (cache === undefined) {
    return undefined;
  }

  if (cache.packageName !== options.packageName || cache.currentVersion !== options.currentVersion) {
    return undefined;
  }

  const checkedAt = new Date(cache.checkedAt);

  if (!Number.isFinite(checkedAt.getTime())) {
    return undefined;
  }

  if (options.now.getTime() - checkedAt.getTime() > options.cacheTtlMs) {
    return undefined;
  }

  assertPathInside(options.managerStateDir, options.cachePath);
  return cache;
}

async function loadSelfUpdateCache(cachePath: string): Promise<SelfUpdateCache | undefined> {
  try {
    const rawCache = await fs.readFile(cachePath, 'utf8');
    return selfUpdateCacheSchema.parse(JSON.parse(rawCache));
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    return undefined;
  }
}

async function saveSelfUpdateCache(
  cache: SelfUpdateCache,
  options: {cachePath: string; managerStateDir: string}
): Promise<void> {
  assertPathInside(options.managerStateDir, options.cachePath);
  await fs.mkdir(path.dirname(options.cachePath), {recursive: true});
  await fs.writeFile(options.cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function cacheToInspection(cache: SelfUpdateCache, fromCache: boolean): ManagerSelfUpdateInspection {
  return {
    packageName: cache.packageName,
    currentVersion: cache.currentVersion,
    installKind: cache.installKind,
    status: cache.status,
    updateAvailable: cache.updateAvailable,
    ...(cache.latestVersion === undefined ? {} : {latestVersion: cache.latestVersion}),
    ...(cache.updateCommand === undefined ? {} : {updateCommand: cache.updateCommand}),
    checkedAt: cache.checkedAt,
    fromCache,
    message: cache.message
  };
}

function inspectionToCache(inspection: ManagerSelfUpdateInspection): SelfUpdateCache {
  if (
    inspection.status !== 'up-to-date' &&
    inspection.status !== 'update-available' &&
    inspection.status !== 'check-failed'
  ) {
    throw new Error(`Cannot cache unsupported self-update status: ${inspection.status}.`);
  }

  return selfUpdateCacheSchema.parse({
    version: 1,
    packageName: inspection.packageName,
    currentVersion: inspection.currentVersion,
    installKind: inspection.installKind,
    status: inspection.status,
    updateAvailable: inspection.updateAvailable,
    ...(inspection.latestVersion === undefined ? {} : {latestVersion: inspection.latestVersion}),
    ...(inspection.updateCommand === undefined ? {} : {updateCommand: inspection.updateCommand}),
    checkedAt: inspection.checkedAt ?? new Date().toISOString(),
    message: inspection.message
  });
}

function parseSemver(version: string): ParsedSemver {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim());

  if (match === null) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  const [, major, minor, patch, prerelease] = match;

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease === undefined ? [] : prerelease.split('.')
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }

  if (left.length === 0) {
    return 1;
  }

  if (right.length === 0) {
    return -1;
  }

  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart === undefined) {
      return -1;
    }

    if (rightPart === undefined) {
      return 1;
    }

    const comparison = comparePrereleasePart(leftPart, rightPart);

    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

function comparePrereleasePart(left: string, right: string): number {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined;

  if (leftNumber !== undefined && rightNumber !== undefined) {
    return compareNumber(leftNumber, rightNumber);
  }

  if (leftNumber !== undefined) {
    return -1;
  }

  if (rightNumber !== undefined) {
    return 1;
  }

  return left.localeCompare(right);
}

function compareNumber(left: number, right: number): number {
  if (left > right) {
    return 1;
  }

  if (left < right) {
    return -1;
  }

  return 0;
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'request timed out';
  }

  return error instanceof Error ? error.message : String(error);
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
