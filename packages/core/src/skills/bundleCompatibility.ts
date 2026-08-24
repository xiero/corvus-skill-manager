import type {AgentId} from '../agents/AgentAdapter.js';
import {getAgentAdapters} from '../agents/adapters.js';
import type {DiscoveredBundle, DiscoveredSkill} from './skillDiscovery.js';

export const bundleCompatibilityIssueCodes = [
  'bundle-member-not-found',
  'bundle-member-unsupported',
  'bundle-dependency-not-found',
  'bundle-dependency-unsupported'
] as const;

export type BundleCompatibilityIssueCode = (typeof bundleCompatibilityIssueCodes)[number];

export interface BundleCompatibilityIssue {
  code: BundleCompatibilityIssueCode;
  agentId: AgentId;
  bundleId: string;
  /** Direct bundle member whose effective dependency graph produced this issue. */
  memberId: string;
  /** Missing or unsupported effective skill. */
  skillId: string;
  /** Effective skill that declared `skillId` as a hard dependency, when applicable. */
  requiredBy?: string;
  message: string;
}

export interface BundleAgentCompatibility {
  agentId: AgentId;
  compatible: boolean;
  issues: BundleCompatibilityIssue[];
}

/**
 * Checks one bundle atomically for one agent. Each direct member is traversed breadth-first with
 * its transitive hard dependencies so every blocking reason retains its member provenance.
 */
export function deriveBundleAgentCompatibility(
  bundle: DiscoveredBundle,
  skills: readonly DiscoveredSkill[],
  agentId: AgentId
): BundleAgentCompatibility {
  const skillsById = new Map(skills.map((skill) => [skill.ref ?? skill.id, skill]));
  const issues: BundleCompatibilityIssue[] = [];
  const seenIssues = new Set<string>();
  const bundleId = bundle.ref ?? bundle.id;

  for (const member of [...bundle.members].sort((left, right) =>
    (left.ref ?? left.id).localeCompare(right.ref ?? right.id)
  )) {
    const memberId = member.ref ?? member.id;
    const memberSkill = skillsById.get(memberId);

    if (memberSkill === undefined) {
      addIssue(issues, seenIssues, {
        code: 'bundle-member-not-found',
        agentId,
        bundleId,
        memberId,
        skillId: memberId,
        message: `Bundle "${bundleId}" member "${memberId}" is not available.`
      });
      continue;
    }

    const queue: Array<{skill: DiscoveredSkill; direct: boolean; requiredBy?: string}> = [
      {skill: memberSkill, direct: true}
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;

      const currentId = current.skill.ref ?? current.skill.id;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      if (!current.skill.supportedAgents.includes(agentId)) {
        addIssue(issues, seenIssues, {
          code: current.direct ? 'bundle-member-unsupported' : 'bundle-dependency-unsupported',
          agentId,
          bundleId,
          memberId,
          skillId: currentId,
          ...(current.requiredBy === undefined ? {} : {requiredBy: current.requiredBy}),
          message: current.direct
            ? `Bundle "${bundleId}" member "${currentId}" does not support agent "${agentId}".`
            : `Bundle "${bundleId}" dependency "${currentId}" required by "${current.requiredBy}" does not support agent "${agentId}".`
        });
      }

      for (const requiredSkillId of [...current.skill.requires].sort((left, right) =>
        left.localeCompare(right)
      )) {
        const requiredSkill = skillsById.get(requiredSkillId);

        if (requiredSkill === undefined) {
          addIssue(issues, seenIssues, {
            code: 'bundle-dependency-not-found',
            agentId,
            bundleId,
            memberId,
            skillId: requiredSkillId,
            requiredBy: currentId,
            message: `Bundle "${bundleId}" dependency "${requiredSkillId}" required by "${currentId}" is not available.`
          });
          continue;
        }

        queue.push({skill: requiredSkill, direct: false, requiredBy: currentId});
      }
    }
  }

  const sortedIssues = sortIssues(issues);
  return {agentId, compatible: sortedIssues.length === 0, issues: sortedIssues};
}

export function deriveBundleSupportedAgents(
  bundle: DiscoveredBundle,
  skills: readonly DiscoveredSkill[]
): AgentId[] {
  return getAgentAdapters()
    .map((adapter) => adapter.id)
    .filter((agentId) => deriveBundleAgentCompatibility(bundle, skills, agentId).compatible);
}

function addIssue(
  issues: BundleCompatibilityIssue[],
  seen: Set<string>,
  issue: BundleCompatibilityIssue
): void {
  const key = [
    issue.code,
    issue.agentId,
    issue.bundleId,
    issue.memberId,
    issue.skillId,
    issue.requiredBy ?? ''
  ].join('\u0000');

  if (seen.has(key)) return;
  seen.add(key);
  issues.push(issue);
}

function sortIssues(issues: readonly BundleCompatibilityIssue[]): BundleCompatibilityIssue[] {
  return [...issues].sort(
    (left, right) =>
      left.memberId.localeCompare(right.memberId) ||
      left.skillId.localeCompare(right.skillId) ||
      left.code.localeCompare(right.code) ||
      (left.requiredBy ?? '').localeCompare(right.requiredBy ?? '')
  );
}
