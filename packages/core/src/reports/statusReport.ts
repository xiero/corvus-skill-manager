import type {AgentConfig} from '../config/configSchema.js';
import type {StatusReport, StatusReportAgent} from './reportTypes.js';
import {type ReportContext, type ReportOptions, buildReportContext} from './reportInternals.js';

export type BuildStatusReportOptions = ReportOptions;

export async function buildStatusReport(options: BuildStatusReportOptions = {}): Promise<StatusReport> {
  const context = await buildReportContext(options);

  return statusReportFromContext(context);
}

export function statusReportFromContext(context: ReportContext): StatusReport {
  const skillpacks = context.skillpacks.map((item) => statusSkillpack(item, context));
  const primary = skillpacks.find((item) => item.id === 'corvus-skillpack') ?? skillpacks[0];

  return {
    configPath: context.configPath,
    configExists: context.configExists,
    configValid: context.config !== undefined,
    ...(context.configError === undefined ? {} : {configError: context.configError}),
    ...(context.config?.managerStateDir === undefined ? {} : {managerStateDir: context.config.managerStateDir}),
    ...(primary === undefined ? {} : {skillpack: primary}),
    skillpacks,
    agents: context.adapters.map((adapter): StatusReportAgent => {
      const agentConfig: AgentConfig | undefined = context.config?.agents?.[adapter.id];

      return {
        id: adapter.id,
        displayName: adapter.displayName,
        supportStatus: adapter.supportStatus,
        enabled: agentConfig?.enabled ?? false,
        ...(agentConfig?.targetPath === undefined ? {} : {targetPath: agentConfig.targetPath}),
        selectedSkillIds: agentConfig?.selectedSkillIds ?? []
      };
    }),
    managedLinkCount: Object.keys(context.manifest.links).length,
    manifestPath: context.manifestPath,
    manifestValid: context.manifestValid,
    ...(context.manifestError === undefined ? {} : {manifestError: context.manifestError})
  };
}

function statusSkillpack(
  item: ReportContext['skillpacks'][number],
  context: ReportContext
): import('./reportTypes.js').StatusReportSkillpack {
  const lockEntry = context.lock?.skillpacks[item.config.id];
  const remoteCommit = item.remoteUpdate?.remoteCommitHash ?? lockEntry?.remoteCommitHash;
  const updateAvailable = item.remoteUpdate?.updateAvailable ?? lockEntry?.updateAvailable;

  return {
    id: item.config.id,
    repositoryUrl: item.config.repositoryUrl,
    branch: item.config.branch,
    checkoutPath: item.config.checkoutPath,
    ...(lockEntry?.activeRevisionPath === undefined ? {} : {activeRevisionPath: lockEntry.activeRevisionPath}),
    ...(lockEntry?.commitHash === undefined ? {} : {recordedCommit: lockEntry.commitHash}),
    ...(item.checkout.commitHash === undefined ? {} : {currentCommit: item.checkout.commitHash}),
    ...(remoteCommit === undefined ? {} : {remoteCommit}),
    ...(updateAvailable === undefined ? {} : {updateAvailable}),
    ...(item.remoteUpdate?.status === undefined ? {} : {updateCheckStatus: item.remoteUpdate.status}),
    ...(item.remoteUpdate?.message === undefined ? {} : {updateMessage: item.remoteUpdate.message}),
    checkoutExists: item.checkout.exists,
    checkoutReadable: item.checkout.readable,
    dirty: item.checkout.dirty,
    dirtyFiles: item.checkout.dirtyFiles,
    discoveredSkillCount: item.discovery?.skills.length ?? 0,
    discoveryWarningCount: item.discovery?.warnings.length ?? 0,
    discoveryErrorCount: item.discovery?.errors.length ?? 0
  };
}
