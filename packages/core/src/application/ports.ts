import os from 'node:os';
import path from 'node:path';
import {type GitRunner, runGit} from '../git/gitRunner.js';
import {
  configFileName,
  defaultManagerStateDir,
  lockFileName,
  manifestFileName,
  resolveUserPath
} from '../paths.js';

/** Information about the installed manager package, injected by the CLI entrypoint. */
export interface ManagerPackageInfo {
  packageName: string;
  version: string;
  installKind: 'global' | 'npx' | 'development' | 'unknown';
}

export const unknownManagerPackage: ManagerPackageInfo = {
  packageName: '@corvus-tools/skill-manager',
  version: '0.0.0',
  installKind: 'unknown'
};

/**
 * Every side-effecting dependency the application layer needs. Each one can be replaced with a
 * test double, so use cases are testable without spawning a process or touching a real HOME.
 */
export interface CorvusApplicationOptions {
  homeDir?: string;
  managerStateDir?: string;
  configPath?: string;
  now?: () => Date;
  git?: GitRunner;
  managerPackage?: ManagerPackageInfo;
  /** Directory holding persisted plan artifacts. Defaults to `<managerStateDir>/plans`. */
  plansDir?: string;
}

export interface ApplicationEnvironment {
  homeDir: string;
  /** Fallback manager state directory; a loaded config may point somewhere else. */
  managerStateDir: string;
  configPath: string;
  lockPath: string;
  manifestPath: string;
  plansDir: string;
  now: () => Date;
  git: GitRunner;
  managerPackage: ManagerPackageInfo;
}

export const plansDirName = 'plans';

export function resolveApplicationEnvironment(
  options: CorvusApplicationOptions = {}
): ApplicationEnvironment {
  const homeDir = options.homeDir === undefined ? os.homedir() : resolveUserPath(options.homeDir);
  const managerStateDir = resolveUserPath(
    options.managerStateDir ?? defaultManagerStateDir(homeDir),
    homeDir
  );
  const configPath = resolveUserPath(options.configPath ?? path.join(managerStateDir, configFileName), homeDir);

  return {
    homeDir,
    managerStateDir,
    configPath,
    lockPath: path.join(managerStateDir, lockFileName),
    manifestPath: path.join(managerStateDir, manifestFileName),
    plansDir: resolveUserPath(options.plansDir ?? path.join(managerStateDir, plansDirName), homeDir),
    now: options.now ?? (() => new Date()),
    git: options.git ?? runGit,
    managerPackage: options.managerPackage ?? unknownManagerPackage
  };
}
