import {promises as fs} from 'node:fs';
import type {AgentId} from '../../agents/AgentAdapter.js';
import {resolveSkillReference} from '../../config/configSchema.js';
import {getAgentAdapter, getAgentAdapters} from '../../agents/adapters.js';
import {resolveUserPath} from '../../paths.js';
import {
  type SemanticMetadataField,
  currentRegistryVersion,
  registryVersions,
  semanticMetadataFields
} from '../../registry/registrySchema.js';
import {
  type DiscoveredSkill,
  type SkillDiscoveryIssue,
  type SkillDiscoveryResult,
  discoverSkillsFromCheckout
} from '../../skills/skillDiscovery.js';
import {deriveBundleAgentCompatibility} from '../../skills/bundleCompatibility.js';
import {findRequiredDependencyCycles} from '../../skills/skillRelationships.js';
import {
  type RevisionEntityDelta,
  type VersionDisciplineIssue,
  compareSkillpackRevisions,
  findVersionDisciplineIssues
} from '../../versioning/revisionComparison.js';
import {findChangedSkillContentIds} from '../../versioning/skillContentFingerprint.js';
import {isPrecondition, loadContext, requireReadySkillpack} from '../context.js';
import type {ApplicationEnvironment} from '../ports.js';
import {
  type BundleCatalogEntry,
  type BundleSearchResult,
  type BundleSummary,
  bundleCatalogLimits,
  searchBundles,
  toBundleCatalogEntry,
  toBundleSummary
} from '../skills/bundleCatalog.js';
import {
  type MachineError,
  type MachineWarning,
  createMachineError,
  createMachineWarning
} from '../protocol/errors.js';
import {createNextAction} from '../protocol/nextActions.js';
import {type UseCaseResult, fail, failWith, succeed} from '../protocol/result.js';
import {
  type SkillCatalogEntry,
  type SkillSearchResult,
  type SkillSummary,
  searchLimits,
  searchSkills,
  toCatalogEntry,
  toSkillSummary
} from '../skills/skillCatalog.js';

export interface BundlesListOptions {
  agentIds?: string[];
  limit?: number;
}

export interface BundlesListData {
  skillpackCheckoutPaths: string[];
  source: string;
  limit: number;
  totalBundles: number;
  bundleCount: number;
  bundles: BundleCatalogEntry[];
}

export interface BundlesSearchOptions {
  query: string;
  agentIds?: string[];
  limit?: number;
}

export interface BundlesSearchData {
  query: string;
  terms: string[];
  limit: number;
  totalMatches: number;
  results: BundleSearchResult[];
}

export interface BundlesInspectOptions {
  bundleIds: string[];
}

export interface InspectedBundle extends BundleSummary {
  compatibility: ReturnType<typeof deriveBundleAgentCompatibility>[];
}

export interface BundlesInspectData {
  bundles: InspectedBundle[];
}

export interface SkillsListOptions {
  agentIds?: string[];
}

export interface SkillsListData {
  skillpackCheckoutPath: string;
  skillpackCheckoutPaths: string[];
  registryVersion?: number;
  source: string;
  skillCount: number;
  skills: SkillCatalogEntry[];
}

export interface SkillsSearchOptions {
  query: string;
  agentIds?: string[];
  limit?: number;
}

export interface SkillsSearchData {
  query: string;
  terms: string[];
  limit: number;
  totalMatches: number;
  results: SkillSearchResult[];
}

export interface SkillsInspectOptions {
  skillIds: string[];
  includeContent?: boolean;
}

export interface InspectedSkill extends SkillSummary {
  absolutePath: string;
  skillFilePath: string;
  frontmatter: {name: string; description: string};
  content?: string;
}

export interface SkillsInspectData {
  skills: InspectedSkill[];
}

export interface RegistryFieldCoverage {
  field: SemanticMetadataField | 'requires' | 'recommends' | 'conflictsWith';
  skillsWithValues: number;
  totalSkills: number;
  /** Whole-percent coverage, rounded down, so the number is stable across runs. */
  percent: number;
}

