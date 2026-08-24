import {promises as fs} from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {z} from 'zod';
import {isPathInside, resolveUserPath} from '../paths.js';
import {
  type RegistryBundleV3,
  type RegistrySkillEntry,
  type RegistrySkillEntryV3,
  normalizeProseList,
  normalizeRequiredSkillIds,
  normalizeSkillIdList,
  normalizeTokenList,
  registryBundleV3Schema,
  registrySkillEntrySchema,
  registrySkillEntryV2Schema,
  registrySkillEntryV3Schema,
  semanticVersionSchema,
  semanticMetadataFields
} from '../registry/registrySchema.js';
import {
  validateRegistryV3Relationships,
  validateSkillRelationships
} from './skillRelationships.js';

export type SkillDiscoverySeverity = 'error' | 'warning';

export interface SkillDiscoveryIssue {
  severity: SkillDiscoverySeverity;
  code: string;
  message: string;
  skillId?: string;
  bundleId?: string;
  memberId?: string;
  versionRange?: string;
  actualVersion?: string;
  path?: string;
}

export interface SkillRiskWarning extends SkillDiscoveryIssue {
  severity: 'warning';
}

export interface DiscoveredSkill {
  /** Set by aggregate discovery. The local registry id remains in `id`. */
  skillpackId?: string;
  /** Stable `<skillpack-id>:<skill-id>` identity used for selection and persistence. */
  ref?: string;
  id: string;
  /** Exact validated Registry v3 version; absent for v1/v2 and registryless discovery. */
  version?: string;
  title: string;
  description: string;
  supportedAgents: RegistrySkillEntry['supportedAgents'];
  tags: string[];
  /** Registry v2 semantic metadata, normalized to empty arrays when absent. */
  domains: string[];
  tasks: string[];
  languages: string[];
  technologies: string[];
  platforms: string[];
  keywords: string[];
  useCases: string[];
  nonGoals: string[];
  /** Registry v2 relationships, normalized to empty arrays when absent. */
  requires: string[];
  recommends: string[];
  conflictsWith: string[];
  relativePath: string;
  absolutePath: string;
  skillFilePath: string;
  frontmatter: {
    name: string;
    description: string;
  };
  riskWarnings: SkillRiskWarning[];
}

export interface DiscoveredBundleMember {
  /** Local skill ID as authored in the owning Registry v3 snapshot. */
  id: string;
  /** Qualified by aggregate discovery; absent during checkout-local discovery. */
  ref?: string;
  versionRange: string;
  /** Exact version in the snapshot; absent only when registry validation reports a missing target. */
  actualVersion?: string;
}

export interface DiscoveredBundle {
  /** Set by aggregate discovery. The local registry id remains in `id`. */
  skillpackId?: string;
  /** Stable `<skillpack-id>:<bundle-id>` identity used for manager-level selection. */
  ref?: string;
  id: string;
  version: string;
  title: string;
  description: string;
  tags: string[];
  keywords: string[];
  members: DiscoveredBundleMember[];
}

export type SkillDiscoverySource = 'registry' | 'registryless';

export interface SkillDiscoveryResult {
  skillpackRoot: string;
  registryPath: string;
  /** How skills were found: from `registry.json`, or from `SKILL.md` fallback scanning. */
  source: SkillDiscoverySource;
  /** The version declared by `registry.json`, when one is declared. */
  registryVersion?: number;
  /** Registry-level counts used by the read-only maintainer validation report. */
  registryCounts?: {
    skillCount: number;
    versionedSkillCount: number;
    bundleCount: number;
    validBundleMembershipCount: number;
  };
  skills: DiscoveredSkill[];
  /** Registry v3 catalog compositions, kept separate from linkable skills. */
  bundles: DiscoveredBundle[];
  warnings: SkillRiskWarning[];
  errors: SkillDiscoveryIssue[];
  /** Per-pack provenance when this is an aggregate discovery result. */
  skillpacks?: Array<{
    id: string;
    checkoutPath: string;
    ready: boolean;
    registryPath?: string;
    skillCount: number;
    bundleCount: number;
    warningCount: number;
    errorCount: number;
    message?: string;
  }>;
}

const skillFrontmatterSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1)
  })
  .passthrough();

const rawLegacyRegistrySchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]).optional(),
    skills: z.array(z.unknown())
  })
  .strict();

const rawRegistryV3Schema = z
  .object({
    version: z.literal(3),
    skills: z.array(z.unknown()),
    bundles: z.array(z.unknown())
  })
  .strict();

const rawRegistrySchema = z.union([rawLegacyRegistrySchema, rawRegistryV3Schema]);

type RegistryLoadResult =
  | {status: 'loaded'; skills: unknown[]; bundles: unknown[]; version?: number}
  | {status: 'missing'}
  | {status: 'invalid'};

const executableFilePattern = /\.(?:sh|bash|zsh|fish|ps1|bat|cmd|js|mjs|cjs|ts|tsx|py|rb|pl)$/i;
const suspiciousShellPatterns: Array<{code: string; pattern: RegExp; message: string}> = [
  {
    code: 'suspicious-curl-pipe',
    pattern: /\b(?:curl|wget)\b[\s\S]{0,120}\|\s*(?:sh|bash|zsh)\b/i,
    message: 'SKILL.md contains a download piped into a shell.'
  },
  {
    code: 'suspicious-rm-rf',
    pattern: /\brm\s+-[^\n]*r[^\n]*f\b/i,
    message: 'SKILL.md contains an rm -rf style command.'
  },
  {
    code: 'suspicious-sudo',
    pattern: /\bsudo\b/i,
    message: 'SKILL.md mentions sudo.'
  },
  {
    code: 'suspicious-chmod-exec',
    pattern: /\bchmod\s+\+x\b/i,
    message: 'SKILL.md mentions chmod +x.'
  }
];

