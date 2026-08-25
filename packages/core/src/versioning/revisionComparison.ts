import type {DiscoveredBundle, DiscoveredSkill} from '../skills/skillDiscovery.js';
import {resolveEffectiveSelection} from '../skills/effectiveSelectionResolver.js';
import {parseSkillReference, qualifyBundleId, qualifySkillId} from '../config/configSchema.js';
import {
  classifySemanticVersionChange,
  type SemanticVersionChangeKind
} from './semver.js';

export const revisionEntityChangeKinds = ['added', 'removed', 'changed'] as const;
export type RevisionEntityChangeKind = (typeof revisionEntityChangeKinds)[number];

export const revisionVersionChangeKinds = ['major', 'minor', 'patch', 'same', 'unknown'] as const;
export type RevisionVersionChangeKind = (typeof revisionVersionChangeKinds)[number];

export interface RevisionEntityDelta {
  id: string;
  change: RevisionEntityChangeKind;
  previousVersion?: string | undefined;
  nextVersion?: string | undefined;
  versionChange: RevisionVersionChangeKind;
  breakingRisk: boolean;
}

export const affectedBundleReasonKinds = [
  'bundle-added',
  'bundle-removed',
  'bundle-changed',
  'member-added',
  'member-removed',
  'effective-skill-added',
  'effective-skill-removed',
  'effective-skill-changed'
] as const;

export type AffectedBundleReasonKind = (typeof affectedBundleReasonKinds)[number];

export interface AffectedBundleReason {
  kind: AffectedBundleReasonKind;
  entityId: string;
  versionChange: RevisionVersionChangeKind;
  breakingRisk: boolean;
  message: string;
}

export interface AffectedBundleUpdate {
  bundleId: string;
  breakingRisk: boolean;
  reasons: AffectedBundleReason[];
}

export interface SkillpackRevisionComparison {
  skillDeltas: RevisionEntityDelta[];
  bundleDeltas: RevisionEntityDelta[];
  affectedBundles: AffectedBundleUpdate[];
}

/**
 * Compares two already-discovered immutable snapshots. This is intentionally pure: callers own
 * revision IO and adapters only render or serialize the returned deterministic read model.
 */
export function compareSkillpackRevisions(options: {
  currentSkills: readonly DiscoveredSkill[];
  candidateSkills: readonly DiscoveredSkill[];
  currentBundles: readonly DiscoveredBundle[];
  candidateBundles: readonly DiscoveredBundle[];
  changedSkillIds?: readonly string[];
  selectedBundleIds?: readonly string[];
}): SkillpackRevisionComparison {
  const forcedChangedSkills = new Set(options.changedSkillIds ?? []);
  const skillDeltas = compareEntities({
    current: options.currentSkills,
    candidate: options.candidateSkills,
    signature: skillSignature,
    forcedChangedIds: forcedChangedSkills
  });
  const bundleDeltas = compareEntities({
    current: options.currentBundles,
    candidate: options.candidateBundles,
    signature: bundleSignature,
    forcedChangedIds: new Set()
  });

  return {
    skillDeltas,
    bundleDeltas,
    affectedBundles: deriveAffectedBundles({
      selectedBundleIds: options.selectedBundleIds ?? [],
      currentSkills: options.currentSkills,
      candidateSkills: options.candidateSkills,
      currentBundles: options.currentBundles,
      candidateBundles: options.candidateBundles,
      skillDeltas,
      bundleDeltas
    })
  };
}

function compareEntities<T extends {id: string; version?: string}>(options: {
  current: readonly T[];
  candidate: readonly T[];
  signature: (entity: T) => string;
  forcedChangedIds: ReadonlySet<string>;
}): RevisionEntityDelta[] {
  const currentById = new Map(options.current.map((entity) => [entity.id, entity]));
  const candidateById = new Map(options.candidate.map((entity) => [entity.id, entity]));
  const ids = [...new Set([...currentById.keys(), ...candidateById.keys()])].sort((left, right) =>
    left.localeCompare(right)
  );
  const deltas: RevisionEntityDelta[] = [];

  for (const id of ids) {
    const current = currentById.get(id);
    const candidate = candidateById.get(id);

    if (current === undefined && candidate !== undefined) {
      deltas.push(entityDelta(id, 'added', undefined, candidate.version));
      continue;
    }

    if (current !== undefined && candidate === undefined) {
      deltas.push(entityDelta(id, 'removed', current.version, undefined));
      continue;
    }

    if (current === undefined || candidate === undefined) continue;
    const changed =
      options.forcedChangedIds.has(id) ||
      current.version !== candidate.version ||
      options.signature(current) !== options.signature(candidate);

    if (changed) {
      deltas.push(entityDelta(id, 'changed', current.version, candidate.version));
    }
  }

  return deltas;
}

