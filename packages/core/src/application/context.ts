import type {ManagerConfig, SkillpackConfig} from '../config/configSchema.js';
import {type ReportContext, buildReportContext} from '../reports/reportInternals.js';
import type {SkillDiscoveryResult} from '../skills/skillDiscovery.js';
import type {ApplicationEnvironment} from './ports.js';
import {type MachineError, createMachineError} from './protocol/errors.js';
import {type NextAction, createNextAction} from './protocol/nextActions.js';

export interface LoadContextOptions {
  /** Perform the read-only `git ls-remote` update check. Off by default: it needs network. */
  checkRemote?: boolean;
}

/**
 * Loads the shared read-only view of local state (config, lock, manifest, checkout, discovery,
 * target states). This never creates a default config, so read-only commands stay read-only.
 */
export async function loadContext(
  environment: ApplicationEnvironment,
  options: LoadContextOptions = {}
): Promise<ReportContext> {
  return buildReportContext({
    homeDir: environment.homeDir,
    managerStateDir: environment.managerStateDir,
    configPath: environment.configPath,
    git: environment.git,
    ...(options.checkRemote === undefined ? {} : {checkRemote: options.checkRemote})
  });
}

export interface ReadyConfig {
  config: ManagerConfig;
  skillpack: SkillpackConfig;
  discovery: SkillDiscoveryResult;
}

/** Structured reason a context cannot satisfy a command's preconditions. */
export interface ContextPrecondition {
  error: MachineError;
  nextActions: NextAction[];
}

export function requireConfig(context: ReportContext): ManagerConfig | ContextPrecondition {
  if (!context.configExists) {
    return {
      error: createMachineError('CONFIG_NOT_FOUND', `Manager config is missing at ${context.configPath}.`, {
        path: context.configPath
      }),
      nextActions: [
        createNextAction(
          'run-skillpack-setup-plan',
          'Create manager state by planning and applying skillpack setup.',
          'corvus-skills skillpack setup-plan --json'
        )
      ]
    };
  }

  if (context.config === undefined) {
    return {
      error: createMachineError(
        'CONFIG_INVALID',
        `Manager config is invalid: ${context.configError ?? 'unknown validation error'}.`,
        {path: context.configPath}
      ),
      nextActions: [
        createNextAction('inspect-config', 'Fix config.json so it matches the manager config schema.'),
        createNextAction('run-doctor', 'Inspect the full diagnosis.', 'corvus-skills doctor --json')
      ]
    };
  }

  return context.config;
}

/**
 * Requires a configured skillpack whose active snapshot is readable and whose skills have been
 * discovered. Every write-capable install workflow starts here.
 */
export function requireReadySkillpack(context: ReportContext): ReadyConfig | ContextPrecondition {
  const config = requireConfig(context);

  if (isPrecondition(config)) {
    return config;
  }

  if (config.skillpack === undefined) {
    return {
      error: createMachineError('SKILLPACK_NOT_CONFIGURED', 'No skillpack is configured.'),
      nextActions: [
        createNextAction(
          'run-skillpack-setup-plan',
          'Plan the default skillpack setup.',
          'corvus-skills skillpack setup-plan --json'
        )
      ]
    };
  }

  if (context.checkout === undefined || !context.checkout.exists) {
    return {
      error: createMachineError(
        'SKILLPACK_NOT_READY',
        `Active skillpack snapshot is missing at ${config.skillpack.checkoutPath}.`,
        {path: config.skillpack.checkoutPath}
      ),
      nextActions: [
        createNextAction(
          'run-skillpack-setup-plan',
          'Plan the initial skillpack revision snapshot.',
          'corvus-skills skillpack setup-plan --json'
        )
      ]
    };
  }

  if (!context.checkout.readable) {
    return {
      error: createMachineError(
        'SKILLPACK_NOT_READY',
        `Active skillpack snapshot is not readable: ${context.checkout.message}.`,
        {path: context.checkout.checkoutPath}
      ),
      nextActions: [
        createNextAction('run-doctor', 'Inspect the active snapshot.', 'corvus-skills doctor --json')
      ]
    };
  }

  if (context.discovery === undefined) {
    return {
      error: createMachineError(
        'SKILLPACK_NOT_READY',
        'Skill discovery did not run for the active skillpack snapshot.',
        {path: context.checkout.checkoutPath}
      ),
      nextActions: [
        createNextAction('run-doctor', 'Inspect the active snapshot.', 'corvus-skills doctor --json')
      ]
    };
  }

  return {config, skillpack: config.skillpack, discovery: context.discovery};
}

export function isPrecondition(value: unknown): value is ContextPrecondition {
  return (
    value !== null &&
    typeof value === 'object' &&
    'error' in value &&
    'nextActions' in value &&
    typeof (value as {error?: unknown}).error === 'object'
  );
}