export interface ValidateRegistryData {
  registryPath: string;
  source: string;
  registryVersion?: number;
  supportedRegistryVersions: number[];
  currentRegistryVersion: number;
  skillCount: number;
  versionedSkillCount: number;
  bundleCount: number;
  validBundleMembershipCount: number;
  valid: boolean;
  invalidEntries: SkillDiscoveryIssue[];
  unknownRelationshipTargets: SkillDiscoveryIssue[];
  requiredDependencyCycles: string[][];
  skillsMissingSemanticMetadata: string[];
  coverage: RegistryFieldCoverage[];
}

export const versionDisciplineSeverities = ['error', 'warning'] as const;
export type VersionDisciplineSeverity = (typeof versionDisciplineSeverities)[number];

export interface CheckVersionDisciplineOptions {
  basePath: string;
  candidatePath: string;
  severity?: string;
}

export interface CheckVersionDisciplineData {
  basePath: string;
  candidatePath: string;
  baseRegistryVersion: 3;
  candidateRegistryVersion: 3;
  severity: VersionDisciplineSeverity;
  valid: boolean;
  skillDeltas: RevisionEntityDelta[];
  bundleDeltas: RevisionEntityDelta[];
  issues: VersionDisciplineIssue[];
}

export interface DiscoverSkillsData {
  skillpackCheckoutPath: string;
  skillpackCheckoutPaths: string[];
  discovery: import('../../skills/skillDiscovery.js').SkillDiscoveryResult;
}

/**
 * Returns the raw discovery result, including warnings and errors.
 *
 * The catalog commands present a normalized, token-efficient view; this use case exists so the
 * TUI's discovery screen can share the same precondition handling without the machine CLI
 * having to expose an equivalent command.
 */
export async function discoverSkillsUseCase(
  environment: ApplicationEnvironment
): Promise<UseCaseResult<DiscoverSkillsData>> {
  const ready = await loadReadyDiscovery(environment);

  if (!ready.ok) {
    return ready.failure;
  }

  return succeed(
    {
      skillpackCheckoutPath: ready.checkoutPath,
      skillpackCheckoutPaths: ready.checkoutPaths,
      discovery: ready.discovery
    },
    {warnings: discoveryWarnings([...ready.discovery.warnings, ...ready.discovery.errors])}
  );
}

export async function skillsListUseCase(
  environment: ApplicationEnvironment,
  options: SkillsListOptions = {}
): Promise<UseCaseResult<SkillsListData>> {
  const ready = await loadReadyDiscovery(environment);

  if (!ready.ok) {
    return ready.failure;
  }

  const agentIds = parseAgentIds(options.agentIds ?? []);

  if (!agentIds.ok) {
    return fail(agentIds.errors);
  }

  const skills = ready.discovery.skills
    .filter((skill) => agentIds.value.every((agentId) => skill.supportedAgents.includes(agentId)))
    .map((skill) => toCatalogEntry(skill, agentIds.value));

  return succeed(
    {
      skillpackCheckoutPath: ready.checkoutPath,
      skillpackCheckoutPaths: ready.checkoutPaths,
      ...(ready.discovery.registryVersion === undefined
        ? {}
        : {registryVersion: ready.discovery.registryVersion}),
      source: ready.discovery.source,
      skillCount: skills.length,
      skills
    },
    {
      warnings: discoveryWarnings([...ready.discovery.warnings, ...ready.discovery.errors]),
      nextActions: [
        createNextAction(
          'inspect-skills',
          'Inspect candidate skills before selecting exact IDs.',
          'corvus-skills skills inspect <skill-id...> --json'
        )
      ]
    }
  );
}

