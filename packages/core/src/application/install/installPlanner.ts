import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {AgentAdapter, AgentId} from '../../agents/AgentAdapter.js';
import {
  type AgentConfig,
  type ManagerConfig,
  parseSkillReference,
  resolveBundleReference,
  resolveSkillReference
} from '../../config/configSchema.js';
import {defaultSkillpackId} from '../../skillpackDefaults.js';
import {
  type AgentLinkSelection,
  type LinkPlan,
  type TargetState,
  generateLinkPlan
} from '../../links/linkPlan.js';
import type {ManagerManifest} from '../../manifest/manifestSchema.js';
import {resolveUserPath} from '../../paths.js';
import {
  resolveEffectiveSelection,
  type EffectiveSelectionResolution
} from '../../skills/effectiveSelectionResolver.js';
import type {DiscoveredBundle, DiscoveredSkill} from '../../skills/skillDiscovery.js';
import {
  type ResolvedSkillSelection,
  findSkillConflicts
} from '../../skills/skillRelationships.js';
import type {EffectiveSkillSelection, SelectionProvenance} from '../../skills/selectionModel.js';
import {type MachineError, createMachineError} from '../protocol/errors.js';
import type {AgentConfigChange, PlanIssue, ResolvedPlanSelection} from '../plans/planSchema.js';
import type {NormalizedInstallRequest} from './installRequest.js';

export interface AgentPlanInput {
  adapter: AgentAdapter;
  targetPath: string;
  previousSelectedSkillIds: string[];
  previousSelectedBundleIds: string[];
  previousEffectiveSkillIds: string[];
  previousEnabled: boolean;
  previousTargetPath?: string;
  /** The final explicit/root skill selection persisted in Manager Config v3. */
  nextSelectedSkillIds: string[];
  /** The final explicit/root bundle selection persisted in Manager Config v3. */
  nextSelectedBundleIds: string[];
  /** The derived linkable set after hard-dependency expansion. */
  effectiveSelectedSkillIds: string[];
  selections: ResolvedSkillSelection[];
}

