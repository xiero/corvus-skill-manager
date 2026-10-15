import {promises as fs} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import type {AgentAdapter} from '../agents/AgentAdapter.js';
import type {AgentConfig, AgentIdConfig, ManagerConfig} from '../config/configSchema.js';
import {isPathInside, resolveUserPath} from '../paths.js';

export const profileScopeSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('user')}).strict(),
  z.object({kind: z.literal('project'), rootPath: z.string().min(1)}).strict()
]);
export type ProfileScope = z.infer<typeof profileScopeSchema>;
export const userScope: ProfileScope = {kind: 'user'};

export function sameScope(left?: ProfileScope, right?: ProfileScope): boolean {
  return (left?.kind ?? 'user') === (right?.kind ?? 'user') &&
    (left?.kind !== 'project' || (right?.kind === 'project' && left.rootPath === right.rootPath));
}

export function profileAgents(config: ManagerConfig | undefined, scope?: ProfileScope) {
  return scope?.kind === 'project' ? config?.projects?.[scope.rootPath]?.agents ?? {} : config?.agents ?? {};
}

/** A read-only view for existing selection and report code; never persist this projection. */
export function configForScope(config: ManagerConfig, scope?: ProfileScope): ManagerConfig {
  return {...config, agents: profileAgents(config, scope)};
}

export function withProfileAgents(
  config: ManagerConfig,
  scope: ProfileScope | undefined,
  agents: Partial<Record<AgentIdConfig, AgentConfig>>
): ManagerConfig {
  return scope?.kind === 'project'
    ? {...config, version: 4, projects: {...config.projects, [scope.rootPath]: {rootPath: scope.rootPath, agents}}}
    : {...config, agents};
}

export function adaptersForScope(adapters: AgentAdapter[], scope?: ProfileScope): AgentAdapter[] {
  if (scope?.kind !== 'project') return adapters;
  return adapters.map(({defaultTargetPath: _global, ...adapter}) => ({
    ...adapter,
    ...(adapter.projectTargetPath === undefined
      ? adapter.id === 'custom' ? {} : {supportStatus: 'unavailable' as const}
      : {defaultTargetPath: path.join(scope.rootPath, adapter.projectTargetPath)})
  }));
}

export async function canonicalScope(scope: ProfileScope | undefined, homeDir?: string): Promise<ProfileScope> {
  const parsed = profileScopeSchema.parse(scope ?? userScope);
  if (parsed.kind === 'user') return parsed;
  const rootPath = await fs.realpath(resolveUserPath(parsed.rootPath, homeDir));
  if (!(await fs.stat(rootPath)).isDirectory()) throw new Error(`Project is not a directory: ${rootPath}`);
  return {kind: 'project', rootPath};
}

export async function projectIdentity(scope: ProfileScope): Promise<string | undefined> {
  if (scope.kind !== 'project') return undefined;
  if (await fs.realpath(scope.rootPath) !== scope.rootPath) throw new Error('Project root was redirected; select it again.');
  const stat = await fs.lstat(scope.rootPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Project root is no longer a directory.');
  return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
}

/** Reject all redirected parents below the canonical root, including dangling symlinks. */
export async function assertProjectTarget(scope: ProfileScope, target: string): Promise<void> {
  if (scope.kind !== 'project') return;
  await projectIdentity(scope);
  const resolved = path.resolve(target);
  if (resolved === scope.rootPath || !isPathInside(scope.rootPath, resolved)) {
    throw new Error(`Target must be inside the project: ${target}`);
  }
  const relativeParent = path.relative(scope.rootPath, path.dirname(resolved));
  let parent = scope.rootPath;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    parent = path.join(parent, segment);
    try {
      const stat = await fs.lstat(parent);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe project target parent: ${parent}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      break;
    }
  }
}

export async function assertProjectRootAllowed(scope: ProfileScope, config: ManagerConfig, homeDir: string): Promise<void> {
  if (scope.kind !== 'project') return;
  const protectedPaths = [config.managerStateDir, path.join(homeDir, '.agents', 'skillpacks'),
    ...Object.values(config.skillpacks).map((pack) => pack.checkoutPath)];
  for (const value of protectedPaths) {
    const lexical = resolveUserPath(value, homeDir);
    const physical = await fs.realpath(lexical).catch(() => lexical);
    if ([lexical, physical].some((root) => isPathInside(root, scope.rootPath))) {
      throw new Error(`Project cannot be a manager or skillpack directory: ${scope.rootPath}`);
    }
  }
}