export async function skillsSearchUseCase(
  environment: ApplicationEnvironment,
  options: SkillsSearchOptions
): Promise<UseCaseResult<SkillsSearchData>> {
  const query = options.query.trim();

  if (query === '') {
    return failWith(
      createMachineError('INVALID_REQUEST', 'A non-empty --query is required.', {field: 'query'})
    );
  }

  if (query.length > searchLimits.maxQueryLength) {
    return failWith(
      createMachineError(
        'INVALID_REQUEST',
        `--query must be at most ${searchLimits.maxQueryLength} characters.`,
        {field: 'query'}
      )
    );
  }

  const limit = options.limit ?? searchLimits.defaultLimit;

  if (!Number.isInteger(limit) || limit < searchLimits.minLimit || limit > searchLimits.maxLimit) {
    return failWith(
      createMachineError(
        'INVALID_REQUEST',
        `--limit must be an integer between ${searchLimits.minLimit} and ${searchLimits.maxLimit}.`,
        {field: 'limit'}
      )
    );
  }

  const ready = await loadReadyDiscovery(environment);

  if (!ready.ok) {
    return ready.failure;
  }

  const agentIds = parseAgentIds(options.agentIds ?? []);

  if (!agentIds.ok) {
    return fail(agentIds.errors);
  }

  const allResults = searchSkills({
    skills: ready.discovery.skills,
    query,
    agentIds: agentIds.value,
    filterAgentIds: agentIds.value,
    limit: ready.discovery.skills.length
  });

  return succeed(
    {
      query,
      terms: allResults.length === 0 ? [] : [...new Set(allResults.flatMap((result) => result.matchedTerms))].sort(),
      limit,
      totalMatches: allResults.length,
      results: allResults.slice(0, limit)
    },
    {
      warnings: discoveryWarnings([...ready.discovery.warnings, ...ready.discovery.errors]),
      nextActions: [
        createNextAction(
          'inspect-skills',
          'Inspect the top candidates, then pass exact skill IDs to install plan.',
          'corvus-skills skills inspect <skill-id...> --json'
        )
      ]
    }
  );
}

export async function skillsInspectUseCase(
  environment: ApplicationEnvironment,
  options: SkillsInspectOptions
): Promise<UseCaseResult<SkillsInspectData>> {
  if (options.skillIds.length === 0) {
    return failWith(
      createMachineError('INVALID_REQUEST', 'At least one skill id is required.', {field: 'skillIds'})
    );
  }

  const ready = await loadReadyDiscovery(environment);

  if (!ready.ok) {
    return ready.failure;
  }

  const skillsById = new Map(ready.discovery.skills.map((skill) => [skill.ref ?? skill.id, skill]));
  const requestedSkillIds = [...new Set(options.skillIds.map((id) => resolveSkillReference(id)))].sort(
    (left, right) => left.localeCompare(right)
  );
  const missingSkillIds = requestedSkillIds.filter((skillId) => !skillsById.has(skillId));

  if (missingSkillIds.length > 0) {
    return fail(
      missingSkillIds.map((skillId) =>
        createMachineError('SKILL_NOT_FOUND', `No skill named "${skillId}" in a readable skillpack.`, {skillId})
      ),
      {
        nextActions: [
          createNextAction('list-skills', 'List available skill IDs.', 'corvus-skills skills list --json')
        ]
      }
    );
  }

  const skills: InspectedSkill[] = [];

  for (const skillId of requestedSkillIds) {
    const skill = skillsById.get(skillId);

    if (skill === undefined) {
      continue;
    }

    const content = options.includeContent === true ? await readSkillContent(skill) : undefined;

    skills.push({
      ...toSkillSummary(skill),
      absolutePath: skill.absolutePath,
      skillFilePath: skill.skillFilePath,
      frontmatter: {...skill.frontmatter},
      ...(content === undefined ? {} : {content})
    });
  }

  return succeed({skills});
}