export interface ResolveSelectionsResult {
  agents: AgentPlanInput[];
  errors: MachineError[];
  /** Recommended skills that were not selected, reported so the agent can offer them. */
  recommendationsNotSelected: string[];
  dependenciesAdded: string[];
  bundleMembersAdded: string[];
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
  bundles: readonly DiscoveredBundle[];
  config: ManagerConfig | undefined;
  homeDir: string;
}): ResolveSelectionsResult {
  const errors: MachineError[] = [];
  const agents: AgentPlanInput[] = [];
  const skillsById = new Map(options.skills.map((skill) => [skill.ref ?? skill.id, skill]));
  const bundlesById = new Map(options.bundles.map((bundle) => [bundle.ref ?? bundle.id, bundle]));
  const adaptersById = new Map(options.adapters.map((adapter) => [adapter.id, adapter]));
  const dependenciesAdded = new Set<string>();
  const bundleMembersAdded = new Set<string>();
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

    const requestedBundleIds = requestedBundleRefsFor(
      adapter.id,
      options.request,
      bundlesById,
      errors
    );

    if (requestedBundleIds === undefined) {
      continue;
    }

    const legacyPackId = options.config?.skillpack?.id ?? defaultSkillpackId;
    const previousSelectedSkillIds = uniqueSorted(
      (agentConfig?.selectedSkillIds ?? []).map((id) => resolveSkillReference(id, legacyPackId))
    );
    const previousSelectedBundleIds = uniqueSorted(agentConfig?.selectedBundleIds ?? []);
    const requestedById = new Map(requested.map((selection) => [selection.skillId, selection]));
    const requestedRootIds = requested.map((selection) => selection.skillId);
    const nextSelectedSkillIds = options.request.replaceSelection
      ? uniqueSorted(requestedRootIds)
      : uniqueSorted([...previousSelectedSkillIds, ...requestedRootIds]);
    const nextSelectedBundleIds =
      options.request.bundleSelectionMode === 'preserve'
        ? previousSelectedBundleIds
        : options.request.replaceSelection
          ? uniqueSorted(requestedBundleIds)
          : uniqueSorted([...previousSelectedBundleIds, ...requestedBundleIds]);
    const roots = nextSelectedSkillIds.map(
      (skillId): ResolvedSkillSelection =>
        requestedById.get(skillId) ?? {skillId, reason: 'explicit', reasonKind: 'explicit'}
    );
    const previousResolution = resolveEffectiveSelection({
      rootSkillSelections: previousSelectedSkillIds.map((skillRef) => ({
        skillRef,
        provenance: [{kind: 'explicit', reason: 'explicit'}]
      })),
      rootBundleRefs: previousSelectedBundleIds,
      bundles: options.bundles,
      skills: options.skills
    });
    const resolution = resolveEffectiveSelection({
      rootSkillSelections: roots.map((root) => ({
        skillRef: root.skillId,
        provenance: root.origins ?? [{kind: root.reasonKind, reason: root.reason}]
      })),
      rootBundleRefs: nextSelectedBundleIds,
      bundles: options.bundles,
      skills: options.skills
    });

    errors.push(...resolutionErrorsForAgent(resolution, adapter));
    for (const dependency of resolution.dependenciesAdded) dependenciesAdded.add(dependency);
    for (const member of resolution.bundleMembersAdded) bundleMembersAdded.add(member);

    for (const selection of resolution.selection.effectiveSkills) {
      const skill = skillsById.get(selection.skillRef);

      if (skill === undefined) {
        continue;
      }

      if (!skill.supportedAgents.includes(adapter.id)) {
        const bundleRefs = resolution.bundleOriginsBySkill[selection.skillRef] ?? [];
        const primary = primaryOrigin(selection);
        errors.push(
          createMachineError(
            'SKILL_NOT_SUPPORTED_BY_AGENT',
            bundleRefs.length > 0
              ? `Bundle${bundleRefs.length === 1 ? '' : 's'} "${bundleRefs.join('", "')}" require${bundleRefs.length === 1 ? 's' : ''} unsupported skill "${selection.skillRef}" for ${adapter.displayName}.`
              : primary.kind === 'dependency-of'
                ? `Required dependency "${selection.skillRef}" (${primary.reason}) does not support ${adapter.displayName}.`
                : `Skill "${selection.skillRef}" does not support ${adapter.displayName}.`,
            {
              skillId: selection.skillRef,
              agentId: adapter.id,
              ...(bundleRefs.length === 0
                ? {}
                : {details: {bundleRefs, origins: selection.provenance}})
            }
          )
        );
        continue;
      }

      for (const recommended of skill.recommends) {
        recommendations.add(recommended);
      }
    }

    const effectiveSelectedSkillIds = resolution.selection.effectiveSkills
      .filter((selection) => skillsById.has(selection.skillRef))
      .map((selection) => selection.skillRef);

    for (const conflict of findSkillConflicts(options.skills, effectiveSelectedSkillIds)) {
      const left = resolution.selection.effectiveSkills.find((item) => item.skillRef === conflict.skillId);
      const right = resolution.selection.effectiveSkills.find(
        (item) => item.skillRef === conflict.conflictsWithSkillId
      );
      errors.push(
        createMachineError(
          'SKILL_CONFLICT',
          `Skills "${conflict.skillId}" and "${conflict.conflictsWithSkillId}" declare a conflict and cannot both be installed for ${adapter.displayName}.`,
          {
            skillId: conflict.skillId,
            agentId: adapter.id,
            details: {
              conflictsWith: conflict.conflictsWithSkillId,
              bundleRefs: uniqueSorted([
                ...(resolution.bundleOriginsBySkill[conflict.skillId] ?? []),
                ...(resolution.bundleOriginsBySkill[conflict.conflictsWithSkillId] ?? [])
              ]),
              origins: {
                [conflict.skillId]: left?.provenance ?? [],
                [conflict.conflictsWithSkillId]: right?.provenance ?? []
              }
            }
          }
        )
      );
    }

    agents.push({
      adapter,
      targetPath,
      previousSelectedSkillIds,
      previousSelectedBundleIds,
      previousEffectiveSkillIds: previousResolution.selection.effectiveSkills
        .filter((selection) => skillsById.has(selection.skillRef))
        .map((selection) => selection.skillRef),
      previousEnabled: agentConfig?.enabled ?? false,
      ...(agentConfig?.targetPath === undefined ? {} : {previousTargetPath: agentConfig.targetPath}),
      nextSelectedSkillIds,
      nextSelectedBundleIds,
      effectiveSelectedSkillIds: uniqueSorted(effectiveSelectedSkillIds),
      selections: resolution.selection.effectiveSkills.map(toResolvedSelection)
    });
  }

  const selectedEverywhere = new Set(agents.flatMap((agent) => agent.effectiveSelectedSkillIds));

  return {
    agents,
    errors,
    dependenciesAdded: [...dependenciesAdded].sort((left, right) => left.localeCompare(right)),
    bundleMembersAdded: [...bundleMembersAdded].sort((left, right) => left.localeCompare(right)),
    recommendationsNotSelected: [...recommendations]
      .filter((skillId) => !selectedEverywhere.has(skillId) && skillsById.has(skillId))
      .sort((left, right) => left.localeCompare(right))
  };
}

function requestedBundleRefsFor(
  agentId: AgentId,
  request: NormalizedInstallRequest,
  bundlesById: ReadonlyMap<string, DiscoveredBundle>,
  errors: MachineError[]
): string[] | undefined {
  if (request.allCompatible) return [];

  const bundleRefs: string[] = [];
  let hasUnknownBundle = false;

  for (const selected of request.selectedBundles ?? []) {
    const bundleRef = resolveBundleReference(selected.id);

    if (!bundlesById.has(bundleRef)) {
      hasUnknownBundle = true;
      errors.push(
        createMachineError('BUNDLE_NOT_FOUND', `No bundle named "${bundleRef}" in a readable skillpack.`, {
          agentId,
          field: 'selectedBundles',
          details: {bundleRef}
        })
      );
      continue;
    }

    bundleRefs.push(bundleRef);
  }

  return hasUnknownBundle ? undefined : uniqueSorted(bundleRefs);
}

