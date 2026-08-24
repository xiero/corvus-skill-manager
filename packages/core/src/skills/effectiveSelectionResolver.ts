import {parseSkillReference} from '../config/configSchema.js';
import {expandBundleSelection, type BundleResolutionError} from './bundleResolver.js';
import type {DiscoveredBundle, DiscoveredSkill} from './skillDiscovery.js';
import {
  createSelectionReadModel,
  type SelectionProvenance,
  type SelectionReadModel
} from './selectionModel.js';

export type EffectiveSelectionResolutionError =
  | BundleResolutionError
  | {
      code: 'root-skill-not-found';
      skillRef: string;
      message: string;
    }
  | {
      code: 'required-skill-not-found' | 'required-skill-outside-skillpack';
      skillRef: string;
      requiredBy: string;
      bundleRefs: string[];
      message: string;
    };

export interface EffectiveSelectionResolution {
  selection: SelectionReadModel;
  errors: EffectiveSelectionResolutionError[];
  bundleMembersAdded: string[];
  dependenciesAdded: string[];
  /** Canonical bundle roots that transitively caused each effective skill. */
  bundleOriginsBySkill: Record<string, string[]>;
}

export interface RootSkillSelection {
  skillRef: string;
  provenance: readonly SelectionProvenance[];
}

interface TraversalState {
  skillRef: string;
  /** One bundle path at a time; undefined represents a non-bundle root path. */
  bundleRef?: string;
}

/**
 * Resolves persisted/user roots into the unique linkable skill set. The resolver is pure and
 * adapter-neutral: compatibility, conflicts, and recommendations are consumers of its result.
 */