export async function bundlesListUseCase(
  environment: ApplicationEnvironment,
  options: BundlesListOptions = {}
): Promise<UseCaseResult<BundlesListData>> {
  const limit = parseCatalogLimit(options.limit, bundleCatalogLimits.defaultLimit);
  if (!limit.ok) return fail([limit.error]);

  const ready = await loadReadyDiscovery(environment);
  if (!ready.ok) return ready.failure;

  const agentIds = parseAgentIds(options.agentIds ?? []);
  if (!agentIds.ok) return fail(agentIds.errors);

  const compatibleBundles = [...ready.discovery.bundles]
    .filter((bundle) =>
      agentIds.value.every((agentId) =>
        deriveBundleAgentCompatibility(bundle, ready.discovery.skills, agentId).compatible
      )
    )
    .sort((left, right) =>
      (left.ref ?? left.id).localeCompare(right.ref ?? right.id)
    );
  const bundles = compatibleBundles
    .slice(0, limit.value)
    .map((bundle) => toBundleCatalogEntry(bundle, ready.discovery.skills, agentIds.value));

  return succeed(
    {
      skillpackCheckoutPaths: ready.checkoutPaths,
      source: ready.discovery.source,
      limit: limit.value,
      totalBundles: compatibleBundles.length,
      bundleCount: bundles.length,
      bundles
    },
    {warnings: discoveryWarnings([...ready.discovery.warnings, ...ready.discovery.errors])}
  );
}

export async function bundlesSearchUseCase(
  environment: ApplicationEnvironment,
  options: BundlesSearchOptions
): Promise<UseCaseResult<BundlesSearchData>> {
  const query = options.query.trim();
  if (query === '') {
    return failWith(createMachineError('INVALID_REQUEST', 'A non-empty query is required.', {field: 'query'}));
  }

  if (query.length > bundleCatalogLimits.maxQueryLength) {
    return failWith(
      createMachineError(
        'INVALID_REQUEST',
        `Query must be at most ${bundleCatalogLimits.maxQueryLength} characters.`,
        {field: 'query'}
      )
    );
  }

  const limit = parseCatalogLimit(options.limit, bundleCatalogLimits.defaultLimit);
  if (!limit.ok) return fail([limit.error]);

  const ready = await loadReadyDiscovery(environment);
  if (!ready.ok) return ready.failure;

  const agentIds = parseAgentIds(options.agentIds ?? []);
  if (!agentIds.ok) return fail(agentIds.errors);

  const allResults = searchBundles({
    bundles: ready.discovery.bundles,
    skills: ready.discovery.skills,
    query,
    agentIds: agentIds.value,
    filterAgentIds: agentIds.value,
    limit: ready.discovery.bundles.length
  });

  return succeed(
    {
      query,
      terms: [...new Set(allResults.flatMap((result) => result.matchedTerms))].sort(),
      limit: limit.value,
      totalMatches: allResults.length,
      results: allResults.slice(0, limit.value)
    },
    {warnings: discoveryWarnings([...ready.discovery.warnings, ...ready.discovery.errors])}
  );
}

export async function bundlesInspectUseCase(
  environment: ApplicationEnvironment,
  options: BundlesInspectOptions
): Promise<UseCaseResult<BundlesInspectData>> {
  if (
    options.bundleIds.length === 0 ||
    options.bundleIds.length > bundleCatalogLimits.maxInspectIds
  ) {
    return failWith(
      createMachineError(
        'INVALID_REQUEST',
        `Between 1 and ${bundleCatalogLimits.maxInspectIds} bundle ids are required.`,
        {field: 'bundleIds'}
      )
    );
  }

  const ready = await loadReadyDiscovery(environment);
  if (!ready.ok) return ready.failure;

  const bundlesById = new Map(
    ready.discovery.bundles.map((bundle) => [bundle.ref ?? bundle.id, bundle])
  );
  const requestedBundleIds = [
    ...new Set(options.bundleIds.map((id) => resolveSkillReference(id)))
  ].sort((left, right) => left.localeCompare(right));
  const missingBundleIds = requestedBundleIds.filter((bundleId) => !bundlesById.has(bundleId));

  if (missingBundleIds.length > 0) {
    return fail(
      missingBundleIds.map((bundleId) =>
        createMachineError(
          'BUNDLE_NOT_FOUND',
          `No bundle named "${bundleId}" in a readable skillpack.`,
          {field: 'bundleIds', details: {bundleId}}
        )
      )
    );
  }

  const agentIds = getAgentAdapters().map((adapter) => adapter.id);
  const bundles: InspectedBundle[] = requestedBundleIds.flatMap((bundleId) => {
    const bundle = bundlesById.get(bundleId);
    if (bundle === undefined) return [];

    return [
      {
        ...toBundleSummary(bundle, ready.discovery.skills),
        compatibility: agentIds.map((agentId) =>
          deriveBundleAgentCompatibility(bundle, ready.discovery.skills, agentId)
        )
      }
    ];
  });

  return succeed(
    {bundles},
    {warnings: discoveryWarnings([...ready.discovery.warnings, ...ready.discovery.errors])}
  );
}

