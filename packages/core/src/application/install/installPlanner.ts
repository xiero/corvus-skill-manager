import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {AgentAdapter, AgentId} from '../../agents/AgentAdapter.js';
import type {AgentConfig, ManagerConfig} from '../../config/configSchema.js';
import {
  type AgentLinkSelection,
  type LinkPlan,
  type TargetState,
  generateLinkPlan
} from '../../links/linkPlan.js';
import type {ManagerManifest} from '../../manifest/manifestSchema.js';
import {resolveUserPath} from '../../paths.js';
import type {DiscoveredSkill} from '../../skills/skillDiscovery.js';
import {
  type ResolvedSkillSelection,
  expandRequiredDependencies,
  findSkillConflicts
} from '../../skills/skillRelationships.js';
import {type MachineError, createMachineError} from '../protocol/errors.js';
import type {AgentConfigChange, PlanIssue, ResolvedPlanSelection} from '../plans/planSchema.js';
import type {NormalizedInstallRequest} from './installRequest.js';

export interface AgentPlanInput {
  adapter: AgentAdapter;
  targetPath: string;
  previousSelectedSkillIds: string[];
  previousEnabled: boolean;
  previousTargetPath?: string;
  /** The final selection for this agent, after dependency expansion and additive merging. */
  nextSelectedSkillIds: string[];
  selections: ResolvedSkillSelection[];
}

export interface ResolveSelectionsResult {
  agents: AgentPlanInput[];
  errors: MachineError[];
  /** Recommended skills that were not selected, reported so the agent can offer them. */
  recommendationsNotSelected: string[];
  dependenciesAdded: string[];
}

/**
 * Turns a normalized request into a concrete per-agent selection.
 *
 * Explicit selections are strict: an unknown skill or an unsupported skill/agent pair is a
 * blocking error, never a silent skip. `allCompatible` is permissive by construction — it only
 * ever includes skills that already declare support for the target agent — and reports what it
 * excluded through `recommendationsNotSelected` and the caller's warnings.
 */
