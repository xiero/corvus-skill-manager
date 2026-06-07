import path from 'node:path';
import type {AgentId} from '../agents/AgentAdapter.js';
import type {DoctorIssue, DoctorReport, StatusReport} from './reportTypes.js';
import {
  type ReportContext,
  type ReportOptions,
  buildReportContext,
  inspectLinkTarget,
  pathExists
} from './reportInternals.js';
import {statusReportFromContext} from './statusReport.js';

export type BuildDoctorReportOptions = ReportOptions;

export async function buildDoctorReport(options: BuildDoctorReportOptions = {}): Promise<DoctorReport> {
  const context = await buildReportContext(options);
  const status = await statusFromContext(context);
  const issues: DoctorIssue[] = [];

  collectConfigIssues(context, issues);
  collectSkillpackIssues(context, issues);
  collectDiscoveryIssues(context, issues);
  collectAgentIssues(context, issues);
  collectPlanIssues(context, issues);
  await collectManifestIssues(context, issues);

  issues.sort(compareDoctorIssues);

  return {
    configPath: context.configPath,
    healthy: issues.filter((issue) => issue.severity === 'error').length === 0,
    issues,
    status
  };
}

async function statusFromContext(context: ReportContext): Promise<StatusReport> {
  return statusReportFromContext(context);
}

function collectConfigIssues(context: ReportContext, issues: DoctorIssue[]): void {
  if (!context.configExists) {
    issues.push({
      severity: 'error',
      code: 'missing-config',
      message: `Manager config is missing at ${context.configPath}.`,
      action: 'Start the TUI once to create the default manager config, or restore config.json.',
      path: context.configPath
    });
    return;
  }

  if (context.config === undefined) {
    issues.push({
      severity: 'error',
      code: 'invalid-config',
      message: `Manager config is invalid: ${context.configError ?? 'unknown validation error'}.`,
      action: 'Fix config.json so it matches the manager config schema.',
      path: context.configPath
    });
  }

  if (!context.manifestValid) {
    issues.push({
      severity: 'error',
      code: 'invalid-manifest',
      message: `Managed link manifest is invalid: ${context.manifestError ?? 'unknown validation error'}.`,
      action: 'Inspect manifest.json before applying further link changes.',
      path: context.manifestPath
    });
  }
}

function collectSkillpackIssues(context: ReportContext, issues: DoctorIssue[]): void {
  if (context.config === undefined) {
    return;
  }

  if (context.config.skillpack === undefined) {
    issues.push({
      severity: 'error',
      code: 'skillpack-not-configured',
      message: 'No skillpack is configured.',
      action: 'Use Setup Skillpack to configure the source and active snapshot path.'
    });
    return;
  }

  if (context.checkout === undefined || !context.checkout.exists) {
    issues.push({
      severity: 'error',
      code: 'missing-skillpack-checkout',
      message: `Skillpack checkout is missing at ${context.config.skillpack.checkoutPath}.`,
      action: 'Run Setup Skillpack and confirm the initial clone if the checkout is absent.',
      path: context.config.skillpack.checkoutPath
    });
    return;
  }

  if (!context.checkout.readable) {
    issues.push({
      severity: 'error',
      code: 'unreadable-skillpack-checkout',
      message: `Skillpack checkout is not readable: ${context.checkout.message}.`,
      action: 'Check that the active path resolves to a git worktree and is readable.',
      path: context.checkout.checkoutPath
    });
  }

  if (context.checkout.dirty) {
    issues.push({
      severity: 'warning',
      code: 'dirty-checkout',
      message: `Skillpack checkout has local changes (${context.checkout.dirtyFiles.length} item(s)).`,
      action: 'Review the checkout manually. The manager will not pull, reset, or repair it.',
      path: context.checkout.checkoutPath
    });
  }
}

function collectDiscoveryIssues(context: ReportContext, issues: DoctorIssue[]): void {
  if (context.discovery === undefined) {
    return;
  }

  for (const warning of context.discovery.warnings) {
    if (warning.code === 'missing-registry') {
      issues.push({
        severity: 'warning',
        code: 'missing-registry',
        message: warning.message,
        action: 'Add registry.json in the skillpack repository if registry-backed discovery is required.',
        ...(warning.path === undefined ? {} : {path: warning.path})
      });
    }
  }

  for (const error of context.discovery.errors) {
    const mappedIssue = mapDiscoveryError(error);
    issues.push(mappedIssue);
  }
}

function collectAgentIssues(context: ReportContext, issues: DoctorIssue[]): void {
  for (const adapter of context.adapters) {
    const agentConfig = context.config?.agents?.[adapter.id];

    if (agentConfig?.enabled !== true) {
      continue;
    }

    if (adapter.supportStatus === 'deferred' || adapter.supportStatus === 'unavailable') {
      issues.push({
        severity: 'warning',
        code: 'unsupported-agent-enabled',
        message: `${adapter.displayName} is ${adapter.supportStatus} in this MVP.`,
        action: 'Disable this agent before applying.',
        agentId: adapter.id
      });
    }
  }
}

function collectPlanIssues(context: ReportContext, issues: DoctorIssue[]): void {
  for (const conflict of context.plan?.conflicts ?? []) {
    if (conflict.code !== 'unmanaged-target-exists') {
      continue;
    }

    issues.push({
      severity: 'error',
      code: 'unmanaged-conflict-at-planned-target',
      message: conflict.message,
      action: 'Choose a different target path or manually move the unmanaged file/directory before applying.',
      ...(conflict.path === undefined ? {} : {path: conflict.path}),
      ...(conflict.agentId === undefined ? {} : {agentId: conflict.agentId}),
      ...(conflict.skillId === undefined ? {} : {skillId: conflict.skillId})
    });
  }

  for (const warning of context.plan?.warnings ?? []) {
    if (warning.code !== 'agent-not-supported') {
      continue;
    }

    issues.push({
      severity: 'warning',
      code: 'unsupported-agent-enabled',
      message: warning.message,
      action: 'Disable unsupported or deferred agents before applying.',
      ...(warning.agentId === undefined ? {} : {agentId: warning.agentId})
    });
  }
}

