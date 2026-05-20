import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

type ManagerInstallKind = 'global' | 'npx' | 'development' | 'unknown';

interface ManagerPackageRuntime {
  packageName: string;
  currentVersion: string;
  installKind: ManagerInstallKind;
}

export interface DetectInstallKindInput {
  entryPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface PackageJson {
  name?: unknown;
  version?: unknown;
}

export function readManagerPackageRuntime(entryUrl: string): ManagerPackageRuntime {
  const require = createRequire(entryUrl);
  const packageJson = require('../package.json') as PackageJson;

  if (typeof packageJson.name !== 'string' || typeof packageJson.version !== 'string') {
    throw new Error('Unable to read Corvus Skill Manager package name and version.');
  }

  return {
    packageName: packageJson.name,
    currentVersion: packageJson.version,
    installKind: detectManagerInstallKind({
      entryPath: fileURLToPath(entryUrl),
      cwd: process.cwd(),
      env: process.env
    })
  };
}

export function detectManagerInstallKind(input: DetectInstallKindInput): ManagerInstallKind {
  const entryPath = path.resolve(input.entryPath);

  if (isDevelopmentRun(entryPath, input.env)) {
    return 'development';
  }

  if (isNpxLikeRun(entryPath, input.env)) {
    return 'npx';
  }

  if (isPathInside(path.join(path.resolve(input.cwd), 'node_modules'), entryPath)) {
    return 'unknown';
  }

  if (entryPath.includes(`${path.sep}node_modules${path.sep}@corvus-tools${path.sep}skill-manager${path.sep}`)) {
    return 'global';
  }

  return 'unknown';
}

function isDevelopmentRun(entryPath: string, env: NodeJS.ProcessEnv): boolean {
  return (
    entryPath.endsWith(`${path.sep}src${path.sep}index.ts`) ||
    entryPath.includes(`${path.sep}packages${path.sep}cli${path.sep}src${path.sep}`) ||
    env.npm_lifecycle_event !== undefined
  );
}

function isNpxLikeRun(entryPath: string, env: NodeJS.ProcessEnv): boolean {
  return (
    entryPath.includes(`${path.sep}_npx${path.sep}`) ||
    entryPath.includes(`${path.sep}.npm${path.sep}_npx${path.sep}`) ||
    entryPath.includes(`${path.sep}pnpm${path.sep}dlx${path.sep}`) ||
    entryPath.includes(`${path.sep}.pnpm-store${path.sep}`) ||
    (env.npm_command === 'exec' && env.npm_config_package?.includes('@corvus-tools/skill-manager') === true)
  );
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}
