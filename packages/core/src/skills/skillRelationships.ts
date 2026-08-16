import type {AgentId} from '../agents/AgentAdapter.js';
import type {DiscoveredSkill, SkillDiscoveryIssue} from './skillDiscovery.js';

/** Why a skill ended up in an expanded selection. */
export type SkillSelectionReasonKind = 'explicit' | 'dependency-of' | 'all-compatible';

export interface ResolvedSkillSelection {
  skillId: string;
  /** Stable, machine-readable provenance, e.g. `dependency-of:embedded-driver-development`. */
  reason: string;
  reasonKind: SkillSelectionReasonKind;
}

export interface SkillConflict {
  skillId: string;
  conflictsWithSkillId: string;
}

export function isSkillSupportedByAgent(skill: DiscoveredSkill, agentId: AgentId): boolean {
  return skill.supportedAgents.includes(agentId);
}

export interface ExpandRequiredDependenciesResult {
  selections: ResolvedSkillSelection[];
  /** Required dependencies that are not present in the discovered skill set. */
  missing: Array<{skillId: string; requiredBy: string}>;
}

/**
 * Expands `requires` transitively over the discovered skill set.
 *
 * The traversal is breadth-first over the input order, so the result is deterministic, and it
 * tracks visited IDs so a required-dependency cycle terminates instead of recursing forever.
 * Cycles are reported separately by discovery validation; this function only has to be safe.
 */
export function expandRequiredDependencies(
  skills: readonly DiscoveredSkill[],
  requestedSelections: readonly ResolvedSkillSelection[]
): ExpandRequiredDependenciesResult {
  const skillsById = new Map(skills.map((skill) => [skill.ref ?? skill.id, skill]));
  const selections: ResolvedSkillSelection[] = [];
  const missing: Array<{skillId: string; requiredBy: string}> = [];
  const seenSelections = new Set<string>();
  const seenMissing = new Set<string>();
  const queue: ResolvedSkillSelection[] = [];

  for (const requested of requestedSelections) {
    if (seenSelections.has(requested.skillId)) {
      continue;
    }

    seenSelections.add(requested.skillId);
    selections.push(requested);
    queue.push(requested);
  }

  while (queue.length > 0) {
    const current = queue.shift();

    if (current === undefined) {
      break;
    }

    const skill = skillsById.get(current.skillId);

    if (skill === undefined) {
      continue;
    }

    for (const requiredSkillId of skill.requires) {
      if (!skillsById.has(requiredSkillId)) {
        const skillRef = skill.ref ?? skill.id;
        const missingKey = `${requiredSkillId} ${skillRef}`;

        if (!seenMissing.has(missingKey)) {
          seenMissing.add(missingKey);
          missing.push({skillId: requiredSkillId, requiredBy: skillRef});
        }

        continue;
      }

      if (seenSelections.has(requiredSkillId)) {
        continue;
      }

      const dependencySelection: ResolvedSkillSelection = {
        skillId: requiredSkillId,
        reason: `dependency-of:${skill.ref ?? skill.id}`,
        reasonKind: 'dependency-of'
      };

      seenSelections.add(requiredSkillId);
      selections.push(dependencySelection);
      queue.push(dependencySelection);
    }
  }

  return {selections, missing};
}

/**
 * Finds declared conflicts inside a selection. Conflicts are treated as symmetric: if either
 * side declares the conflict, the pair is reported once, ordered by skill ID.
 */
export function findSkillConflicts(
  skills: readonly DiscoveredSkill[],
  selectedSkillIds: readonly string[]
): SkillConflict[] {
  const selected = new Set(selectedSkillIds);
  const skillsById = new Map(skills.map((skill) => [skill.ref ?? skill.id, skill]));
  const seenPairs = new Set<string>();
  const conflicts: SkillConflict[] = [];

  for (const skillId of [...selected].sort((left, right) => left.localeCompare(right))) {
    const skill = skillsById.get(skillId);

    if (skill === undefined) {
      continue;
    }

    for (const conflictsWithSkillId of skill.conflictsWith) {
      if (!selected.has(conflictsWithSkillId)) {
        continue;
      }

      const [left, right] = [skillId, conflictsWithSkillId].sort((a, b) => a.localeCompare(b)) as [string, string];
      const pairKey = `${left} ${right}`;

      if (seenPairs.has(pairKey)) {
        continue;
      }

      seenPairs.add(pairKey);
      conflicts.push({skillId: left, conflictsWithSkillId: right});
    }
  }

  return conflicts;
}

/**
 * Validates relationships once the whole skill set is known.
 *
 * Blocking (errors): unknown `requires`/`conflictsWith` targets, self-dependency,
 * self-conflict, and required-dependency cycles.
 * Non-blocking (warnings): unknown `recommends` targets.
 */