export function resolveSelections(options: {
  request: NormalizedInstallRequest;
  adapters: readonly AgentAdapter[];
  skills: readonly DiscoveredSkill[];
  config: ManagerConfig | undefined;
  homeDir: string;
}): ResolveSelectionsResult {
  const errors: MachineError[] = [];
  const agents: AgentPlanInput[] = [];
  const skillsById = new Map(options.skills.map((skill) => [skill.id, skill]));
  const adaptersById = new Map(options.adapters.map((adapter) => [adapter.id, adapter]));
  const dependenciesAdded = new Set<string>();
  const recommendations = new Set<string>();

  for (const agentIdValue of options.request.targetAgents) {
    const adapter = adaptersById.get(agentIdValue as AgentId);

    if (adapter === undefined) {
      errors.push(
        createMachineError('UNKNOWN_AGENT', `Unknown agent "${agentIdValue}".`, {
          agentId: agentIdValue,
          field: 'targetAgents'
        })
      );
      continue;
    }

    if (adapter.supportStatus === 'deferred' || adapter.supportStatus === 'unavailable') {
      errors.push(
        createMachineError(
          'AGENT_NOT_SUPPORTED',
          `${adapter.displayName} is ${adapter.supportStatus} and cannot receive linked skills.`,
          {agentId: adapter.id}
        )
      );
      continue;
    }

    const agentConfig: AgentConfig | undefined = options.config?.agents?.[adapter.id];
    const requestedTargetPath = options.request.agentTargetPaths?.[adapter.id];
    const targetPath = requestedTargetPath ?? agentConfig?.targetPath ?? adapter.defaultTargetPath;

    if (targetPath === undefined || targetPath.trim() === '') {
      errors.push(
        createMachineError(
          'AGENT_TARGET_REQUIRED',
          `${adapter.displayName} has no target path; pass agentTargetPaths.${adapter.id} in the request.`,
          {agentId: adapter.id, field: 'agentTargetPaths'}
        )
      );
      continue;
    }

    const requested = requestedSelectionsFor(adapter.id, options.request, options.skills, skillsById, errors);

    if (requested === undefined) {
      continue;
    }

    const expanded = expandRequiredDependencies(options.skills, requested);

    for (const missing of expanded.missing) {
      errors.push(
        createMachineError(
          'SKILL_NOT_FOUND',
          `Skill "${missing.requiredBy}" requires "${missing.skillId}", which is not in the active skillpack.`,
          {skillId: missing.skillId, agentId: adapter.id}
        )
      );
    }

    for (const selection of expanded.selections) {
      const skill = skillsById.get(selection.skillId);

      if (skill === undefined) {
        continue;
      }

      if (!skill.supportedAgents.includes(adapter.id)) {
        errors.push(
          createMachineError(
            'SKILL_NOT_SUPPORTED_BY_AGENT',
            selection.reasonKind === 'dependency-of'
              ? `Required dependency "${skill.id}" (${selection.reason}) does not support ${adapter.displayName}.`
              : `Skill "${skill.id}" does not support ${adapter.displayName}.`,
            {skillId: skill.id, agentId: adapter.id}
          )
        );
        continue;
      }

      if (selection.reasonKind === 'dependency-of') {
        dependenciesAdded.add(skill.id);
      }

      for (const recommended of skill.recommends) {
        recommendations.add(recommended);
      }
    }

    const resolvedSkillIds = expanded.selections
      .filter((selection) => skillsById.has(selection.skillId))
      .map((selection) => selection.skillId);
    const previousSelectedSkillIds = [...(agentConfig?.selectedSkillIds ?? [])];
    const nextSelectedSkillIds = options.request.replaceSelection
      ? uniqueSorted(resolvedSkillIds)
      : uniqueSorted([...previousSelectedSkillIds, ...resolvedSkillIds]);

    for (const conflict of findSkillConflicts(options.skills, nextSelectedSkillIds)) {
      errors.push(
        createMachineError(
          'SKILL_CONFLICT',
          `Skills "${conflict.skillId}" and "${conflict.conflictsWithSkillId}" declare a conflict and cannot both be installed for ${adapter.displayName}.`,
          {skillId: conflict.skillId, agentId: adapter.id, details: {conflictsWith: conflict.conflictsWithSkillId}}
        )
      );
    }

    agents.push({
      adapter,
      targetPath,
      previousSelectedSkillIds: uniqueSorted(previousSelectedSkillIds),
      previousEnabled: agentConfig?.enabled ?? false,
      ...(agentConfig?.targetPath === undefined ? {} : {previousTargetPath: agentConfig.targetPath}),
      nextSelectedSkillIds,
      selections: expanded.selections
    });
  }

  const selectedEverywhere = new Set(agents.flatMap((agent) => agent.nextSelectedSkillIds));

  return {
    agents,
    errors,
    dependenciesAdded: [...dependenciesAdded].sort((left, right) => left.localeCompare(right)),
    recommendationsNotSelected: [...recommendations]
      .filter((skillId) => !selectedEverywhere.has(skillId) && skillsById.has(skillId))
      .sort((left, right) => left.localeCompare(right))
  };
}

function requestedSelectionsFor(
  agentId: AgentId,
  request: NormalizedInstallRequest,
  skills: readonly DiscoveredSkill[],
  skillsById: ReadonlyMap<string, DiscoveredSkill>,
  errors: MachineError[]
): ResolvedSkillSelection[] | undefined {
  if (request.allCompatible) {
    return skills
      .filter((skill) => skill.supportedAgents.includes(agentId))
      .map((skill) => ({skillId: skill.id, reason: 'all-compatible', reasonKind: 'all-compatible' as const}));
  }

  const selections: ResolvedSkillSelection[] = [];
  let hasUnknownSkill = false;

  for (const selected of request.selectedSkills ?? []) {
    if (!skillsById.has(selected.id)) {
      hasUnknownSkill = true;
      errors.push(
        createMachineError('SKILL_NOT_FOUND', `No skill named "${selected.id}" in the active skillpack.`, {
          skillId: selected.id,
          agentId,
          field: 'selectedSkills'
        })
      );
      continue;
    }

    selections.push({
      skillId: selected.id,
      reason: selected.reason ?? 'explicit',
      reasonKind: 'explicit'
    });
  }

  return hasUnknownSkill ? undefined : selections;
}

export interface BuildLinkPlanResult {
  linkPlan: LinkPlan;
  targetStates: TargetState[];
  configChanges: AgentConfigChange[];
  selections: ResolvedPlanSelection[];
}