export function resolveEffectiveSelection(options: {
  rootSkillSelections: readonly RootSkillSelection[];
  rootBundleRefs: readonly string[];
  bundles: readonly DiscoveredBundle[];
  skills: readonly DiscoveredSkill[];
}): EffectiveSelectionResolution {
  const skillsByRef = new Map(options.skills.map((skill) => [skill.ref ?? skill.id, skill]));
  const effective = new Map<string, SelectionProvenance[]>();
  const bundleOrigins = new Map<string, Set<string>>();
  const errors: EffectiveSelectionResolutionError[] = [];
  const rootOrigins = new Map<string, SelectionProvenance[]>();
  const queue: TraversalState[] = [];

  for (const root of options.rootSkillSelections) {
    addOrigins(rootOrigins, root.skillRef, root.provenance);
  }

  const rootSkillRefs = new Set([...rootOrigins.keys()].sort((left, right) => left.localeCompare(right)));

  for (const skillRef of rootSkillRefs) {
    if (!skillsByRef.has(skillRef)) {
      errors.push({
        code: 'root-skill-not-found',
        skillRef,
        message: `Root skill "${skillRef}" is not available in a readable skillpack.`
      });
      continue;
    }

    addOrigins(effective, skillRef, rootOrigins.get(skillRef) ?? []);
    queue.push({skillRef});
  }

  const bundleExpansion = expandBundleSelection({
    selectedBundleRefs: options.rootBundleRefs,
    bundles: options.bundles,
    skills: options.skills
  });
  errors.push(...bundleExpansion.errors);

  for (const member of bundleExpansion.selections) {
    addOrigins(effective, member.skillRef, member.provenance);

    for (const origin of member.provenance) {
      const bundleRef = bundleRefFromOrigin(origin);
      if (bundleRef === undefined) continue;
      addBundleOrigin(bundleOrigins, member.skillRef, bundleRef);
      queue.push({skillRef: member.skillRef, bundleRef});
    }
  }

  const initialSkillRefs = new Set([...effective.keys()]);
  const dependencySkillRefs = new Set<string>();
  const visitedStates = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    const stateKey = `${current.skillRef}\u0000${current.bundleRef ?? ''}`;
    if (visitedStates.has(stateKey)) continue;
    visitedStates.add(stateKey);

    const skill = skillsByRef.get(current.skillRef);
    if (skill === undefined) continue;

    for (const requiredSkillRef of skill.requires) {
      const parent = parseSkillReference(current.skillRef);
      const required = parseSkillReference(requiredSkillRef);
      const bundleRefs = current.bundleRef === undefined ? [] : [current.bundleRef];

      if (parent !== undefined && required !== undefined && parent.skillpackId !== required.skillpackId) {
        addRelationshipError(errors, {
          code: 'required-skill-outside-skillpack',
          skillRef: requiredSkillRef,
          requiredBy: current.skillRef,
          bundleRefs,
          message: `Skill "${current.skillRef}" requires "${requiredSkillRef}" outside its owning skillpack.`
        });
        continue;
      }

      if (!skillsByRef.has(requiredSkillRef)) {
        addRelationshipError(errors, {
          code: 'required-skill-not-found',
          skillRef: requiredSkillRef,
          requiredBy: current.skillRef,
          bundleRefs,
          message: `Skill "${current.skillRef}" requires unavailable skill "${requiredSkillRef}".`
        });
        continue;
      }

      addOrigins(effective, requiredSkillRef, [
        {kind: 'dependency-of', reason: `dependency-of:${current.skillRef}`}
      ]);
      if (!initialSkillRefs.has(requiredSkillRef)) dependencySkillRefs.add(requiredSkillRef);

      if (current.bundleRef !== undefined) {
        addBundleOrigin(bundleOrigins, requiredSkillRef, current.bundleRef);
      }

      queue.push({skillRef: requiredSkillRef, ...(current.bundleRef === undefined ? {} : {bundleRef: current.bundleRef})});
    }
  }

  const selection = createSelectionReadModel({
    rootSkillRefs: [...rootSkillRefs],
    rootBundleRefs: options.rootBundleRefs,
    effectiveSkills: [...effective].map(([skillRef, provenance]) => ({skillRef, provenance}))
  });

  return {
    selection,
    errors,
    bundleMembersAdded: bundleExpansion.selections
      .map((selection) => selection.skillRef)
      .filter((skillRef) => !rootSkillRefs.has(skillRef))
      .sort((left, right) => left.localeCompare(right)),
    dependenciesAdded: [...dependencySkillRefs].sort((left, right) => left.localeCompare(right)),
    bundleOriginsBySkill: Object.fromEntries(
      [...bundleOrigins.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([skillRef, refs]) => [skillRef, [...refs].sort((left, right) => left.localeCompare(right))])
    )
  };
}

function addOrigins(
  effective: Map<string, SelectionProvenance[]>,
  skillRef: string,
  origins: readonly SelectionProvenance[]
): void {
  const existing = effective.get(skillRef) ?? [];
  for (const origin of origins) {
    if (!existing.some((item) => item.kind === origin.kind && item.reason === origin.reason)) {
      existing.push({...origin});
    }
  }
  effective.set(skillRef, existing);
}

function bundleRefFromOrigin(origin: SelectionProvenance): string | undefined {
  return origin.kind === 'bundle-member' && origin.reason.startsWith('bundle:')
    ? origin.reason.slice('bundle:'.length)
    : undefined;
}

function addBundleOrigin(origins: Map<string, Set<string>>, skillRef: string, bundleRef: string): void {
  const refs = origins.get(skillRef) ?? new Set<string>();
  refs.add(bundleRef);
  origins.set(skillRef, refs);
}

function addRelationshipError(
  errors: EffectiveSelectionResolutionError[],
  error: Extract<EffectiveSelectionResolutionError, {requiredBy: string}>
): void {
  const existing = errors.find(
    (item): item is Extract<EffectiveSelectionResolutionError, {requiredBy: string}> =>
      'requiredBy' in item &&
      item.code === error.code &&
      item.skillRef === error.skillRef &&
      item.requiredBy === error.requiredBy
  );
  if (existing !== undefined) {
    existing.bundleRefs = [...new Set([...existing.bundleRefs, ...error.bundleRefs])].sort((left, right) =>
      left.localeCompare(right)
    );
    return;
  }
  errors.push(error);
}