function resolutionErrorsForAgent(
  resolution: EffectiveSelectionResolution,
  adapter: AgentAdapter
): MachineError[] {
  return resolution.errors.map((error) => {
    if ('requiredBy' in error) {
      return createMachineError('SKILL_NOT_FOUND', error.message, {
        skillId: error.skillRef,
        agentId: adapter.id,
        details: {requiredBy: error.requiredBy, bundleRefs: error.bundleRefs, resolutionCode: error.code}
      });
    }

    if ('skillRef' in error) {
      return createMachineError('SKILL_NOT_FOUND', error.message, {
        skillId: error.skillRef,
        agentId: adapter.id,
        details: {resolutionCode: error.code}
      });
    }

    return createMachineError('SKILL_NOT_FOUND', error.message, {
      agentId: adapter.id,
      details: {
        bundleRef: error.bundleRef,
        ...(error.memberRef === undefined ? {} : {memberRef: error.memberRef}),
        resolutionCode: error.code
      }
    });
  });
}

function primaryOrigin(selection: EffectiveSkillSelection): SelectionProvenance {
  return selection.provenance[0] ?? {kind: 'explicit', reason: 'explicit'};
}

function toResolvedSelection(selection: EffectiveSkillSelection): ResolvedSkillSelection {
  const primary = primaryOrigin(selection);
  return {
    skillId: selection.skillRef,
    reason: primary.reason,
    reasonKind: primary.kind,
    origins: selection.provenance
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
      .map((skill) => ({skillId: skill.ref ?? skill.id, reason: 'all-compatible', reasonKind: 'all-compatible' as const}));
  }

  const selections: ResolvedSkillSelection[] = [];
  let hasUnknownSkill = false;

  for (const selected of request.selectedSkills ?? []) {
    const skillRef = resolveSkillReference(selected.id);

    if (!skillsById.has(skillRef)) {
      hasUnknownSkill = true;
      errors.push(
        createMachineError('SKILL_NOT_FOUND', `No skill named "${skillRef}" in a readable skillpack.`, {
          skillId: skillRef,
          agentId,
          field: 'selectedSkills'
        })
      );
      continue;
    }

    selections.push({
      skillId: skillRef,
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
  const targetStates = await inspectTargetStates(options.agents, options.skills, options.manifest, options.homeDir);
  const selections: AgentLinkSelection[] = options.agents.map((agent) => ({
    agentId: agent.adapter.id,
    enabled: true,
    targetPath: agent.targetPath,
    selectedSkillIds: agent.effectiveSelectedSkillIds,
    previousSelectedSkillIds: agent.previousEffectiveSkillIds
  }));
  const linkPlan = generateLinkPlan({
    adapters: [...options.adapters],
    skills: options.skills.map((skill) => ({
      id: skill.ref ?? skill.id,
      targetName: skill.id,
      absolutePath: skill.absolutePath
    })),
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
        selectedSkillIdsTo: agent.nextSelectedSkillIds,
        selectedBundleIdsFrom: agent.previousSelectedBundleIds,
        selectedBundleIdsTo: agent.nextSelectedBundleIds
      })),
    selections: options.agents
      .flatMap((agent) =>
        agent.selections.map((selection): ResolvedPlanSelection => ({
          agentId: agent.adapter.id,
          skillId: selection.skillId,
          reason: selection.reason,
          reasonKind: selection.reasonKind,
          origins: selection.origins ?? [{kind: selection.reasonKind, reason: selection.reason}]
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
    !sameStringList(agent.previousSelectedSkillIds, agent.nextSelectedSkillIds) ||
    !sameStringList(agent.previousSelectedBundleIds, agent.nextSelectedBundleIds)
  );
}

async function inspectTargetStates(
  agents: readonly AgentPlanInput[],
  skills: readonly DiscoveredSkill[],
  manifest: ManagerManifest,
  homeDir: string
): Promise<TargetState[]> {
  const states: TargetState[] = [];
  const seenPaths = new Set<string>();

  for (const agent of agents) {
    const resolvedTargetRoot = resolveUserPath(agent.targetPath, homeDir);
    const skillIds = uniqueSorted([...agent.effectiveSelectedSkillIds, ...agent.previousEffectiveSkillIds]);

    for (const skillId of skillIds) {
      const targetPath = path.join(
        resolvedTargetRoot,
        skills.find((skill) => (skill.ref ?? skill.id) === skillId)?.id ??
          parseSkillReference(skillId)?.skillId ??
          skillId
      );

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
