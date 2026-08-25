import {
  type AgentAdapter,
  type AgentId,
  type DiscoveredBundle,
  type DiscoveredSkill,
  type GenerateLinkPlanInput,
  type LinkPlan,
  type LinkPlanIssue,
  type ManagerConfig,
  type SelectionProvenance,
  defaultSkillpackId,
  findSkillConflicts,
  generateLinkPlan,
  resolveEffectiveSelection,
  resolveSkillReference
} from '@corvus-tools/skill-manager-core';

export interface WizardSelectionDraft {
  enabled: boolean;
  targetPath: string;
  selectedSkillIds: string[];
  selectedBundleIds: string[];
}

export interface WizardEffectiveSkillPreview {
  skillId: string;
  version?: string;
  origins: SelectionProvenance[];
}

export interface WizardAgentSelectionPreview {
  agentId: AgentId;
  rootSkillIds: string[];
  rootBundleIds: string[];
  bundleMemberIds: string[];
  dependencyIds: string[];
  effectiveSkills: WizardEffectiveSkillPreview[];
}

export interface WizardSelectionPreview {
  agents: WizardAgentSelectionPreview[];
  bundleVersions: Record<string, string>;
}

export interface WizardSelectionPlan {
  linkPlan: LinkPlan;
  preview: WizardSelectionPreview;
}

/** Derives per-bundle transitive dependencies through the same core resolver used for planning. */
export function deriveWizardBundleDependencies(
  bundles: DiscoveredBundle[],
  skills: DiscoveredSkill[]
): Record<string, string[]> {
  return Object.fromEntries(
    bundles
      .map((bundle) => bundle.ref ?? bundle.id)
      .sort((left, right) => left.localeCompare(right))
      .map((bundleRef) => [
        bundleRef,
        resolveEffectiveSelection({
          rootSkillSelections: [],
          rootBundleRefs: [bundleRef],
          bundles,
          skills
        }).dependenciesAdded
      ])
  );
}

/**
 * Resolves wizard root drafts through the shared core resolver before link planning.
 * React components only present this result; they never expand bundles or dependencies.
 */
export function createWizardSelectionPlan(options: {
  adapters: AgentAdapter[];
  skills: DiscoveredSkill[];
  bundles: DiscoveredBundle[];
  draftAgents: Record<AgentId, WizardSelectionDraft>;
  config: ManagerConfig;
  generatePlan?: (input: GenerateLinkPlanInput) => LinkPlan;
}): WizardSelectionPlan {
  const skillsByRef = new Map(options.skills.map((skill) => [skill.ref ?? skill.id, skill]));
  const bundlesByRef = new Map(options.bundles.map((bundle) => [bundle.ref ?? bundle.id, bundle]));
  const conflicts: LinkPlanIssue[] = [];
  const warnings: LinkPlanIssue[] = [];
  const selections: GenerateLinkPlanInput['selections'] = [];
  const previews: WizardAgentSelectionPreview[] = [];

  for (const adapter of options.adapters) {
    const draft = options.draftAgents[adapter.id];
    const configured = options.config.agents?.[adapter.id];
    const agentConflicts: LinkPlanIssue[] = [];
    const agentWarnings: LinkPlanIssue[] = [];
    const current = resolveForAgent({
      adapter,
      rootSkillIds: draft.selectedSkillIds,
      rootBundleIds: draft.selectedBundleIds,
      skills: options.skills,
      bundles: options.bundles,
      skillsByRef,
      conflicts: agentConflicts,
      warnings: agentWarnings
    });
    const previous = resolveEffectiveSelection({
      rootSkillSelections: (configured?.selectedSkillIds ?? []).map((skillId) => ({
        skillRef: resolveSkillReference(skillId, options.config.skillpack?.id ?? defaultSkillpackId),
        provenance: [{kind: 'explicit', reason: 'explicit'}]
      })),
      rootBundleRefs: configured?.selectedBundleIds ?? [],
      bundles: options.bundles,
      skills: options.skills
    });

    selections.push({
      agentId: adapter.id,
      enabled: draft.enabled,
      ...(draft.targetPath.trim() === '' ? {} : {targetPath: draft.targetPath}),
      selectedSkillIds: current.effectiveSkillIds,
      previousSelectedSkillIds: previous.selection.effectiveSkills.map((skill) => skill.skillRef)
    });
    if (draft.enabled) {
      conflicts.push(...agentConflicts);
      warnings.push(...agentWarnings);
      previews.push(current.preview);
    }
  }

  const basePlan = (options.generatePlan ?? generateLinkPlan)({
    adapters: options.adapters,
    skills: options.skills.map((skill) => ({
      id: skill.ref ?? skill.id,
      targetName: skill.id,
      absolutePath: skill.absolutePath
    })),
    selections
  });

  return {
    linkPlan: {
      operations: basePlan.operations,
      conflicts: sortIssues([...basePlan.conflicts, ...conflicts]),
      warnings: sortIssues([...basePlan.warnings, ...warnings])
    },
    preview: {
      agents: previews,
      bundleVersions: Object.fromEntries(
        [...bundlesByRef.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([bundleRef, bundle]) => [bundleRef, bundle.version])
      )
    }
  };
}