async function collectManifestIssues(context: ReportContext, issues: DoctorIssue[]): Promise<void> {
  const skillpackCheckoutPath = context.config?.skillpack?.checkoutPath;

  for (const [manifestKey, entry] of Object.entries(context.manifest.links)) {
    if (manifestKey !== entry.targetPath) {
      issues.push({
        severity: 'error',
        code: 'manifest-entry-with-wrong-target',
        message: `Manifest key ${manifestKey} does not match recorded target ${entry.targetPath}.`,
        action: 'Inspect manifest.json; do not apply until the ownership record is understood.',
        path: manifestKey,
        agentId: entry.agentId,
        skillId: entry.skillId
      });
    }

    if (skillpackCheckoutPath !== undefined && !isPathInside(skillpackCheckoutPath, entry.sourcePath)) {
      issues.push({
        severity: 'error',
        code: 'source-outside-skillpack',
        message: `Managed source is outside the configured active skillpack snapshot: ${entry.sourcePath}.`,
        action: 'Inspect manifest.json before applying; manager-owned links must point inside the active snapshot.',
        path: entry.sourcePath,
        agentId: entry.agentId,
        skillId: entry.skillId
      });
    }

    if (!(await pathExists(entry.sourcePath))) {
      issues.push({
        severity: 'error',
        code: 'missing-source-skill-path',
        message: `Managed source skill path is missing: ${entry.sourcePath}.`,
        action: 'Re-run discovery/setup and review the active snapshot; Doctor will not repair links.',
        path: entry.sourcePath,
        agentId: entry.agentId,
        skillId: entry.skillId
      });
    }

    const linkTarget = await inspectLinkTarget(entry.targetPath);

    if (linkTarget.kind === 'missing') {
      issues.push({
        severity: 'warning',
        code: 'missing-managed-link',
        message: `Manifest owns a link that is missing on disk: ${entry.targetPath}.`,
        action: 'Preview an apply plan to recreate or remove the manager-owned entry.',
        path: entry.targetPath,
        agentId: entry.agentId,
        skillId: entry.skillId
      });
      continue;
    }

    if (linkTarget.kind === 'not-link') {
      issues.push({
        severity: 'error',
        code: 'manifest-entry-with-wrong-target',
        message: `Manifest target is not a symlink/junction: ${entry.targetPath}.`,
        action: 'Move the unmanaged target manually before applying manager changes.',
        path: entry.targetPath,
        agentId: entry.agentId,
        skillId: entry.skillId
      });
      continue;
    }

    if (linkTarget.broken) {
      issues.push({
        severity: 'error',
        code: 'broken-managed-link',
        message: `Managed link is broken: ${entry.targetPath}.`,
        action: 'Use the apply preview to replace a broken manager-owned link only after confirmation.',
        path: entry.targetPath,
        agentId: entry.agentId,
        skillId: entry.skillId
      });
    }

    if (linkTarget.resolvedSourcePath !== entry.sourcePath) {
      issues.push({
        severity: 'error',
        code: 'manifest-entry-with-wrong-target',
        message: `Managed link target differs from manifest source: ${entry.targetPath}.`,
        action: 'Inspect the link manually; the manager will refuse to remove or overwrite mismatched links.',
        path: entry.targetPath,
        agentId: entry.agentId,
        skillId: entry.skillId
      });
    }
  }
}

function mapDiscoveryError(error: {
  code: string;
  message: string;
  path?: string;
  skillId?: string;
}): DoctorIssue {
  if (error.code === 'invalid-registry' || error.code === 'invalid-registry-json') {
    return {
      severity: 'error',
      code: 'invalid-registry',
      message: error.message,
      action: 'Fix registry.json in the skillpack repository; the manager will not rewrite it.',
      ...(error.path === undefined ? {} : {path: error.path}),
      ...(error.skillId === undefined ? {} : {skillId: error.skillId})
    };
  }

  if (error.code === 'missing-skill-file') {
    return {
      severity: 'error',
      code: 'missing-skill-md',
      message: error.message,
      action: 'Restore the referenced SKILL.md in the skillpack repository.',
      ...(error.path === undefined ? {} : {path: error.path}),
      ...(error.skillId === undefined ? {} : {skillId: error.skillId})
    };
  }

  return {
    severity: 'error',
    code: error.code,
    message: error.message,
    action: 'Inspect the active skillpack snapshot manually; Doctor is read-only.',
    ...(error.path === undefined ? {} : {path: error.path}),
    ...(error.skillId === undefined ? {} : {skillId: error.skillId})
  };
}

function compareDoctorIssues(left: DoctorIssue, right: DoctorIssue): number {
  return (
    severityRank(left.severity) - severityRank(right.severity) ||
    left.code.localeCompare(right.code) ||
    (left.agentId ?? '').localeCompare(right.agentId ?? '') ||
    (left.skillId ?? '').localeCompare(right.skillId ?? '') ||
    (left.path ?? '').localeCompare(right.path ?? '')
  );
}

function severityRank(severity: DoctorIssue['severity']): number {
  if (severity === 'error') {
    return 0;
  }

  if (severity === 'warning') {
    return 1;
  }

  return 2;
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}
