import type {AgentId} from '../../agents/AgentAdapter.js';
import {normalizeToken} from '../../registry/registrySchema.js';
import {
  type BundleAgentCompatibility,
  deriveBundleAgentCompatibility,
  deriveBundleSupportedAgents
} from '../../skills/bundleCompatibility.js';
import type {
  DiscoveredBundle,
  DiscoveredBundleMember,
  DiscoveredSkill
} from '../../skills/skillDiscovery.js';
import {
  type SkillMatch,
  exactIdentityBonus,
  parseSearchTerms,
  searchLimits
} from './skillCatalog.js';

export interface BundleMemberSummary {
  id: string;
  ref?: string;
  versionRange: string;
  actualVersion?: string;
}

export interface BundleSummary {
  id: string;
  skillpackId?: string;
  ref?: string;
  version: string;
  title: string;
  description: string;
  tags: string[];
  keywords: string[];
  members: BundleMemberSummary[];
  /** Agents supported by every direct member and transitive hard dependency. */
  supportedAgents: AgentId[];
}

export interface BundleCatalogEntry extends BundleSummary {
  /** Present only when the caller named agents to check. */
  compatibility?: BundleAgentCompatibility[];
}

export interface BundleSearchResult extends BundleCatalogEntry {
  score: number;
  matches: SkillMatch[];
  matchedFields: string[];
  matchedTerms: string[];
}

export const bundleSearchFieldWeights = {
  id: 100,
  title: 60,
  keywords: 15,
  tags: 15,
  description: 8
} as const;

export const bundleCatalogLimits = {
  ...searchLimits,
  maxInspectIds: 100
} as const;

export function toBundleSummary(
  bundle: DiscoveredBundle,
  skills: readonly DiscoveredSkill[]
): BundleSummary {
  return {
    id: bundle.id,
    ...(bundle.skillpackId === undefined ? {} : {skillpackId: bundle.skillpackId}),
    ...(bundle.ref === undefined ? {} : {ref: bundle.ref}),
    version: bundle.version,
    title: bundle.title,
    description: bundle.description,
    tags: [...bundle.tags],
    keywords: [...bundle.keywords],
    members: bundle.members.map(toMemberSummary),
    supportedAgents: deriveBundleSupportedAgents(bundle, skills)
  };
}

export function toBundleCatalogEntry(
  bundle: DiscoveredBundle,
  skills: readonly DiscoveredSkill[],
  agentIds: readonly AgentId[]
): BundleCatalogEntry {
  const summary = toBundleSummary(bundle, skills);

  if (agentIds.length === 0) return summary;

  return {
    ...summary,
    compatibility: agentIds.map((agentId) =>
      deriveBundleAgentCompatibility(bundle, skills, agentId)
    )
  };
}

export interface SearchBundlesOptions {
  bundles: readonly DiscoveredBundle[];
  skills: readonly DiscoveredSkill[];
  query: string;
  agentIds?: readonly AgentId[];
  /** Restrict results to bundles compatible with every listed agent. */
  filterAgentIds?: readonly AgentId[];
  limit?: number;
}

/** Separate deterministic lexical ranking for bundle catalog metadata. */
export function searchBundles(options: SearchBundlesOptions): BundleSearchResult[] {
  const terms = parseSearchTerms(options.query);
  const normalizedQuery = normalizeToken(options.query);
  const agentIds = options.agentIds ?? [];
  const filterAgentIds = options.filterAgentIds ?? [];
  const limit = options.limit ?? bundleCatalogLimits.defaultLimit;
  const results: BundleSearchResult[] = [];

  for (const bundle of options.bundles) {
    if (
      filterAgentIds.some(
        (agentId) => !deriveBundleAgentCompatibility(bundle, options.skills, agentId).compatible
      )
    ) {
      continue;
    }

    const scored = scoreBundle(bundle, terms, normalizedQuery);
    if (scored.score <= 0) continue;

    results.push({
      ...toBundleCatalogEntry(bundle, options.skills, agentIds),
      score: scored.score,
      matches: scored.matches,
      matchedFields: [...new Set(scored.matches.map((match) => match.field))].sort(),
      matchedTerms: [...new Set(scored.matches.map((match) => match.term))].sort()
    });
  }

  results.sort(
    (left, right) =>
      right.score - left.score || (left.ref ?? left.id).localeCompare(right.ref ?? right.id)
  );

  return results.slice(0, limit);
}

function toMemberSummary(member: DiscoveredBundleMember): BundleMemberSummary {
  return {
    id: member.id,
    ...(member.ref === undefined ? {} : {ref: member.ref}),
    versionRange: member.versionRange,
    ...(member.actualVersion === undefined ? {} : {actualVersion: member.actualVersion})
  };
}

function scoreBundle(
  bundle: DiscoveredBundle,
  terms: readonly string[],
  normalizedQuery: string
): {score: number; matches: SkillMatch[]} {
  const matches: SkillMatch[] = [];
  let score = 0;

  if (
    normalizedQuery !== '' &&
    (normalizeToken(bundle.id) === normalizedQuery ||
      normalizeToken(bundle.title) === normalizedQuery)
  ) {
    score += exactIdentityBonus;
    matches.push({
      field: 'id',
      term: normalizedQuery,
      kind: 'exact',
      weight: exactIdentityBonus
    });
  }

  const fields: Array<{name: keyof typeof bundleSearchFieldWeights; values: string[]}> = [
    {name: 'id', values: [bundle.id]},
    {name: 'title', values: [bundle.title]},
    {name: 'keywords', values: bundle.keywords},
    {name: 'tags', values: bundle.tags},
    {name: 'description', values: [bundle.description]}
  ];

  for (const term of terms) {
    for (const field of fields) {
      const matchKind = matchField(field.values, term);
      if (matchKind === undefined) continue;

      const weight = bundleSearchFieldWeights[field.name];
      const appliedWeight = matchKind === 'exact' ? weight : Math.floor(weight / 2);
      score += appliedWeight;
      matches.push({field: field.name, term, kind: matchKind, weight: appliedWeight});
    }
  }

  return {score, matches};
}

function matchField(values: readonly string[], term: string): 'exact' | 'partial' | undefined {
  let partial = false;

  for (const value of values) {
    const normalizedValue = normalizeToken(value);
    if (normalizedValue === term) return 'exact';

    if (
      !partial &&
      normalizedValue
        .split(/[^a-z0-9+#.]+/)
        .filter((token) => token !== '')
        .includes(term)
    ) {
      partial = true;
    }
  }

  return partial ? 'partial' : undefined;
}
