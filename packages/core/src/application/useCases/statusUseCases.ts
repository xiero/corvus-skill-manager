import type {AgentAdapter, AgentId, AgentSupportStatus} from '../../agents/AgentAdapter.js';
import type {DoctorIssue, DoctorReport, StatusReport} from '../../reports/reportTypes.js';
import {buildDoctorReport} from '../../reports/doctorReport.js';
import {statusReportFromContext} from '../../reports/statusReport.js';
import type {ReportContext} from '../../reports/reportInternals.js';
import {loadContext} from '../context.js';
import type {ApplicationEnvironment} from '../ports.js';
import {type MachineWarning, createMachineWarning} from '../protocol/errors.js';
import {type NextAction, createNextAction, dedupeNextActions} from '../protocol/nextActions.js';
import {type UseCaseResult, succeed} from '../protocol/result.js';

export interface StatusData {
  report: StatusReport;
}

export interface DoctorData {
  report: DoctorReport;
}

export interface AgentListEntry {
  id: AgentId;
  displayName: string;
  supportStatus: AgentSupportStatus;
  defaultTargetPath?: string;
  configuredTargetPath?: string;
  /** Configured path when set, otherwise the adapter default. Absent when neither exists. */
  effectiveTargetPath?: string;
  enabled: boolean;
  selectedSkillIds: string[];
  notes: string[];
  warnings: string[];
}

export interface AgentListData {
  agents: AgentListEntry[];
}

export interface SkillpackStatusData {
  configured: boolean;
  skillpack?: StatusReport['skillpack'];
  configPath: string;
  configExists: boolean;
  configValid: boolean;
}

export interface StatusUseCaseOptions {
  checkRemote?: boolean;
}

export async function statusUseCase(
  environment: ApplicationEnvironment,
  options: StatusUseCaseOptions = {}
): Promise<UseCaseResult<StatusData>> {
  const context = await loadContext(environment, contextOptions(options));
  const report = statusReportFromContext(context);

  return succeed(
    {report},
    {
      warnings: warningsFromContext(context),
      nextActions: nextActionsFromStatus(report)
    }
  );
}

export async function doctorUseCase(
  environment: ApplicationEnvironment,
  options: StatusUseCaseOptions = {}
): Promise<UseCaseResult<DoctorData>> {
  const report = await buildDoctorReport({
    homeDir: environment.homeDir,
    managerStateDir: environment.managerStateDir,
    configPath: environment.configPath,
    git: environment.git,
    ...(options.checkRemote === undefined ? {} : {checkRemote: options.checkRemote})
  });

  return succeed(
    {report},
    {
      warnings: report.issues
        .filter((issue) => issue.severity === 'warning')
        .map((issue) => warningFromDoctorIssue(issue)),
      nextActions: nextActionsFromDoctor(report)
    }
  );
}

export async function agentsListUseCase(
  environment: ApplicationEnvironment
): Promise<UseCaseResult<AgentListData>> {
  const context = await loadContext(environment);
  const agents = context.adapters.map((adapter) => toAgentListEntry(adapter, context));

  return succeed(
    {agents},
    {
      warnings: warningsFromContext(context),
      nextActions: agents.some((agent) => agent.enabled)
        ? []
        : [
            createNextAction(
              'enable-agent',
              'Enable at least one agent by planning an install for it.',
              'corvus-skills install plan --agent codex --skill <skill-id> --json'
            )
          ]
    }
  );
}

export async function skillpackStatusUseCase(
  environment: ApplicationEnvironment,
  options: StatusUseCaseOptions = {}
): Promise<UseCaseResult<SkillpackStatusData>> {
  const context = await loadContext(environment, contextOptions(options));
  const report = statusReportFromContext(context);

  return succeed(
    {
      configured: report.skillpack !== undefined,
      ...(report.skillpack === undefined ? {} : {skillpack: report.skillpack}),
      configPath: report.configPath,
      configExists: report.configExists,
      configValid: report.configValid
    },
    {
      warnings: warningsFromContext(context),
      nextActions: nextActionsFromStatus(report)
    }
  );
}

function contextOptions(options: StatusUseCaseOptions): {checkRemote?: boolean} {
  return options.checkRemote === undefined ? {} : {checkRemote: options.checkRemote};
}

