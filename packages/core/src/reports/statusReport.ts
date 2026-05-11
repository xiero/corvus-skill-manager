import type {AgentConfig} from '../config/configSchema.js';
import type {StatusReport, StatusReportAgent} from './reportTypes.js';
import {type ReportContext, type ReportOptions, buildReportContext} from './reportInternals.js';

export type BuildStatusReportOptions = ReportOptions;

export async function buildStatusReport(options: BuildStatusReportOptions = {}): Promise<StatusReport> {
  const context = await buildReportContext(options);

  return statusReportFromContext(context);
}

export function statusReportFromContext(context: ReportContext): StatusReport {
  const skillpackConfig = context.config?.skillpack;
  const lockEntry = skillpackConfig === undefined ? undefined : context.lock?.skillpacks[skillpackConfig.id];
  const remoteCommit = context.remoteUpdate?.remoteCommitHash ?? lockEntry?.remoteCommitHash;
  const updateAvailable = context.remoteUpdate?.updateAvailable ?? lockEntry?.updateAvailable;

  return {
    configPath: context.configPath,
    configExists: context.configExists,
    configValid: context.config !== undefined,
    ...(context.configError === undefined ? {} : {configError: context.configError}),
    ...(context.config?.managerStateDir === undefined ? {} : {managerStateDir: context.config.managerStateDir}),
    ...(skillpackConfig === undefined ? {} : {
      skillpack: {
        id: skillpackConfig.id,
        repositoryUrl: skillpackConfig.repositoryUrl,
        branch: skillpackConfig.branch,
        checkoutPath: skillpackConfig.checkoutPath,
        ...(lockEntry?.activeRevisionPath === undefined ? {} : {activeRevisionPath: lockEntry.activeRevisionPath}),
        ...(lockEntry?.commitHash === undefined ? {} : {recordedCommit: lockEntry.commitHash}),
        ...(context.checkout?.commitHash === undefined ? {} : {currentCommit: context.checkout.commitHash}),
        ...(remoteCommit === undefined ? {} : {remoteCommit}),
        ...(updateAvailable === undefined ? {} : {updateAvailable}),
        ...(context.remoteUpdate?.status === undefined ? {} : {updateCheckStatus: context.remoteUpdate.status}),
        ...(context.remoteUpdate?.message === undefined ? {} : {updateMessage: context.remoteUpdate.message}),
        checkoutExists: context.checkout?.exists ?? false,
        checkoutReadable: context.checkout?.readable ?? false,
        ...(context.checkout === undefined ? {} : {dirty: context.checkout.dirty}),
        dirtyFiles: context.checkout?.dirtyFiles ?? [],
        discoveredSkillCount: context.discovery?.skills.length ?? 0,
        discoveryWarningCount: context.discovery?.warnings.length ?? 0,
        discoveryErrorCount: context.discovery?.errors.length ?? 0
      }
    }),
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