/**
 * Read-only registry validation, suitable for skillpack CI. It reports what is wrong and what
 * is missing; it never writes to the registry or to skill files.
 */
export async function validateRegistryUseCase(
  environment: ApplicationEnvironment
): Promise<UseCaseResult<ValidateRegistryData>> {
  const ready = await loadReadyDiscovery(environment);

  if (!ready.ok) {
    return ready.failure;
  }

  const {discovery} = ready;
  const relationshipCodes = new Set([
    'unknown-required-skill',
    'unknown-conflicting-skill',
    'self-dependency',
    'self-conflict'
  ]);
  const invalidEntries = discovery.errors.filter(
    (error) => !relationshipCodes.has(error.code) && error.code !== 'required-dependency-cycle'
  );
  const unknownRelationshipTargets = [
    ...discovery.errors.filter((error) => relationshipCodes.has(error.code)),
    ...discovery.warnings.filter((warning) => warning.code === 'unknown-recommended-skill')
  ];

  return succeed(
    {
      registryPath: discovery.registryPath,
      source: discovery.source,
      ...(discovery.registryVersion === undefined ? {} : {registryVersion: discovery.registryVersion}),
      supportedRegistryVersions: [...registryVersions],
      currentRegistryVersion,
      skillCount: discovery.registryCounts?.skillCount ?? discovery.skills.length,
      versionedSkillCount: discovery.registryCounts?.versionedSkillCount ?? 0,
      bundleCount: discovery.registryCounts?.bundleCount ?? 0,
      validBundleMembershipCount: discovery.registryCounts?.validBundleMembershipCount ?? 0,
      valid: discovery.errors.length === 0,
      invalidEntries,
      unknownRelationshipTargets,
      requiredDependencyCycles: findRequiredDependencyCycles(discovery.skills),
      skillsMissingSemanticMetadata: discovery.skills
        .filter((skill) => semanticMetadataFields.every((field) => skill[field].length === 0))
        .map((skill) => skill.id)
        .sort((left, right) => left.localeCompare(right)),
      coverage: buildCoverage(discovery.skills)
    },
    {
      warnings: discovery.warnings.map((warning) =>
        createMachineWarning(warning.code, warning.message, {
          ...(warning.path === undefined ? {} : {path: warning.path}),
          ...(warning.skillId === undefined ? {} : {skillId: warning.skillId})
        })
      ),
      nextActions:
        discovery.errors.length === 0
          ? []
          : [
              createNextAction(
                'fix-registry',
                'Fix registry.json in the skillpack repository; the manager never rewrites it.'
              )
            ]
    }
  );
}

/**
 * Read-only maintainer check for Registry v3 release discipline. Both checkout paths are explicit
 * so CI can compare arbitrary revisions without loading or creating manager state.
 */