function toAgentListEntry(adapter: AgentAdapter, context: ReportContext): AgentListEntry {
  const agentConfig = context.config?.agents?.[adapter.id];
  const configuredTargetPath = agentConfig?.targetPath;
  const effectiveTargetPath = configuredTargetPath ?? adapter.defaultTargetPath;

  return {
    id: adapter.id,
    displayName: adapter.displayName,
    supportStatus: adapter.supportStatus,
    ...(adapter.defaultTargetPath === undefined ? {} : {defaultTargetPath: adapter.defaultTargetPath}),
    ...(configuredTargetPath === undefined ? {} : {configuredTargetPath}),
    ...(effectiveTargetPath === undefined ? {} : {effectiveTargetPath}),
    enabled: agentConfig?.enabled ?? false,
    selectedSkillIds: [...(agentConfig?.selectedSkillIds ?? [])].sort((left, right) => left.localeCompare(right)),
    notes: [...(adapter.notes ?? [])],
    warnings: [...(adapter.warnings ?? [])]
  };
}

/** Config/manifest/discovery problems reported as warnings so read-only commands still succeed. */
function warningsFromContext(context: ReportContext): MachineWarning[] {
  const warnings: MachineWarning[] = [];

  if (!context.configExists) {
    warnings.push(
      createMachineWarning('config-not-found', `Manager config is missing at ${context.configPath}.`, {
        path: context.configPath
      })
    );
  } else if (context.config === undefined) {
    warnings.push(
      createMachineWarning(
        'config-invalid',
        `Manager config is invalid: ${context.configError ?? 'unknown validation error'}.`,
        {path: context.configPath}
      )
    );
  }

  if (!context.manifestValid) {
    warnings.push(
      createMachineWarning(
        'manifest-invalid',
        `Managed link manifest is invalid: ${context.manifestError ?? 'unknown validation error'}.`,
        {path: context.manifestPath}
      )
    );
  }

  for (const discoveryWarning of context.discovery?.warnings ?? []) {
    warnings.push(
      createMachineWarning(discoveryWarning.code, discoveryWarning.message, {
        ...(discoveryWarning.path === undefined ? {} : {path: discoveryWarning.path}),
        ...(discoveryWarning.skillId === undefined ? {} : {skillId: discoveryWarning.skillId})
      })
    );
  }

  return warnings;
}

function warningFromDoctorIssue(issue: DoctorIssue): MachineWarning {
  return createMachineWarning(issue.code, issue.message, {
    ...(issue.path === undefined ? {} : {path: issue.path}),
    ...(issue.agentId === undefined ? {} : {agentId: issue.agentId}),
    ...(issue.skillId === undefined ? {} : {skillId: issue.skillId})
  });
}

/**
 * Guides a calling agent along the intended order: make state exist, make the skillpack ready,
 * then discover and plan.
 */
export function nextActionsFromStatus(report: StatusReport): NextAction[] {
  const actions: NextAction[] = [];

  if (!report.configExists || !report.configValid || report.skillpack === undefined) {
    actions.push(
      createNextAction(
        'run-skillpack-setup-plan',
        'Plan skillpack setup before discovering or installing skills.',
        'corvus-skills skillpack setup-plan --json'
      )
    );

    return dedupeNextActions(actions);
  }

  if (!report.skillpack.checkoutExists || !report.skillpack.checkoutReadable) {
    actions.push(
      createNextAction(
        'run-skillpack-setup-plan',
        'The active skillpack snapshot is missing or unreadable; plan setup.',
        'corvus-skills skillpack setup-plan --json'
      )
    );

    return dedupeNextActions(actions);
  }

  actions.push(
    createNextAction('list-skills', 'List the discovered skill catalog.', 'corvus-skills skills list --json')
  );

  if (report.skillpack.updateAvailable === true) {
    actions.push(
      createNextAction(
        'preview-skillpack-update',
        'A newer skillpack revision is available; preview it before activating.',
        'corvus-skills skillpack update-preview --json'
      )
    );
  }

  if (report.skillpack.discoveryErrorCount > 0) {
    actions.push(
      createNextAction('run-doctor', 'Discovery reported errors.', 'corvus-skills doctor --json')
    );
  }

  return dedupeNextActions(actions);
}

function nextActionsFromDoctor(report: DoctorReport): NextAction[] {
  const actions = nextActionsFromStatus(report.status);

  if (!report.healthy) {
    actions.unshift(
      createNextAction(
        'resolve-doctor-errors',
        'Resolve the reported errors manually; Doctor never repairs anything itself.'
      )
    );
  }

  return dedupeNextActions(actions);
}
