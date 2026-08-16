import {promises as fs} from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {z} from 'zod';
import {isPathInside, resolveUserPath} from '../paths.js';
import {
  type RegistrySkillEntry,
  normalizeProseList,
  normalizeSkillIdList,
  normalizeTokenList,
  registrySkillEntrySchema,
  semanticMetadataFields
} from '../registry/registrySchema.js';
import {validateSkillRelationships} from './skillRelationships.js';

export type SkillDiscoverySeverity = 'error' | 'warning';

export interface SkillDiscoveryIssue {
  severity: SkillDiscoverySeverity;
  code: string;
  message: string;
  skillId?: string;
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

export type SkillDiscoverySource = 'registry' | 'registryless';

export interface SkillDiscoveryResult {
  skillpackRoot: string;
  registryPath: string;
  /** How skills were found: from `registry.json`, or from `SKILL.md` fallback scanning. */
  source: SkillDiscoverySource;
  /** The version declared by `registry.json`, when one is declared. */
  registryVersion?: number;
  skills: DiscoveredSkill[];
  warnings: SkillRiskWarning[];
  errors: SkillDiscoveryIssue[];
  /** Per-pack provenance when this is an aggregate discovery result. */
  skillpacks?: Array<{
    id: string;
    checkoutPath: string;
    ready: boolean;
    registryPath?: string;
    skillCount: number;
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

const rawRegistrySchema = z
  .object({
    version: z.number().int().positive().optional(),
    skills: z.array(z.unknown())
  })
  .strict();

type RegistryLoadResult =
  | {status: 'loaded'; skills: unknown[]; version?: number}
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

  for (const rawEntry of registry.skills) {
    const entryResult = registrySkillEntrySchema.safeParse(rawEntry);

    if (!entryResult.success) {
      const invalidEntryIssue: SkillDiscoveryIssue = {
        severity: 'error',
        code: 'invalid-skill-entry',
        message: `Invalid skill entry: ${formatZodIssues(entryResult.error)}`
      };
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
    requires: normalizeSkillIdList(entry.requires),
    recommends: normalizeSkillIdList(entry.recommends),
    conflictsWith: normalizeSkillIdList(entry.conflictsWith),
    relativePath: options.relativePath,
    absolutePath: options.absolutePath,
    skillFilePath: options.skillFilePath,
    frontmatter: options.frontmatter,
    riskWarnings: options.riskWarnings
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

  result.errors.push(...relationshipIssues.errors);
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
    ...(registryResult.data.version === undefined ? {} : {version: registryResult.data.version})
  };
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
