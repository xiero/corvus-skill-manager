import path from 'node:path';
import type {AgentAdapter, AgentId} from '../agents/AgentAdapter.js';
import {resolveUserPath} from '../paths.js';

export interface LinkPlanSkill {
  id: string;
  absolutePath: string;
}

export interface AgentLinkSelection {
  agentId: AgentId;
  enabled: boolean;
  targetPath?: string;
  selectedSkillIds: string[];
  previousSelectedSkillIds?: string[];
}

export interface TargetState {
  path: string;
  exists: boolean;
  managed: boolean;
  sourcePath?: string;
}

export interface LinkCreateOperation {
  type: 'create-link';
  agentId: AgentId;
  skillId: string;
  sourcePath: string;
  targetPath: string;
}

export interface LinkRemoveOperation {
  type: 'remove-link';
  agentId: AgentId;
  skillId: string;
  targetPath: string;
}

export type LinkPlanOperation = LinkCreateOperation | LinkRemoveOperation;

export interface LinkPlanIssue {
  severity: 'warning' | 'conflict';
  code: string;
  message: string;
  agentId?: AgentId;
  skillId?: string;
  path?: string;
}

export interface LinkPlan {
  operations: LinkPlanOperation[];
  conflicts: LinkPlanIssue[];
  warnings: LinkPlanIssue[];
}

export interface GenerateLinkPlanInput {
  adapters: AgentAdapter[];
  selections: AgentLinkSelection[];
  skills: LinkPlanSkill[];
  homeDir?: string;
  targetStates?: TargetState[];
}

export function generateLinkPlan(input: GenerateLinkPlanInput): LinkPlan {
  const operations: LinkPlanOperation[] = [];
  const conflicts: LinkPlanIssue[] = [];
  const warnings: LinkPlanIssue[] = [];
  const adaptersById = new Map(input.adapters.map((adapter) => [adapter.id, adapter]));
  const skillsById = new Map(input.skills.map((skill) => [skill.id, skill]));
  const targetStatesByPath = new Map(
    (input.targetStates ?? []).map((targetState) => [resolveUserPath(targetState.path, input.homeDir), targetState])
  );

  for (const selection of input.selections) {
    if (!selection.enabled) {
      continue;
    }

    const adapter = adaptersById.get(selection.agentId);

    if (adapter === undefined) {
      warnings.push({
        severity: 'warning',
        code: 'unknown-agent',
        message: `Unknown agent "${selection.agentId}" skipped.`,
        agentId: selection.agentId
      });
      continue;
    }

    if (adapter.supportStatus === 'deferred' || adapter.supportStatus === 'unavailable') {
      warnings.push({
        severity: 'warning',
        code: 'agent-not-supported',
        message: `${adapter.displayName} is ${adapter.supportStatus} and will not be planned.`,
        agentId: adapter.id
      });
      continue;
    }

    const targetRoot = selection.targetPath ?? adapter.defaultTargetPath;

    if (targetRoot === undefined || targetRoot.trim() === '') {
      warnings.push({
        severity: 'warning',
        code: 'missing-target-path',
        message: `${adapter.displayName} has no target path configured.`,
        agentId: adapter.id
      });
      continue;
    }

    const resolvedTargetRoot = resolveUserPath(targetRoot, input.homeDir);
    const selectedSkillIds = uniqueSorted(selection.selectedSkillIds);
    const previousSelectedSkillIds = uniqueSorted(selection.previousSelectedSkillIds ?? []);
    const selectedSkillIdSet = new Set(selectedSkillIds);

    for (const skillId of selectedSkillIds) {
      const skill = skillsById.get(skillId);

      if (skill === undefined) {
        warnings.push({
          severity: 'warning',
          code: 'unknown-skill',
          message: `Selected skill "${skillId}" is not discovered and will not be planned.`,
          agentId: adapter.id,
          skillId
        });
        continue;
      }

      const targetPath = path.join(resolvedTargetRoot, skill.id);
      const targetState = targetStatesByPath.get(targetPath);

      if (targetState?.exists === true && !targetState.managed) {
        conflicts.push({
          severity: 'conflict',
          code: 'unmanaged-target-exists',
          message: `Target already exists and is not manager-owned: ${targetPath}`,
          agentId: adapter.id,
          skillId: skill.id,
          path: targetPath
        });
        continue;
      }

      if (targetState?.exists === true && targetState.managed && targetState.sourcePath === skill.absolutePath) {
        warnings.push({
          severity: 'warning',
          code: 'managed-link-already-present',
          message: `Managed link already exists for ${adapter.displayName}/${skill.id}.`,
          agentId: adapter.id,
          skillId: skill.id,
          path: targetPath
        });
        continue;
      }

      operations.push({
        type: 'create-link',
        agentId: adapter.id,
        skillId: skill.id,
        sourcePath: skill.absolutePath,
        targetPath
      });
    }

    for (const skillId of previousSelectedSkillIds) {
      if (selectedSkillIdSet.has(skillId)) {
        continue;
      }

      operations.push({
        type: 'remove-link',
        agentId: adapter.id,
        skillId,
        targetPath: path.join(resolvedTargetRoot, skillId)
      });
    }
  }

  operations.sort(compareOperations);
  conflicts.sort(compareIssues);
  warnings.sort(compareIssues);

  return {operations, conflicts, warnings};
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function compareOperations(left: LinkPlanOperation, right: LinkPlanOperation): number {
  return (
    left.agentId.localeCompare(right.agentId) ||
    left.skillId.localeCompare(right.skillId) ||
    left.type.localeCompare(right.type)
  );
}

function compareIssues(left: LinkPlanIssue, right: LinkPlanIssue): number {
  return (
    (left.agentId ?? '').localeCompare(right.agentId ?? '') ||
    (left.skillId ?? '').localeCompare(right.skillId ?? '') ||
    left.code.localeCompare(right.code)
  );
}
