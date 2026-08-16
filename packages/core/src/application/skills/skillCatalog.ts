import type {AgentId} from '../../agents/AgentAdapter.js';
import {normalizeToken} from '../../registry/registrySchema.js';
import type {DiscoveredSkill, SkillRiskWarning} from '../../skills/skillDiscovery.js';

export interface SkillSummary {
  id: string;
  skillpackId?: string;
  ref?: string;
  title: string;
  description: string;
  supportedAgents: string[];
  tags: string[];
  domains: string[];
  tasks: string[];
  languages: string[];
  technologies: string[];
  platforms: string[];
  keywords: string[];
  useCases: string[];
  nonGoals: string[];
  requires: string[];
  recommends: string[];
  conflictsWith: string[];
  relativePath: string;
  riskWarnings: SkillRiskWarning[];
}

export interface SkillCompatibility {
  agentId: AgentId;
  supported: boolean;
}

export interface SkillCatalogEntry extends SkillSummary {
  /** Present only when the caller named agents to check compatibility against. */
  compatibility?: SkillCompatibility[];
}

export interface SkillMatch {
  field: string;
  term: string;
  /** `exact` matched the whole normalized value; `partial` matched one of its sub-tokens. */
  kind: 'exact' | 'partial';
  weight: number;
}

export interface SkillSearchResult extends SkillCatalogEntry {
  score: number;
  matches: SkillMatch[];
  matchedFields: string[];
  matchedTerms: string[];
}

/**
 * Field weights for lexical ranking, highest signal first. Scoring is entirely local and
 * deterministic: no LLM, no embeddings, no network. A sub-token match scores half of an exact
 * whole-value match (rounded down), and `nonGoals` is a negative signal that demotes a skill
 * for queries it explicitly does not serve.
 */
export const searchFieldWeights = {
  id: 100,
  title: 60,
  domains: 40,
  tasks: 40,
  languages: 25,
  technologies: 25,
  platforms: 25,
  keywords: 15,
  tags: 15,
  description: 8,
  useCases: 8,
  nonGoals: -30
} as const;

/** Bonus when the entire query is exactly a skill id or title. */
export const exactIdentityBonus = 250;

export const searchLimits = {
  minLimit: 1,
  maxLimit: 100,
  defaultLimit: 20,
  maxQueryLength: 500
} as const;

export function toSkillSummary(skill: DiscoveredSkill): SkillSummary {
  return {
    id: skill.id,
    ...(skill.skillpackId === undefined ? {} : {skillpackId: skill.skillpackId}),
    ...(skill.ref === undefined ? {} : {ref: skill.ref}),
    title: skill.title,
    description: skill.description,
    supportedAgents: [...skill.supportedAgents],
    tags: [...skill.tags],
    domains: [...skill.domains],
    tasks: [...skill.tasks],
    languages: [...skill.languages],
    technologies: [...skill.technologies],
    platforms: [...skill.platforms],
    keywords: [...skill.keywords],
    useCases: [...skill.useCases],
    nonGoals: [...skill.nonGoals],
    requires: [...skill.requires],
    recommends: [...skill.recommends],
    conflictsWith: [...skill.conflictsWith],
    relativePath: skill.relativePath,
    riskWarnings: [...skill.riskWarnings]
  };
}

export function toCatalogEntry(skill: DiscoveredSkill, agentIds: readonly AgentId[]): SkillCatalogEntry {
  const summary = toSkillSummary(skill);

  if (agentIds.length === 0) {
    return summary;
  }

  return {
    ...summary,
    compatibility: agentIds.map((agentId) => ({
      agentId,
      supported: skill.supportedAgents.includes(agentId)
    }))
  };
}

/** Splits a query into normalized terms, deduplicated, order preserved. */
export function parseSearchTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const rawTerm of normalizeToken(query).split(/[^a-z0-9+#.]+/)) {
    if (rawTerm === '' || seen.has(rawTerm)) {
      continue;
    }

    seen.add(rawTerm);
    terms.push(rawTerm);
  }

  return terms;
}

export interface SearchSkillsOptions {
  skills: readonly DiscoveredSkill[];
  query: string;
  agentIds?: readonly AgentId[];
  /** Restrict results to skills supporting every listed agent. */
  filterAgentIds?: readonly AgentId[];
  limit?: number;
}

/**
 * Ranks skills for a query. Results are ordered by descending score with skill id as the stable
 * tie-breaker, so repeated searches over the same snapshot return byte-identical output.
 */
export function searchSkills(options: SearchSkillsOptions): SkillSearchResult[] {
  const terms = parseSearchTerms(options.query);
  const normalizedQuery = normalizeToken(options.query);
  const agentIds = options.agentIds ?? [];
  const filterAgentIds = options.filterAgentIds ?? [];
  const limit = options.limit ?? searchLimits.defaultLimit;
  const results: SkillSearchResult[] = [];

  for (const skill of options.skills) {
    if (filterAgentIds.some((agentId) => !skill.supportedAgents.includes(agentId))) {
      continue;
    }

    const scored = scoreSkill(skill, terms, normalizedQuery);

    if (scored.score <= 0) {
      continue;
    }

    results.push({
      ...toCatalogEntry(skill, agentIds),
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

function scoreSkill(
  skill: DiscoveredSkill,
  terms: readonly string[],
  normalizedQuery: string
): {score: number; matches: SkillMatch[]} {
  const matches: SkillMatch[] = [];
  let score = 0;

  if (normalizedQuery !== '' && (normalizeToken(skill.id) === normalizedQuery || normalizeToken(skill.title) === normalizedQuery)) {
    score += exactIdentityBonus;
    matches.push({field: 'id', term: normalizedQuery, kind: 'exact', weight: exactIdentityBonus});
  }

  const fields: Array<{name: keyof typeof searchFieldWeights; values: string[]}> = [
    {name: 'id', values: [skill.id]},
    {name: 'title', values: [skill.title]},
    {name: 'domains', values: skill.domains},
    {name: 'tasks', values: skill.tasks},
    {name: 'languages', values: skill.languages},
    {name: 'technologies', values: skill.technologies},
    {name: 'platforms', values: skill.platforms},
    {name: 'keywords', values: skill.keywords},
    {name: 'tags', values: skill.tags},
    {name: 'description', values: [skill.description]},
    {name: 'useCases', values: skill.useCases},
    {name: 'nonGoals', values: skill.nonGoals}
  ];

  for (const term of terms) {
    for (const field of fields) {
      const weight = searchFieldWeights[field.name];
      const matchKind = matchField(field.values, term);

      if (matchKind === undefined) {
        continue;
      }

      const appliedWeight = matchKind === 'exact' ? weight : halveTowardZero(weight);

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

    if (normalizedValue === term) {
      return 'exact';
    }

    if (!partial && subTokens(normalizedValue).has(term)) {
      partial = true;
    }
  }

  return partial ? 'partial' : undefined;
}

function subTokens(normalizedValue: string): Set<string> {
  return new Set(normalizedValue.split(/[^a-z0-9+#.]+/).filter((token) => token !== ''));
}

/** Halves a weight while preserving its sign, so negative signals stay negative. */
function halveTowardZero(weight: number): number {
  return weight < 0 ? -Math.floor(Math.abs(weight) / 2) : Math.floor(weight / 2);
}