function entityDelta(
  id: string,
  change: RevisionEntityChangeKind,
  previousVersion: string | undefined,
  nextVersion: string | undefined
): RevisionEntityDelta {
  const versionChange = classifyVersionChange(previousVersion, nextVersion, change);

  return {
    id,
    change,
    ...(previousVersion === undefined ? {} : {previousVersion}),
    ...(nextVersion === undefined ? {} : {nextVersion}),
    versionChange,
    breakingRisk: versionChange === 'major'
  };
}

function classifyVersionChange(
  previousVersion: string | undefined,
  nextVersion: string | undefined,
  change: RevisionEntityChangeKind
): RevisionVersionChangeKind {
  if (change !== 'changed' || previousVersion === undefined || nextVersion === undefined) {
    return 'unknown';
  }

  return classifySemanticVersionChange(previousVersion, nextVersion) satisfies SemanticVersionChangeKind;
}

function deriveAffectedBundles(options: {
  selectedBundleIds: readonly string[];
  currentSkills: readonly DiscoveredSkill[];
  candidateSkills: readonly DiscoveredSkill[];
  currentBundles: readonly DiscoveredBundle[];
  candidateBundles: readonly DiscoveredBundle[];
  skillDeltas: readonly RevisionEntityDelta[];
  bundleDeltas: readonly RevisionEntityDelta[];
}): AffectedBundleUpdate[] {
  const currentBundlesById = new Map(options.currentBundles.map((bundle) => [bundle.id, bundle]));
  const candidateBundlesById = new Map(options.candidateBundles.map((bundle) => [bundle.id, bundle]));
  const skillDeltasById = new Map(options.skillDeltas.map((delta) => [delta.id, delta]));
  const bundleDeltasById = new Map(options.bundleDeltas.map((delta) => [delta.id, delta]));
  const affected: AffectedBundleUpdate[] = [];

  for (const bundleId of [...new Set(options.selectedBundleIds)].sort((left, right) => left.localeCompare(right))) {
    const currentBundle = currentBundlesById.get(bundleId);
    const candidateBundle = candidateBundlesById.get(bundleId);
    const reasons: AffectedBundleReason[] = [];
    const bundleDelta = bundleDeltasById.get(bundleId);

    if (bundleDelta !== undefined) reasons.push(bundleDeltaReason(bundleDelta));

    const currentMemberIds = new Set(currentBundle?.members.map((member) => member.id) ?? []);
    const candidateMemberIds = new Set(candidateBundle?.members.map((member) => member.id) ?? []);

    for (const memberId of [...candidateMemberIds].filter((id) => !currentMemberIds.has(id)).sort()) {
      reasons.push({
        kind: 'member-added',
        entityId: memberId,
        versionChange: 'unknown',
        breakingRisk: false,
        message: `Bundle "${bundleId}" adds direct member "${memberId}".`
      });
    }
    for (const memberId of [...currentMemberIds].filter((id) => !candidateMemberIds.has(id)).sort()) {
      reasons.push({
        kind: 'member-removed',
        entityId: memberId,
        versionChange: 'unknown',
        breakingRisk: false,
        message: `Bundle "${bundleId}" removes direct member "${memberId}".`
      });
    }

    const currentEffectiveSkillIds = new Set(
      effectiveSkillsForBundle(bundleId, options.currentBundles, options.currentSkills)
    );
    const candidateEffectiveSkillIds = new Set(
      effectiveSkillsForBundle(bundleId, options.candidateBundles, options.candidateSkills)
    );
    for (const skillId of [...candidateEffectiveSkillIds].filter((id) => !currentEffectiveSkillIds.has(id)).sort()) {
      reasons.push({
        kind: 'effective-skill-added',
        entityId: skillId,
        versionChange: 'unknown',
        breakingRisk: false,
        message: `Selected bundle "${bundleId}" adds effective skill "${skillId}".`
      });
    }
    for (const skillId of [...currentEffectiveSkillIds].filter((id) => !candidateEffectiveSkillIds.has(id)).sort()) {
      reasons.push({
        kind: 'effective-skill-removed',
        entityId: skillId,
        versionChange: 'unknown',
        breakingRisk: false,
        message: `Selected bundle "${bundleId}" removes effective skill "${skillId}".`
      });
    }
    const effectiveSkillIds = new Set([...currentEffectiveSkillIds, ...candidateEffectiveSkillIds]);
    for (const skillId of [...effectiveSkillIds].sort((left, right) => left.localeCompare(right))) {
      const delta = skillDeltasById.get(skillId);
      if (delta === undefined) continue;
      reasons.push(skillDeltaReason(bundleId, delta));
    }

    const canonicalReasons = dedupeReasons(reasons);
    if (canonicalReasons.length === 0) continue;
    affected.push({
      bundleId,
      breakingRisk: canonicalReasons.some((reason) => reason.breakingRisk),
      reasons: canonicalReasons
    });
  }

  return affected;
}