export function validateSkillRelationships(skills: readonly DiscoveredSkill[]): {
  errors: SkillDiscoveryIssue[];
  warnings: SkillDiscoveryIssue[];
} {
  const errors: SkillDiscoveryIssue[] = [];
  const warnings: SkillDiscoveryIssue[] = [];
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));

  for (const skill of skills) {
    for (const requiredSkillId of skill.requires) {
      if (requiredSkillId === skill.id) {
        errors.push({
          severity: 'error',
          code: 'self-dependency',
          message: `Skill "${skill.id}" requires itself (requires[${skill.requires.indexOf(requiredSkillId)}]).`,
          skillId: skill.id
        });
        continue;
      }

      if (!skillsById.has(requiredSkillId)) {
        errors.push({
          severity: 'error',
          code: 'unknown-required-skill',
          message: `Skill "${skill.id}" requires unknown skill "${requiredSkillId}" (requires[${skill.requires.indexOf(requiredSkillId)}]).`,
          skillId: skill.id
        });
      }
    }

    for (const conflictSkillId of skill.conflictsWith) {
      if (conflictSkillId === skill.id) {
        errors.push({
          severity: 'error',
          code: 'self-conflict',
          message: `Skill "${skill.id}" conflicts with itself (conflictsWith[${skill.conflictsWith.indexOf(conflictSkillId)}]).`,
          skillId: skill.id
        });
        continue;
      }

      if (!skillsById.has(conflictSkillId)) {
        errors.push({
          severity: 'error',
          code: 'unknown-conflicting-skill',
          message: `Skill "${skill.id}" declares a conflict with unknown skill "${conflictSkillId}" (conflictsWith[${skill.conflictsWith.indexOf(conflictSkillId)}]).`,
          skillId: skill.id
        });
      }
    }

    for (const recommendedSkillId of skill.recommends) {
      if (recommendedSkillId === skill.id) {
        warnings.push({
          severity: 'warning',
          code: 'self-recommendation',
          message: `Skill "${skill.id}" recommends itself (recommends[${skill.recommends.indexOf(recommendedSkillId)}]).`,
          skillId: skill.id
        });
        continue;
      }

      if (!skillsById.has(recommendedSkillId)) {
        warnings.push({
          severity: 'warning',
          code: 'unknown-recommended-skill',
          message: `Skill "${skill.id}" recommends unknown skill "${recommendedSkillId}" (recommends[${skill.recommends.indexOf(recommendedSkillId)}]).`,
          skillId: skill.id
        });
      }
    }
  }

  for (const cycle of findRequiredDependencyCycles(skills)) {
    errors.push({
      severity: 'error',
      code: 'required-dependency-cycle',
      message: `Required dependency cycle: ${cycle.join(' -> ')}.`,
      skillId: cycle[0] ?? ''
    });
  }

  return {errors: sortIssues(errors), warnings: sortIssues(warnings)};
}

/**
 * Returns each distinct required-dependency cycle once, as a closed path
 * (`a -> b -> a`). Skills are visited in ID order so the output is deterministic.
 */
export function findRequiredDependencyCycles(skills: readonly DiscoveredSkill[]): string[][] {
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const sortedSkillIds = [...skillsById.keys()].sort((left, right) => left.localeCompare(right));
  const permanentlyVisited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const seenCycleKeys = new Set<string>();
  const cycles: string[][] = [];

  function visit(skillId: string): void {
    if (permanentlyVisited.has(skillId)) {
      return;
    }

    if (onStack.has(skillId)) {
      const cycleStart = stack.indexOf(skillId);
      const cycle = [...stack.slice(cycleStart), skillId];
      const cycleKey = canonicalCycleKey(cycle.slice(0, -1));

      if (!seenCycleKeys.has(cycleKey)) {
        seenCycleKeys.add(cycleKey);
        cycles.push(cycle);
      }

      return;
    }

    const skill = skillsById.get(skillId);

    if (skill === undefined) {
      return;
    }

    stack.push(skillId);
    onStack.add(skillId);

    for (const requiredSkillId of skill.requires) {
      if (requiredSkillId === skillId) {
        continue;
      }

      visit(requiredSkillId);
    }

    stack.pop();
    onStack.delete(skillId);
    permanentlyVisited.add(skillId);
  }

  for (const skillId of sortedSkillIds) {
    visit(skillId);
  }

  return cycles;
}

/** Rotation-independent identity for a cycle, so `a->b->a` and `b->a->b` are one cycle. */
function canonicalCycleKey(cycleNodes: readonly string[]): string {
  if (cycleNodes.length === 0) {
    return '';
  }

  const rotations = cycleNodes.map((_, index) =>
    [...cycleNodes.slice(index), ...cycleNodes.slice(0, index)].join(' ')
  );

  return rotations.sort()[0] ?? '';
}

function sortIssues(issues: SkillDiscoveryIssue[]): SkillDiscoveryIssue[] {
  return [...issues].sort(
    (left, right) =>
      (left.skillId ?? '').localeCompare(right.skillId ?? '') ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message)
  );
}