/**
 * Produces the deterministic link plan and the intended config mutation. Link planning is
 * delegated to the existing `generateLinkPlan`, which stays authoritative for link safety.
 */
export async function buildInstallLinkPlan(options: {
  agents: readonly AgentPlanInput[];
  adapters: readonly AgentAdapter[];
  skills: readonly DiscoveredSkill[];
  manifest: ManagerManifest;
  homeDir: string;
}): Promise<BuildLinkPlanResult> {
  const targetStates = await inspectTargetStates(options.agents, options.manifest, options.homeDir);
  const selections: AgentLinkSelection[] = options.agents.map((agent) => ({
    agentId: agent.adapter.id,
    enabled: true,
    targetPath: agent.targetPath,
    selectedSkillIds: agent.nextSelectedSkillIds,
    previousSelectedSkillIds: agent.previousSelectedSkillIds
  }));
  const linkPlan = generateLinkPlan({
    adapters: [...options.adapters],
    skills: options.skills.map((skill) => ({id: skill.id, absolutePath: skill.absolutePath})),
    selections,
    homeDir: options.homeDir,
    targetStates
  });

  return {
    linkPlan,
    targetStates,
    configChanges: options.agents
      .filter((agent) => hasConfigChange(agent))
      .map((agent): AgentConfigChange => ({
        agentId: agent.adapter.id,
        enabledFrom: agent.previousEnabled,
        enabledTo: true,
        ...(agent.previousTargetPath === undefined ? {} : {targetPathFrom: agent.previousTargetPath}),
        targetPathTo: agent.targetPath,
        selectedSkillIdsFrom: agent.previousSelectedSkillIds,
        selectedSkillIdsTo: agent.nextSelectedSkillIds
      })),
    selections: options.agents
      .flatMap((agent) =>
        agent.selections.map((selection): ResolvedPlanSelection => ({
          agentId: agent.adapter.id,
          skillId: selection.skillId,
          reason: selection.reason,
          reasonKind: selection.reasonKind
        }))
      )
      .sort(
        (left, right) => left.agentId.localeCompare(right.agentId) || left.skillId.localeCompare(right.skillId)
      )
  };
}

function hasConfigChange(agent: AgentPlanInput): boolean {
  return (
    !agent.previousEnabled ||
    agent.previousTargetPath !== agent.targetPath ||
    !sameStringList(agent.previousSelectedSkillIds, agent.nextSelectedSkillIds)
  );
}

async function inspectTargetStates(
  agents: readonly AgentPlanInput[],
  manifest: ManagerManifest,
  homeDir: string
): Promise<TargetState[]> {
  const states: TargetState[] = [];
  const seenPaths = new Set<string>();

  for (const agent of agents) {
    const resolvedTargetRoot = resolveUserPath(agent.targetPath, homeDir);
    const skillIds = uniqueSorted([...agent.nextSelectedSkillIds, ...agent.previousSelectedSkillIds]);

    for (const skillId of skillIds) {
      const targetPath = path.join(resolvedTargetRoot, skillId);

      if (seenPaths.has(targetPath)) {
        continue;
      }

      seenPaths.add(targetPath);
      states.push(await inspectTargetState(targetPath, manifest));
    }
  }

  return states.sort((left, right) => left.path.localeCompare(right.path));
}

async function inspectTargetState(targetPath: string, manifest: ManagerManifest): Promise<TargetState> {
  const manifestEntry = manifest.links[targetPath];
  const exists = await pathLinkExists(targetPath);

  return {
    path: targetPath,
    exists,
    managed: manifestEntry !== undefined,
    ...(manifestEntry?.sourcePath === undefined ? {} : {sourcePath: manifestEntry.sourcePath})
  };
}

async function pathLinkExists(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

export function toPlanIssues(issues: LinkPlan['conflicts'] | LinkPlan['warnings']): PlanIssue[] {
  return issues.map((issue) => ({
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    ...(issue.agentId === undefined ? {} : {agentId: issue.agentId}),
    ...(issue.skillId === undefined ? {} : {skillId: issue.skillId}),
    ...(issue.path === undefined ? {} : {path: issue.path})
  }));
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