function effectiveSkillsForBundle(
  bundleId: string,
  bundles: readonly DiscoveredBundle[],
  skills: readonly DiscoveredSkill[]
): string[] {
  if (!bundles.some((bundle) => bundle.id === bundleId)) return [];
  const comparisonPackId = 'revision-comparison';
  const qualifiedSkills = skills.map((skill) => ({
    ...skill,
    skillpackId: comparisonPackId,
    ref: qualifySkillId(comparisonPackId, skill.id),
    requires: skill.requires.map((required) => qualifySkillId(comparisonPackId, required)),
    recommends: skill.recommends.map((recommended) => qualifySkillId(comparisonPackId, recommended)),
    conflictsWith: skill.conflictsWith.map((conflict) => qualifySkillId(comparisonPackId, conflict))
  }));
  const qualifiedBundles = bundles.map((bundle) => ({
    ...bundle,
    skillpackId: comparisonPackId,
    ref: qualifyBundleId(comparisonPackId, bundle.id),
    members: bundle.members.map((member) => ({
      ...member,
      ref: qualifySkillId(comparisonPackId, member.id)
    }))
  }));
  return resolveEffectiveSelection({
    rootSkillSelections: [],
    rootBundleRefs: [qualifyBundleId(comparisonPackId, bundleId)],
    bundles: qualifiedBundles,
    skills: qualifiedSkills
  }).selection.effectiveSkills.flatMap((selection) => {
    const parsed = parseSkillReference(selection.skillRef);
    return parsed === undefined ? [] : [parsed.skillId];
  });
}

function bundleDeltaReason(delta: RevisionEntityDelta): AffectedBundleReason {
  const kind = delta.change === 'added' ? 'bundle-added' : delta.change === 'removed' ? 'bundle-removed' : 'bundle-changed';
  return {
    kind,
    entityId: delta.id,
    versionChange: delta.versionChange,
    breakingRisk: delta.breakingRisk,
    message: `Selected bundle "${delta.id}" is ${delta.change}${formatVersionTransition(delta)}.`
  };
}

function skillDeltaReason(bundleId: string, delta: RevisionEntityDelta): AffectedBundleReason {
  const kind =
    delta.change === 'added' ? 'effective-skill-added' :
    delta.change === 'removed' ? 'effective-skill-removed' :
    'effective-skill-changed';
  return {
    kind,
    entityId: delta.id,
    versionChange: delta.versionChange,
    breakingRisk: delta.breakingRisk,
    message: `Selected bundle "${bundleId}" has ${delta.change} effective skill "${delta.id}"${formatVersionTransition(delta)}.`
  };
}

function formatVersionTransition(delta: RevisionEntityDelta): string {
  if (delta.previousVersion !== undefined && delta.nextVersion !== undefined) {
    return ` (${delta.previousVersion} -> ${delta.nextVersion}, ${delta.versionChange})`;
  }
  if (delta.previousVersion !== undefined) return ` (was ${delta.previousVersion})`;
  if (delta.nextVersion !== undefined) return ` (now ${delta.nextVersion})`;
  return ' (unversioned)';
}

function dedupeReasons(reasons: AffectedBundleReason[]): AffectedBundleReason[] {
  const unique = new Map<string, AffectedBundleReason>();
  for (const reason of reasons) unique.set(`${reason.kind}\u0000${reason.entityId}`, reason);
  return [...unique.values()].sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.entityId.localeCompare(right.entityId)
  );
}

function skillSignature(skill: DiscoveredSkill): string {
  return JSON.stringify({
    title: skill.title,
    description: skill.description,
    supportedAgents: [...skill.supportedAgents].sort(),
    tags: [...skill.tags].sort(),
    domains: [...skill.domains].sort(),
    tasks: [...skill.tasks].sort(),
    languages: [...skill.languages].sort(),
    technologies: [...skill.technologies].sort(),
    platforms: [...skill.platforms].sort(),
    keywords: [...skill.keywords].sort(),
    useCases: [...skill.useCases].sort(),
    nonGoals: [...skill.nonGoals].sort(),
    requires: [...skill.requires].sort(),
    recommends: [...skill.recommends].sort(),
    conflictsWith: [...skill.conflictsWith].sort(),
    relativePath: skill.relativePath,
    frontmatter: skill.frontmatter
  });
}

function bundleSignature(bundle: DiscoveredBundle): string {
  return JSON.stringify({
    title: bundle.title,
    description: bundle.description,
    tags: [...bundle.tags].sort(),
    keywords: [...bundle.keywords].sort(),
    members: bundle.members
      .map((member) => ({id: member.id, versionRange: member.versionRange}))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}
