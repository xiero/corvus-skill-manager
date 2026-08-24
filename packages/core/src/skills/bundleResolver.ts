import {parseBundleReference, parseSkillReference, qualifySkillId} from '../config/configSchema.js';
import type {DiscoveredBundle, DiscoveredSkill} from './skillDiscovery.js';
import type {EffectiveSkillSelection, SelectionProvenance} from './selectionModel.js';

export const bundleResolutionErrorCodes = [
  'invalid-bundle-reference',
  'bundle-not-found',
  'bundle-member-not-found',
  'bundle-member-outside-skillpack'
] as const;

export type BundleResolutionErrorCode = (typeof bundleResolutionErrorCodes)[number];

export interface BundleResolutionError {
  code: BundleResolutionErrorCode;
  bundleRef: string;
  memberRef?: string;
  message: string;
}

export interface BundleExpansionResult {
  /** Direct members in first-authored encounter order; downstream resolvers may canonicalize. */
  selections: EffectiveSkillSelection[];
  errors: BundleResolutionError[];
}

/**
 * Expands qualified bundle roots into direct skill members without traversing dependencies.
 * Bundle roots are canonicalized for deterministic results, while each bundle's authored member
 * order is preserved. Overlaps produce one skill entry with every bundle origin retained.
 */
export function expandBundleSelection(options: {
  selectedBundleRefs: readonly string[];
  bundles: readonly DiscoveredBundle[];
  skills: readonly DiscoveredSkill[];
}): BundleExpansionResult {
  const bundlesByRef = new Map(
    options.bundles.flatMap((bundle) => {
      const ref = bundleReference(bundle);
      return ref === undefined ? [] : [[ref, bundle] as const];
    })
  );
  const skillsByRef = new Map(
    options.skills.flatMap((skill) => {
      const ref = skillReference(skill);
      return ref === undefined ? [] : [[ref, skill] as const];
    })
  );
  const selectionsByRef = new Map<string, EffectiveSkillSelection>();
  const errors: BundleResolutionError[] = [];

  for (const bundleRef of uniqueSorted(options.selectedBundleRefs)) {
    const parsedBundle = parseBundleReference(bundleRef);

    if (parsedBundle === undefined) {
      errors.push({
        code: 'invalid-bundle-reference',
        bundleRef,
        message: `Bundle reference "${bundleRef}" must be a qualified <skillpack-id>:<bundle-id> reference.`
      });
      continue;
    }

    const bundle = bundlesByRef.get(bundleRef);

    if (bundle === undefined) {
      errors.push({
        code: 'bundle-not-found',
        bundleRef,
        message: `Bundle "${bundleRef}" is not available in a readable skillpack.`
      });
      continue;
    }

    for (const member of bundle.members) {
      const memberRef = member.ref ?? qualifySkillId(parsedBundle.skillpackId, member.id);
      const parsedMember = parseSkillReference(memberRef);

      if (parsedMember === undefined || parsedMember.skillpackId !== parsedBundle.skillpackId) {
        errors.push({
          code: 'bundle-member-outside-skillpack',
          bundleRef,
          memberRef,
          message: `Bundle "${bundleRef}" member "${memberRef}" must belong to skillpack "${parsedBundle.skillpackId}".`
        });
        continue;
      }

      if (!skillsByRef.has(memberRef)) {
        errors.push({
          code: 'bundle-member-not-found',
          bundleRef,
          memberRef,
          message: `Bundle "${bundleRef}" member "${memberRef}" is not available.`
        });
        continue;
      }

      const origin: SelectionProvenance = {kind: 'bundle-member', reason: `bundle:${bundleRef}`};
      const existing = selectionsByRef.get(memberRef);

      if (existing === undefined) {
        selectionsByRef.set(memberRef, {skillRef: memberRef, provenance: [origin]});
      } else if (!existing.provenance.some((item) => sameOrigin(item, origin))) {
        existing.provenance.push(origin);
      }
    }
  }

  return {selections: [...selectionsByRef.values()], errors};
}

function bundleReference(bundle: DiscoveredBundle): string | undefined {
  return bundle.ref ?? (bundle.skillpackId === undefined ? undefined : `${bundle.skillpackId}:${bundle.id}`);
}

function skillReference(skill: DiscoveredSkill): string | undefined {
  return skill.ref ?? (skill.skillpackId === undefined ? undefined : qualifySkillId(skill.skillpackId, skill.id));
}

function sameOrigin(left: SelectionProvenance, right: SelectionProvenance): boolean {
  return left.kind === right.kind && left.reason === right.reason;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