export async function checkVersionDisciplineUseCase(
  environment: ApplicationEnvironment,
  options: CheckVersionDisciplineOptions
): Promise<UseCaseResult<CheckVersionDisciplineData>> {
  const severity = options.severity ?? 'error';
  if (!versionDisciplineSeverities.includes(severity as VersionDisciplineSeverity)) {
    return failWith(
      createMachineError('INVALID_REQUEST', '--severity must be either "error" or "warning".', {
        field: 'severity'
      })
    );
  }

  if (options.basePath.trim() === '' || options.candidatePath.trim() === '') {
    return failWith(
      createMachineError('INVALID_REQUEST', 'Both --base and --candidate paths are required.', {
        field: options.basePath.trim() === '' ? 'basePath' : 'candidatePath'
      })
    );
  }

  const basePath = resolveUserPath(options.basePath, environment.homeDir);
  const candidatePath = resolveUserPath(options.candidatePath, environment.homeDir);
  const [base, candidate] = await Promise.all([
    discoverSkillsFromCheckout(basePath),
    discoverSkillsFromCheckout(candidatePath)
  ]);
  const invalidInputs = [
    ...versionDisciplineInputErrors('base', base),
    ...versionDisciplineInputErrors('candidate', candidate)
  ];

  if (invalidInputs.length > 0) {
    return fail(invalidInputs, {
      data: {
        basePath,
        candidatePath,
        baseRegistryVersion: base.registryVersion ?? null,
        candidateRegistryVersion: candidate.registryVersion ?? null
      }
    });
  }

  const changedSkillIds = await findChangedSkillContentIds({
    currentSkills: base.skills,
    candidateSkills: candidate.skills
  });
  const comparison = compareSkillpackRevisions({
    currentSkills: base.skills,
    candidateSkills: candidate.skills,
    currentBundles: base.bundles,
    candidateBundles: candidate.bundles,
    changedSkillIds
  });
  const issues = findVersionDisciplineIssues({
    comparison,
    currentSkills: base.skills,
    candidateSkills: candidate.skills,
    currentBundles: base.bundles,
    candidateBundles: candidate.bundles,
    changedSkillIds
  });
  const report: CheckVersionDisciplineData = {
    basePath,
    candidatePath,
    baseRegistryVersion: 3,
    candidateRegistryVersion: 3,
    severity: severity as VersionDisciplineSeverity,
    valid: issues.length === 0,
    skillDeltas: comparison.skillDeltas,
    bundleDeltas: comparison.bundleDeltas,
    issues
  };

  if (issues.length === 0) return succeed(report);

  const nextActions = [
    createNextAction(
      'choose-version-bumps',
      'Review each changed entity and declare maintainer-chosen SemVer bumps; Corvus does not choose them.'
    )
  ];
  if (severity === 'warning') {
    return succeed(report, {
      warnings: issues.map((issue) =>
        createMachineWarning(issue.code, issue.message, {
          ...(issue.entityKind === 'skill' ? {skillId: issue.entityId} : {})
        })
      ),
      nextActions
    });
  }

  return fail(
    issues.map((issue) =>
      createMachineError('VERSION_MISMATCH', issue.message, {
        field: 'version',
        ...(issue.entityKind === 'skill' ? {skillId: issue.entityId} : {}),
        details: {
          issueCode: issue.code,
          entityKind: issue.entityKind,
          entityId: issue.entityId,
          declaredVersion: issue.declaredVersion
        }
      })
    ),
    {data: {...report}, nextActions}
  );
}

function versionDisciplineInputErrors(
  label: 'base' | 'candidate',
  discovery: SkillDiscoveryResult
): MachineError[] {
  if (discovery.registryVersion !== 3) {
    return [
      createMachineError(
        'INVALID_REQUEST',
        `The ${label} path must contain a valid Registry v3 registry.json.`,
        {
          field: `${label}Path`,
          path: discovery.registryPath,
          details: {
            registryVersion: discovery.registryVersion ?? null,
            discoverySource: discovery.source
          }
        }
      )
    ];
  }

  if (discovery.errors.length === 0) return [];
  return [
    createMachineError(
      'INVALID_REQUEST',
      `The ${label} Registry v3 checkout has ${discovery.errors.length} validation error(s).`,
      {
        field: `${label}Path`,
        path: discovery.registryPath,
        details: {
          registryIssues: discovery.errors.map((issue) => ({
            code: issue.code,
            message: issue.message,
            ...(issue.skillId === undefined ? {} : {skillId: issue.skillId}),
            ...(issue.bundleId === undefined ? {} : {bundleId: issue.bundleId})
          }))
        }
      }
    )
  ];
}

