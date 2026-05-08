import os from 'node:os';
import path from 'node:path';

export const managerStateDirSegments = ['.agents', 'corvus-skill-manager'] as const;
export const configFileName = 'config.json';

export function expandTilde(inputPath: string, homeDir = os.homedir()): string {
  if (inputPath === '~') {
    return homeDir;
  }

  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(homeDir, inputPath.slice(2));
  }

  return inputPath;
}

export function resolveUserPath(inputPath: string, homeDir = os.homedir()): string {
  return path.resolve(expandTilde(inputPath, homeDir));
}

export function defaultManagerStateDir(homeDir = os.homedir()): string {
  return path.join(homeDir, ...managerStateDirSegments);
}

export function defaultConfigPath(homeDir = os.homedir()): string {
  return path.join(defaultManagerStateDir(homeDir), configFileName);
}

export function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

export function assertPathInside(parentPath: string, candidatePath: string): void {
  if (!isPathInside(parentPath, candidatePath)) {
    throw new Error(`Refusing to use path outside manager state directory: ${candidatePath}`);
  }
}
