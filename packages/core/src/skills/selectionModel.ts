/** Persisted user intent. Effective skills are deliberately absent from this structure. */
export interface RootSelection {
  skillRefs: string[];
  bundleRefs: string[];
}

export const selectionProvenanceKinds = [
  'explicit',
  'bundle-member',
  'dependency-of',
  'all-compatible'
] as const;

export type SelectionProvenanceKind = (typeof selectionProvenanceKinds)[number];

/** One explainable path by which a skill entered the effective selection. */
export interface SelectionProvenance {
  kind: SelectionProvenanceKind;
  /** Stable machine-readable value such as `bundle:team:review-flow`. */
  reason: string;
}

/** A linkable skill appears once even when several roots or dependencies imply it. */
export interface EffectiveSkillSelection {
  skillRef: string;
  provenance: SelectionProvenance[];
}

/** Shared adapter-neutral view used by planning, status, verification, and TUI presentation. */
export interface SelectionReadModel {
  roots: RootSelection;
  effectiveSkills: EffectiveSkillSelection[];
}

export interface CreateSelectionReadModelInput {
  rootSkillRefs: readonly string[];
  rootBundleRefs: readonly string[];
  effectiveSkills: ReadonlyArray<{
    skillRef: string;
    provenance: readonly SelectionProvenance[];
  }>;
}

/** Canonicalizes roots and deduplicates effective skills while retaining every provenance path. */
export function createSelectionReadModel(input: CreateSelectionReadModelInput): SelectionReadModel {
  const provenanceBySkill = new Map<string, Map<string, SelectionProvenance>>();

  for (const effective of input.effectiveSkills) {
    const provenance = provenanceBySkill.get(effective.skillRef) ?? new Map<string, SelectionProvenance>();

    for (const origin of effective.provenance) {
      provenance.set(`${origin.kind}\u0000${origin.reason}`, {...origin});
    }

    provenanceBySkill.set(effective.skillRef, provenance);
  }

  return {
    roots: {
      skillRefs: uniqueSorted(input.rootSkillRefs),
      bundleRefs: uniqueSorted(input.rootBundleRefs)
    },
    effectiveSkills: [...provenanceBySkill.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([skillRef, provenance]) => ({
        skillRef,
        provenance: [...provenance.values()].sort(compareProvenance)
      }))
  };
}

function compareProvenance(left: SelectionProvenance, right: SelectionProvenance): number {
  return (
    selectionProvenanceKinds.indexOf(left.kind) - selectionProvenanceKinds.indexOf(right.kind) ||
    left.reason.localeCompare(right.reason)
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