function buildCoverage(skills: readonly DiscoveredSkill[]): RegistryFieldCoverage[] {
  const fields: Array<SemanticMetadataField | 'requires' | 'recommends' | 'conflictsWith'> = [
    ...semanticMetadataFields,
    'requires',
    'recommends',
    'conflictsWith'
  ];

  return fields.map((field) => {
    const skillsWithValues = skills.filter((skill) => skill[field].length > 0).length;

    return {
      field,
      skillsWithValues,
      totalSkills: skills.length,
      percent: skills.length === 0 ? 0 : Math.floor((skillsWithValues * 100) / skills.length)
    };
  });
}

type ReadyDiscovery =
  | {
      ok: true;
      discovery: import('../../skills/skillDiscovery.js').SkillDiscoveryResult;
      checkoutPath: string;
      checkoutPaths: string[];
    }
  | {ok: false; failure: UseCaseResult<never>};

async function loadReadyDiscovery(environment: ApplicationEnvironment): Promise<ReadyDiscovery> {
  const context = await loadContext(environment);
  const ready = requireReadySkillpack(context);

  if (isPrecondition(ready)) {
    return {ok: false, failure: fail([ready.error], {nextActions: ready.nextActions})};
  }

  return {
    ok: true,
    discovery: ready.discovery,
    checkoutPath: ready.skillpack.checkoutPath,
    checkoutPaths: context.skillpacks.map((item) => item.config.checkoutPath)
  };
}

function parseAgentIds(
  agentIds: readonly string[]
): {ok: true; value: AgentId[]} | {ok: false; errors: MachineError[]} {
  const errors: MachineError[] = [];
  const parsed: AgentId[] = [];

  for (const agentId of [...new Set(agentIds)].sort((left, right) => left.localeCompare(right))) {
    const adapter = getAgentAdapter(agentId as AgentId);

    if (adapter === undefined) {
      errors.push(
        createMachineError('UNKNOWN_AGENT', `Unknown agent "${agentId}".`, {agentId, field: 'agent'})
      );
      continue;
    }

    parsed.push(adapter.id);
  }

  return errors.length > 0 ? {ok: false, errors} : {ok: true, value: parsed};
}

function parseCatalogLimit(
  input: number | undefined,
  fallback: number
): {ok: true; value: number} | {ok: false; error: MachineError} {
  const value = input ?? fallback;

  if (
    !Number.isInteger(value) ||
    value < bundleCatalogLimits.minLimit ||
    value > bundleCatalogLimits.maxLimit
  ) {
    return {
      ok: false,
      error: createMachineError(
        'INVALID_REQUEST',
        `Limit must be an integer between ${bundleCatalogLimits.minLimit} and ${bundleCatalogLimits.maxLimit}.`,
        {field: 'limit'}
      )
    };
  }

  return {ok: true, value};
}

function discoveryWarnings(errors: readonly SkillDiscoveryIssue[]): MachineWarning[] {
  return errors.map((error) =>
    createMachineWarning(error.code, error.message, {
      ...(error.path === undefined ? {} : {path: error.path}),
      ...(error.skillId === undefined ? {} : {skillId: error.skillId})
    })
  );
}

async function readSkillContent(skill: DiscoveredSkill): Promise<string | undefined> {
  try {
    return await fs.readFile(skill.skillFilePath, 'utf8');
  } catch {
    return undefined;
  }
}