function resolveForAgent(options: {
  adapter: AgentAdapter;
  rootSkillIds: string[];
  rootBundleIds: string[];
  skills: DiscoveredSkill[];
  bundles: DiscoveredBundle[];
  skillsByRef: ReadonlyMap<string, DiscoveredSkill>;
  conflicts: LinkPlanIssue[];
  warnings: LinkPlanIssue[];
}): {effectiveSkillIds: string[]; preview: WizardAgentSelectionPreview} {
  const resolution = resolveEffectiveSelection({
    rootSkillSelections: options.rootSkillIds.map((skillRef) => ({
      skillRef,
      provenance: [{kind: 'explicit', reason: 'explicit'}]
    })),
    rootBundleRefs: options.rootBundleIds,
    bundles: options.bundles,
    skills: options.skills
  });

  for (const error of resolution.errors) {
    options.conflicts.push({
      severity: 'conflict',
      code: error.code,
      message: error.message,
      agentId: options.adapter.id,
      ...('skillRef' in error ? {skillId: error.skillRef} : {})
    });
  }

  const effectiveSkills = resolution.selection.effectiveSkills.flatMap((selection) => {
    const skill = options.skillsByRef.get(selection.skillRef);
    if (skill === undefined) return [];

    if (!skill.supportedAgents.includes(options.adapter.id)) {
      const bundleRefs = resolution.bundleOriginsBySkill[selection.skillRef] ?? [];
      options.conflicts.push({
        severity: 'conflict',
        code: bundleRefs.length > 0 ? 'bundle-not-supported-by-agent' : 'skill-not-supported-by-agent',
        message:
          bundleRefs.length > 0
            ? `Bundle ${bundleRefs.map((ref) => `"${ref}"`).join(', ')} requires skill "${selection.skillRef}", which does not support ${options.adapter.displayName}.`
            : `Skill "${selection.skillRef}" does not support ${options.adapter.displayName}.`,
        agentId: options.adapter.id,
        skillId: selection.skillRef
      });
    }

    return [{
      skillId: selection.skillRef,
      ...(skill.version === undefined ? {} : {version: skill.version}),
      origins: selection.provenance
    }];
  });
  const effectiveSkillIds = effectiveSkills.map((skill) => skill.skillId);

  for (const conflict of findSkillConflicts(options.skills, effectiveSkillIds)) {
    options.conflicts.push({
      severity: 'conflict',
      code: 'skill-conflict',
      message: `Skills "${conflict.skillId}" and "${conflict.conflictsWithSkillId}" declare a conflict for ${options.adapter.displayName}.`,
      agentId: options.adapter.id,
      skillId: conflict.skillId
    });
  }

  const recommendations = new Set<string>();
  for (const skillId of effectiveSkillIds) {
    for (const recommended of options.skillsByRef.get(skillId)?.recommends ?? []) {
      if (!effectiveSkillIds.includes(recommended)) recommendations.add(recommended);
    }
  }
  for (const recommended of [...recommendations].sort((left, right) => left.localeCompare(right))) {
    options.warnings.push({
      severity: 'warning',
      code: 'recommendation-not-selected',
      message: `Recommended skill "${recommended}" is not selected automatically.`,
      agentId: options.adapter.id,
      skillId: recommended
    });
  }

  return {
    effectiveSkillIds,
    preview: {
      agentId: options.adapter.id,
      rootSkillIds: [...resolution.selection.roots.skillRefs],
      rootBundleIds: [...resolution.selection.roots.bundleRefs],
      bundleMemberIds: [...resolution.bundleMembersAdded],
      dependencyIds: [...resolution.dependenciesAdded],
      effectiveSkills
    }
  };
}

function sortIssues(issues: LinkPlanIssue[]): LinkPlanIssue[] {
  const unique = new Map<string, LinkPlanIssue>();
  for (const issue of issues) {
    unique.set(
      [issue.code, issue.agentId ?? '', issue.skillId ?? '', issue.path ?? '', issue.message].join('\u0000'),
      issue
    );
  }

  return [...unique.values()].sort(
    (left, right) =>
      (left.agentId ?? '').localeCompare(right.agentId ?? '') ||
      left.code.localeCompare(right.code) ||
      (left.skillId ?? '').localeCompare(right.skillId ?? '') ||
      left.message.localeCompare(right.message)
  );
}
