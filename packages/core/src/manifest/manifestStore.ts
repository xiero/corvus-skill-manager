import {promises as fs} from 'node:fs';
import path from 'node:path';
import {
  assertPathInside,
  defaultManagerStateDir,
  manifestFileName,
  resolveUserPath
} from '../paths.js';
import {
  type ManagerManifest,
  createEmptyManagerManifest,
  parseManagerManifest
} from './manifestSchema.js';

export interface ManifestStoreOptions {
  homeDir?: string;
  managerStateDir?: string;
  manifestPath?: string;
  now?: Date;
}

export function resolveManifestPaths(options: ManifestStoreOptions = {}): {
  managerStateDir: string;
  manifestPath: string;
} {
  const homeDir = options.homeDir;
  const managerStateDir = resolveUserPath(
    options.managerStateDir ?? (homeDir === undefined ? defaultManagerStateDir() : defaultManagerStateDir(homeDir)),
    homeDir
  );
  const manifestPath = resolveUserPath(options.manifestPath ?? path.join(managerStateDir, manifestFileName), homeDir);

  assertPathInside(managerStateDir, manifestPath);

  return {managerStateDir, manifestPath};
}

export async function loadManifest(manifestPath: string): Promise<ManagerManifest> {
  const rawManifest = await fs.readFile(manifestPath, 'utf8');
  return parseManagerManifest(JSON.parse(rawManifest));
}

export async function loadManifestOrDefault(options: ManifestStoreOptions = {}): Promise<{
  manifest: ManagerManifest;
  manifestPath: string;
}> {
  const {manifestPath} = resolveManifestPaths(options);

  try {
    return {
      manifest: await loadManifest(manifestPath),
      manifestPath
    };
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    return {
      manifest: createEmptyManagerManifest(options.now),
      manifestPath
    };
  }
}

export async function saveManifest(
  manifest: ManagerManifest,
  options: ManifestStoreOptions = {}
): Promise<string> {
  const {managerStateDir, manifestPath} = resolveManifestPaths(options);
  const parsedManifest = parseManagerManifest(manifest);

  assertPathInside(managerStateDir, manifestPath);
  await fs.mkdir(path.dirname(manifestPath), {recursive: true});
  await fs.writeFile(manifestPath, `${JSON.stringify(parsedManifest, null, 2)}\n`, 'utf8');

  return manifestPath;
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