export async function discoverSkillsFromCheckout(skillpackRoot: string): Promise<SkillDiscoveryResult> {
  const resolvedRoot = resolveUserPath(skillpackRoot);
  const registryPath = path.join(resolvedRoot, 'registry.json');
  const result: SkillDiscoveryResult = {
    skillpackRoot: resolvedRoot,
    registryPath,
    source: 'registry',
    skills: [],
    bundles: [],
    warnings: [],
    errors: []
  };

  const registry = await loadRegistry(registryPath, result.errors);

  if (registry.status === 'missing') {
    result.source = 'registryless';
    result.warnings.push({
      severity: 'warning',
      code: 'missing-registry',
      message: `Missing registry.json at ${registryPath}; discovering SKILL.md files in read-only fallback mode.`,
      path: registryPath
    });
    await discoverSkillsWithoutRegistry(resolvedRoot, result);
    applyRelationshipValidation(result);
    return result;
  }

  if (registry.status === 'invalid') {
    return result;
  }

  if (registry.version !== undefined) {
    result.registryVersion = registry.version;
  }

  const seenSkillIds = new Set<string>();
  const registryV3Skills: RegistrySkillEntryV3[] = [];
  const registryV3Bundles: RegistryBundleV3[] = [];
  result.registryCounts = {
    skillCount: registry.skills.length,
    versionedSkillCount:
      registry.version === 3
        ? registry.skills.filter((entry) =>
            semanticVersionSchema.safeParse(inferObjectString(entry, 'version')).success
          ).length
        : 0,
    bundleCount: registry.bundles.length,
    validBundleMembershipCount: 0
  };

  for (const rawEntry of registry.skills) {
    const entryResult = (registry.version === 3
      ? registrySkillEntryV3Schema
      : registrySkillEntryV2Schema
    ).safeParse(rawEntry);

    if (!entryResult.success) {
      const invalidEntryIssue = invalidSkillEntryIssue(rawEntry, entryResult.error, registry.version);
      const inferredSkillId = inferSkillId(rawEntry);

      if (inferredSkillId !== undefined) {
        invalidEntryIssue.skillId = inferredSkillId;
      }

      result.errors.push(invalidEntryIssue);
      continue;
    }

    const entry = entryResult.data;

    if (seenSkillIds.has(entry.id)) {
      result.errors.push({
        severity: 'error',
        code: 'duplicate-skill-id',
        message: `Duplicate skill id "${entry.id}".`,
        skillId: entry.id
      });
      continue;
    }

    seenSkillIds.add(entry.id);

    if (registry.version === 3) {
      registryV3Skills.push(entry as RegistrySkillEntryV3);
    }

    const resolvedSkillPath = validateSkillPath(resolvedRoot, entry, result.errors);

    if (resolvedSkillPath === undefined) {
      continue;
    }

    const skillFilePath = path.join(resolvedSkillPath, 'SKILL.md');
    const skillFile = await readSkillFile(skillFilePath, entry, result.errors);

    if (skillFile === undefined) {
      continue;
    }

    const parsedFrontmatter = skillFrontmatterSchema.safeParse(skillFile.data);

    if (!parsedFrontmatter.success) {
      result.errors.push({
        severity: 'error',
        code: 'invalid-skill-frontmatter',
        message: `Invalid frontmatter in ${entry.path}/SKILL.md: ${formatZodIssues(parsedFrontmatter.error)}`,
        skillId: entry.id,
        path: skillFilePath
      });
      continue;
    }

    const riskWarnings = await scanSkillRisk({
      skillId: entry.id,
      skillPath: resolvedSkillPath,
      skillFileContent: skillFile.content
    });
    result.warnings.push(...riskWarnings);

    if (registry.version === 1 && entryDeclaresSemanticMetadata(rawEntry)) {
      result.warnings.push({
        severity: 'warning',
        code: 'semantic-metadata-in-v1-registry',
        message: `Skill "${entry.id}" declares registry v2 semantic metadata but registry.json declares version 1; bump the registry version to 2.`,
        skillId: entry.id,
        path: registryPath
      });
    }

    result.skills.push(
      toDiscoveredSkill({
        entry,
        relativePath: entry.path,
        absolutePath: resolvedSkillPath,
        skillFilePath,
        frontmatter: {
          name: parsedFrontmatter.data.name,
          description: parsedFrontmatter.data.description
        },
        riskWarnings
      })
    );
  }

  if (registry.version === 3) {
    for (const rawBundle of registry.bundles) {
      const bundleResult = registryBundleV3Schema.safeParse(rawBundle);

      if (!bundleResult.success) {
        result.errors.push(invalidBundleEntryIssue(rawBundle, bundleResult.error));
        continue;
      }

      registryV3Bundles.push(bundleResult.data);
    }

    const v3Validation = validateRegistryV3Relationships(registryV3Skills, registryV3Bundles);
    result.errors.push(...v3Validation.errors);
    result.registryCounts.validBundleMembershipCount = v3Validation.validBundleMembershipCount;
    result.bundles = registryV3Bundles
      .map((bundle) => toDiscoveredBundle(bundle, registryV3Skills))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  applyRelationshipValidation(result);
  return result;
}

/**
 * Builds the normalized runtime model for one skill. Every optional registry array becomes a
 * normalized, deduplicated array so downstream catalog/search/planning code never has to
 * re-read registry JSON or handle `undefined`.
 */
function toDiscoveredSkill(options: {
  entry: RegistrySkillEntry;
  relativePath: string;
  absolutePath: string;
  skillFilePath: string;
  frontmatter: {name: string; description: string};
  riskWarnings: SkillRiskWarning[];
}): DiscoveredSkill {
  const {entry} = options;

  return {
    id: entry.id,
    ...('version' in entry ? {version: entry.version} : {}),
    title: entry.title,
    description: entry.description,
    supportedAgents: entry.supportedAgents,
    tags: normalizeTokenList(entry.tags),
    domains: normalizeTokenList(entry.domains),
    tasks: normalizeTokenList(entry.tasks),
    languages: normalizeTokenList(entry.languages),
    technologies: normalizeTokenList(entry.technologies),
    platforms: normalizeTokenList(entry.platforms),
    keywords: normalizeTokenList(entry.keywords),
    useCases: normalizeProseList(entry.useCases),
    nonGoals: normalizeProseList(entry.nonGoals),
    requires: normalizeRequiredSkillIds(entry.requires),
    recommends: normalizeSkillIdList(entry.recommends),
    conflictsWith: normalizeSkillIdList(entry.conflictsWith),
    relativePath: options.relativePath,
    absolutePath: options.absolutePath,
    skillFilePath: options.skillFilePath,
    frontmatter: options.frontmatter,
    riskWarnings: options.riskWarnings
  };
}

function toDiscoveredBundle(
  bundle: RegistryBundleV3,
  registrySkills: readonly RegistrySkillEntryV3[]
): DiscoveredBundle {
  const versionsBySkillId = new Map(registrySkills.map((skill) => [skill.id, skill.version]));

  return {
    id: bundle.id,
    version: bundle.version,
    title: bundle.title,
    description: bundle.description,
    tags: normalizeTokenList(bundle.tags),
    keywords: normalizeTokenList(bundle.keywords),
    members: bundle.skills.map((member) => {
      const actualVersion = versionsBySkillId.get(member.id);
      return {
        id: member.id,
        versionRange: member.version,
        ...(actualVersion === undefined ? {} : {actualVersion})
      };
    })
  };
}

function entryDeclaresSemanticMetadata(rawEntry: unknown): boolean {
  if (rawEntry === null || typeof rawEntry !== 'object') {
    return false;
  }

  const keys = Object.keys(rawEntry as Record<string, unknown>);

  return (
    semanticMetadataFields.some((field) => keys.includes(field)) ||
    ['requires', 'recommends', 'conflictsWith'].some((field) => keys.includes(field))
  );
}

function applyRelationshipValidation(result: SkillDiscoveryResult): void {
  const relationshipIssues = validateSkillRelationships(result.skills);

  appendUniqueIssues(result.errors, relationshipIssues.errors);
  result.warnings.push(
    ...relationshipIssues.warnings.map((issue): SkillRiskWarning => ({...issue, severity: 'warning'}))
  );
}

async function loadRegistry(
  registryPath: string,
  errors: SkillDiscoveryIssue[]
): Promise<RegistryLoadResult> {
  let rawRegistry: string;

  try {
    rawRegistry = await fs.readFile(registryPath, 'utf8');
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return {status: 'missing'};
    }

    errors.push({
      severity: 'error',
      code: 'registry-read-failed',
      message: `Failed to read registry.json at ${registryPath}: ${error instanceof Error ? error.message : String(error)}.`,
      path: registryPath
    });
    return {status: 'invalid'};
  }

  let parsedRegistry: unknown;

  try {
    parsedRegistry = JSON.parse(rawRegistry);
  } catch (error) {
    errors.push({
      severity: 'error',
      code: 'invalid-registry-json',
      message: `registry.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
      path: registryPath
    });
    return {status: 'invalid'};
  }

  const registryResult = rawRegistrySchema.safeParse(parsedRegistry);

  if (!registryResult.success) {
    errors.push({
      severity: 'error',
      code: 'invalid-registry',
      message: `registry.json failed validation: ${formatZodIssues(registryResult.error)}.`,
      path: registryPath
    });

    return {status: 'invalid'};
  }

  return {
    status: 'loaded',
    skills: registryResult.data.skills,
    bundles: 'bundles' in registryResult.data ? registryResult.data.bundles : [],
    ...(registryResult.data.version === undefined ? {} : {version: registryResult.data.version})
  };
}

function invalidSkillEntryIssue(
  rawEntry: unknown,
  error: z.ZodError,
  registryVersion: number | undefined
): SkillDiscoveryIssue {
  const versionIssue = error.issues.find((issue) => issue.path.length === 1 && issue.path[0] === 'version');
  const dependencyRangeIssue = error.issues.find(
    (issue) => issue.path[0] === 'requires' && issue.path[2] === 'version'
  );

  if (registryVersion === 3 && versionIssue !== undefined) {
    const missing = !hasDefinedProperty(rawEntry, 'version');
    return {
      severity: 'error',
      code: missing ? 'missing-skill-version' : 'invalid-skill-version',
      message: `Invalid Registry v3 skill version: ${formatZodIssues(error)}`
    };
  }

  if (registryVersion === 3 && dependencyRangeIssue !== undefined) {
    const dependencyIndex = dependencyRangeIssue.path[1];
    const dependency = inferArrayObject(rawEntry, 'requires', dependencyIndex);
    const memberId = inferObjectString(dependency, 'id');
    const versionRange = inferObjectString(dependency, 'version');
    return {
      severity: 'error',
      code: 'invalid-required-skill-version-range',
      message: `Invalid Registry v3 hard dependency: ${formatZodIssues(error)}`,
      ...(memberId === undefined ? {} : {memberId}),
      ...(versionRange === undefined ? {} : {versionRange})
    };
  }

  return {
    severity: 'error',
    code: 'invalid-skill-entry',
    message: `Invalid skill entry: ${formatZodIssues(error)}`
  };
}

function invalidBundleEntryIssue(rawBundle: unknown, error: z.ZodError): SkillDiscoveryIssue {
  const inferredBundleId = inferObjectString(rawBundle, 'id');
  const versionIssue = error.issues.find((issue) => issue.path.length === 1 && issue.path[0] === 'version');
  const duplicateMemberIssue = error.issues.find((issue) => issue.message.startsWith('Duplicate bundle member'));
  const memberRangeIssue = error.issues.find(
    (issue) => issue.path[0] === 'skills' && issue.path[2] === 'version'
  );
  const qualifiedMemberIssue = error.issues.find((issue) => {
    if (issue.path[0] !== 'skills' || issue.path[2] !== 'id') return false;
    const memberIndex = issue.path[1];
    const skills = rawBundle !== null && typeof rawBundle === 'object'
      ? (rawBundle as {skills?: unknown}).skills
      : undefined;
    const member = Array.isArray(skills) && typeof memberIndex === 'number' ? skills[memberIndex] : undefined;
    return inferObjectString(member, 'id')?.includes(':') === true;
  });

  let code = 'invalid-bundle-entry';
  let memberIssue: z.ZodIssue | undefined;

  if (versionIssue !== undefined) {
    code = hasDefinedProperty(rawBundle, 'version') ? 'invalid-bundle-version' : 'missing-bundle-version';
  } else if (duplicateMemberIssue !== undefined) {
    code = 'duplicate-bundle-member';
    memberIssue = duplicateMemberIssue;
  } else if (qualifiedMemberIssue !== undefined) {
    code = 'qualified-bundle-member';
    memberIssue = qualifiedMemberIssue;
  } else if (memberRangeIssue !== undefined) {
    code = 'invalid-bundle-member-version-range';
    memberIssue = memberRangeIssue;
  }

  const member = inferArrayObject(rawBundle, 'skills', memberIssue?.path[1]);
  const memberId = inferObjectString(member, 'id');
  const versionRange = inferObjectString(member, 'version');

  return {
    severity: 'error',
    code,
    message: `Invalid Registry v3 bundle: ${formatZodIssues(error)}`,
    ...(inferredBundleId === undefined ? {} : {bundleId: inferredBundleId}),
    ...(memberId === undefined ? {} : {memberId}),
    ...(versionRange === undefined ? {} : {versionRange})
  };
}

function appendUniqueIssues(target: SkillDiscoveryIssue[], additions: readonly SkillDiscoveryIssue[]): void {
  const seen = new Set(target.map(issueIdentity));

  for (const issue of additions) {
    const identity = issueIdentity(issue);
    if (seen.has(identity)) continue;
    seen.add(identity);
    target.push(issue);
  }
}

function issueIdentity(issue: SkillDiscoveryIssue): string {
  return [issue.code, issue.skillId ?? '', issue.bundleId ?? '', issue.memberId ?? ''].join('\u0000');
}

function hasDefinedProperty(value: unknown, key: string): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    key in value &&
    (value as Record<string, unknown>)[key] !== undefined
  );
}

function inferObjectString(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : undefined;
}

function inferArrayObject(value: unknown, key: string, index: unknown): unknown {
  if (value === null || typeof value !== 'object' || typeof index !== 'number') return undefined;
  const collection = (value as Record<string, unknown>)[key];
  return Array.isArray(collection) ? collection[index] : undefined;
}

async function discoverSkillsWithoutRegistry(
  skillpackRoot: string,
  result: SkillDiscoveryResult
): Promise<void> {
  const skillFilePaths = await findSkillFiles(skillpackRoot);
  const seenSkillIds = new Set<string>();

  if (skillFilePaths.length === 0) {
    result.errors.push({
      severity: 'error',
      code: 'no-skill-files',
      message: `No SKILL.md files were found under ${skillpackRoot}.`,
      path: skillpackRoot
    });
    return;
  }

  for (const skillFilePath of skillFilePaths) {
    const skillPath = path.dirname(skillFilePath);
    const relativePath = path.relative(skillpackRoot, skillPath);
    const parsedSkillFile = await readSkillFileByPath(skillFilePath, result.errors);

    if (parsedSkillFile === undefined) {
      continue;
    }

    const parsedFrontmatter = skillFrontmatterSchema.safeParse(parsedSkillFile.data);

    if (!parsedFrontmatter.success) {
      result.errors.push({
        severity: 'error',
        code: 'invalid-skill-frontmatter',
        message: `Invalid frontmatter in ${relativePath}/SKILL.md: ${formatZodIssues(parsedFrontmatter.error)}`,
        path: skillFilePath
      });
      continue;
    }

    const entryResult = registrySkillEntrySchema.safeParse({
      id: parsedFrontmatter.data.name,
      path: relativePath,
      title: parsedFrontmatter.data.name,
      description: parsedFrontmatter.data.description,
      supportedAgents: ['codex'],
      tags: ['registryless']
    });

    if (!entryResult.success) {
      result.errors.push({
        severity: 'error',
        code: 'invalid-discovered-skill',
        message: `Discovered SKILL.md at ${skillFilePath} cannot be represented as a skill: ${formatZodIssues(entryResult.error)}`,
        path: skillFilePath
      });
      continue;
    }

    const entry = entryResult.data;

    if (seenSkillIds.has(entry.id)) {
      result.errors.push({
        severity: 'error',
        code: 'duplicate-skill-id',
        message: `Duplicate skill id "${entry.id}" discovered from SKILL.md frontmatter.`,
        skillId: entry.id,
        path: skillFilePath
      });
      continue;
    }

    seenSkillIds.add(entry.id);
    const riskWarnings = await scanSkillRisk({
      skillId: entry.id,
      skillPath,
      skillFileContent: parsedSkillFile.content
    });

    result.warnings.push(...riskWarnings);
    result.skills.push(
      toDiscoveredSkill({
        entry,
        relativePath: entry.path,
        absolutePath: skillPath,
        skillFilePath,
        frontmatter: {
          name: parsedFrontmatter.data.name,
          description: parsedFrontmatter.data.description
        },
        riskWarnings
      })
    );
  }
}

function validateSkillPath(
  skillpackRoot: string,
  entry: RegistrySkillEntry,
  errors: SkillDiscoveryIssue[]
): string | undefined {
  if (path.isAbsolute(entry.path) || path.win32.isAbsolute(entry.path)) {
    errors.push({
      severity: 'error',
      code: 'absolute-skill-path',
      message: `Skill "${entry.id}" uses an absolute path, which is not allowed.`,
      skillId: entry.id,
      path: entry.path
    });
    return undefined;
  }

  const pathSegments = entry.path.split(/[\\/]+/);

  if (pathSegments.includes('..')) {
    errors.push({
      severity: 'error',
      code: 'skill-path-traversal',
      message: `Skill "${entry.id}" path escapes the skillpack root.`,
      skillId: entry.id,
      path: entry.path
    });
    return undefined;
  }

  const normalizedRelativePath = path.normalize(entry.path);
  const resolvedSkillPath = path.resolve(skillpackRoot, normalizedRelativePath);

  if (!isPathInside(skillpackRoot, resolvedSkillPath)) {
    errors.push({
      severity: 'error',
      code: 'skill-path-outside-root',
      message: `Skill "${entry.id}" resolves outside the skillpack root.`,
      skillId: entry.id,
      path: entry.path
    });
    return undefined;
  }

  return resolvedSkillPath;
}

async function readSkillFile(
  skillFilePath: string,
  entry: RegistrySkillEntry,
  errors: SkillDiscoveryIssue[]
): Promise<{content: string; data: unknown} | undefined> {
  const parsed = await readSkillFileByPath(skillFilePath, errors);

  if (parsed === undefined) {
    errors.push({
      severity: 'error',
      code: 'missing-skill-file',
      message: `Skill "${entry.id}" is missing SKILL.md at ${skillFilePath}.`,
      skillId: entry.id,
      path: skillFilePath
    });
  }

  return parsed;
}

async function readSkillFileByPath(
  skillFilePath: string,
  errors: SkillDiscoveryIssue[]
): Promise<{content: string; data: unknown} | undefined> {
  let content: string;

  try {
    content = await fs.readFile(skillFilePath, 'utf8');
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      )
    ) {
      errors.push({
        severity: 'error',
        code: 'skill-file-read-failed',
        message: `Failed to read SKILL.md at ${skillFilePath}: ${error instanceof Error ? error.message : String(error)}.`,
        path: skillFilePath
      });
    }

    return undefined;
  }

  const parsed = matter(content);

  return {
    content,
    data: parsed.data
  };
}

async function scanSkillRisk(options: {
  skillId: string;
  skillPath: string;
  skillFileContent: string;
}): Promise<SkillRiskWarning[]> {
  const warnings: SkillRiskWarning[] = [];
  const scriptsPath = path.join(options.skillPath, 'scripts');

  if (await directoryExists(scriptsPath)) {
    warnings.push({
      severity: 'warning',
      code: 'scripts-directory',
      message: 'Skill contains a scripts/ directory.',
      skillId: options.skillId,
      path: scriptsPath
    });
  }

  for (const filePath of await listFiles(options.skillPath)) {
    const relativePath = path.relative(options.skillPath, filePath);
    const stat = await fs.stat(filePath);

    if ((stat.mode & 0o111) !== 0 || executableFilePattern.test(relativePath)) {
      warnings.push({
        severity: 'warning',
        code: 'executable-looking-file',
        message: `Skill contains executable-looking file: ${relativePath}.`,
        skillId: options.skillId,
        path: filePath
      });
    }
  }

  for (const suspiciousPattern of suspiciousShellPatterns) {
    if (suspiciousPattern.pattern.test(options.skillFileContent)) {
      warnings.push({
        severity: 'warning',
        code: suspiciousPattern.code,
        message: suspiciousPattern.message,
        skillId: options.skillId,
        path: path.join(options.skillPath, 'SKILL.md')
      });
    }
  }

  return warnings;
}

async function listFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(currentPath: string): Promise<void> {
    const entries = (await fs.readdir(currentPath, {withFileTypes: true})).sort((left, right) =>
      left.name.localeCompare(right.name)
    );

    for (const entry of entries) {
      const childPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await visit(childPath);
        continue;
      }

      if (entry.isFile()) {
        files.push(childPath);
      }
    }
  }

  await visit(rootPath);
  return files;
}

async function findSkillFiles(rootPath: string): Promise<string[]> {
  const skillFilePaths: string[] = [];

  async function visit(currentPath: string): Promise<void> {
    const entries = (await fs.readdir(currentPath, {withFileTypes: true})).sort((left, right) =>
      left.name.localeCompare(right.name)
    );

    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }

      const childPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await visit(childPath);
        continue;
      }

      if (entry.isFile() && entry.name === 'SKILL.md') {
        skillFilePaths.push(childPath);
      }
    }
  }

  await visit(rootPath);
  return skillFilePaths;
}

async function directoryExists(candidatePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidatePath);
    return stat.isDirectory();
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return false;
    }

    throw error;
  }
}

function inferSkillId(rawEntry: unknown): string | undefined {
  if (rawEntry !== null && typeof rawEntry === 'object' && 'id' in rawEntry) {
    const id = (rawEntry as {id?: unknown}).id;
    return typeof id === 'string' ? id : undefined;
  }

  return undefined;
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const issuePath = issue.path.length === 0 ? '<root>' : issue.path.join('.');
      return `${issuePath}: ${issue.message}`;
    })
    .join('; ');
}
