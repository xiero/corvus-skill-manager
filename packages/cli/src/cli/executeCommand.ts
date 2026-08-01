import {
  type CorvusApplication,
  type CorvusApplicationOptions,
  type MachineCommand,
  type MachineEnvelope,
  createCorvusApplication,
  createFailureEnvelope,
  createMachineError,
  installRequestFromFlags,
  toMachineEnvelope
} from '@corvus-tools/skill-manager-core';
import {readManagerPackageRuntime} from '../managerPackageRuntime.js';
import type {CliIo} from './output.js';
import {readRequestDocument} from './requestInput.js';

export interface ExecutorOptions {
  io: CliIo;
  entryUrl?: string;
  applicationOptions?: CorvusApplicationOptions;
}

export interface CommonOptions {
  json: boolean;
  debug: boolean;
}

export interface SkillpackSetupPlanFlags {
  skillpackId?: string;
  repository?: string;
  branch?: string;
  checkoutPath?: string;
}

export interface PlanRefFlags {
  planId: string;
  confirm: string;
}

export interface InstallPlanFlags {
  agent?: string[];
  skill?: string[];
  reason?: string[];
  targetPath?: string[];
  allCompatible?: boolean;
  replaceSelection?: boolean;
  intent?: string;
  selectionPolicy?: string;
  request?: string;
}

export interface Executor {
  readonly app: CorvusApplication;
  capabilities(): MachineEnvelope;
  status(options: {checkRemote?: boolean}): Promise<MachineEnvelope>;
  doctor(options: {checkRemote?: boolean}): Promise<MachineEnvelope>;
  agentsList(): Promise<MachineEnvelope>;
  skillpackStatus(options: {checkRemote?: boolean}): Promise<MachineEnvelope>;
  skillpackSetupPlan(flags: SkillpackSetupPlanFlags): Promise<MachineEnvelope>;
  skillpackSetupApply(flags: PlanRefFlags): Promise<MachineEnvelope>;
  skillpackUpdateCheck(): Promise<MachineEnvelope>;
  skillpackUpdatePreview(): Promise<MachineEnvelope>;
  skillpackUpdateApply(flags: PlanRefFlags): Promise<MachineEnvelope>;
  skillsList(flags: {agent?: string[]}): Promise<MachineEnvelope>;
  skillsSearch(flags: {query: string; agent?: string[]; limit?: string}): Promise<MachineEnvelope>;
  skillsInspect(skillIds: string[], flags: {includeContent?: boolean}): Promise<MachineEnvelope>;
  skillsValidateRegistry(): Promise<MachineEnvelope>;
  installPlan(flags: InstallPlanFlags): Promise<MachineEnvelope>;
  installApply(flags: PlanRefFlags & {replaceBrokenLinks?: boolean}): Promise<MachineEnvelope>;
  installVerify(flags: {planId: string}): Promise<MachineEnvelope>;
}

/**
 * Binds parsed CLI input to application use cases and serializes the result.
 *
 * This layer owns transport concerns only: flag shapes, request-document reading, and envelope
 * serialization. No workflow logic lives here.
 */
export function createExecutor(options: ExecutorOptions): Executor {
  const managerPackage =
    options.applicationOptions?.managerPackage ?? readManagerPackageInfo(options.entryUrl);
  const app = createCorvusApplication({
    ...options.applicationOptions,
    ...(managerPackage === undefined ? {} : {managerPackage})
  });

  return {
    app,
    capabilities: () => toMachineEnvelope('capabilities', app.capabilities()),
    status: async (flags) => toMachineEnvelope('status', await app.status(checkRemote(flags))),
    doctor: async (flags) => toMachineEnvelope('doctor', await app.doctor(checkRemote(flags))),
    agentsList: async () => toMachineEnvelope('agents.list', await app.listAgents()),
    skillpackStatus: async (flags) =>
      toMachineEnvelope('skillpack.status', await app.skillpackStatus(checkRemote(flags))),
    skillpackSetupPlan: async (flags) =>
      toMachineEnvelope(
        'skillpack.setup-plan',
        await app.skillpackSetupPlan({
          ...(flags.skillpackId === undefined ? {} : {skillpackId: flags.skillpackId}),
          ...(flags.repository === undefined ? {} : {repositoryUrl: flags.repository}),
          ...(flags.branch === undefined ? {} : {branch: flags.branch}),
          ...(flags.checkoutPath === undefined ? {} : {checkoutPath: flags.checkoutPath})
        })
      ),
    skillpackSetupApply: async (flags) =>
      toMachineEnvelope(
        'skillpack.setup-apply',
        await app.skillpackSetupApply({planId: flags.planId, confirm: flags.confirm})
      ),
    skillpackUpdateCheck: async () =>
      toMachineEnvelope('skillpack.update-check', await app.skillpackUpdateCheck()),
    skillpackUpdatePreview: async () =>
      toMachineEnvelope('skillpack.update-preview', await app.skillpackUpdatePreview()),
    skillpackUpdateApply: async (flags) =>
      toMachineEnvelope(
        'skillpack.update-apply',
        await app.skillpackUpdateApply({planId: flags.planId, confirm: flags.confirm})
      ),
    skillsList: async (flags) =>
      toMachineEnvelope(
        'skills.list',
        await app.listSkills(flags.agent === undefined ? {} : {agentIds: flags.agent})
      ),
    skillsSearch: async (flags) => {
      const limit = flags.limit === undefined ? undefined : Number(flags.limit);

      if (limit !== undefined && !Number.isFinite(limit)) {
        return invalidRequest('skills.search', '--limit must be a number.', 'limit');
      }

      return toMachineEnvelope(
        'skills.search',
        await app.searchSkills({
          query: flags.query,
          ...(flags.agent === undefined ? {} : {agentIds: flags.agent}),
          ...(limit === undefined ? {} : {limit})
        })
      );
    },
    skillsInspect: async (skillIds, flags) =>
      toMachineEnvelope(
        'skills.inspect',
        await app.inspectSkills({
          skillIds,
          ...(flags.includeContent === undefined ? {} : {includeContent: flags.includeContent})
        })
      ),
    skillsValidateRegistry: async () =>
      toMachineEnvelope('skills.validate-registry', await app.validateRegistry()),
    installPlan: async (flags) => {
      const request = await buildInstallRequest(flags, options.io);

      if (!request.ok) {
        return invalidRequest('install.plan', request.message, 'request');
      }

      return toMachineEnvelope('install.plan', await app.installPlan(request.value));
    },
    installApply: async (flags) =>
      toMachineEnvelope(
        'install.apply',
        await app.installApply({
          planId: flags.planId,
          confirm: flags.confirm,
          ...(flags.replaceBrokenLinks === undefined
            ? {}
            : {confirmReplaceBrokenManagedLinks: flags.replaceBrokenLinks})
        })
      ),
    installVerify: async (flags) =>
      toMachineEnvelope('install.verify', await app.installVerify({planId: flags.planId}))
  };
}

async function buildInstallRequest(
  flags: InstallPlanFlags,
  io: CliIo
): Promise<{ok: true; value: unknown} | {ok: false; message: string}> {
  if (flags.request !== undefined) {
    return readRequestDocument(flags.request, io);
  }

  const agents = flags.agent ?? [];

  if (agents.length === 0) {
    return {ok: false, message: 'At least one --agent is required, or pass --request.'};
  }

  const skills = flags.skill ?? [];

  if (skills.length === 0 && flags.allCompatible !== true) {
    return {
      ok: false,
      message:
        'Provide at least one --skill, or --all-compatible. A deliberately empty selection must be supplied through --request.'
    };
  }

  const reasons = parseKeyValueFlags(flags.reason ?? []);

  if (!reasons.ok) {
    return {ok: false, message: `--reason ${reasons.message}`};
  }

  const targetPaths = parseKeyValueFlags(flags.targetPath ?? []);

  if (!targetPaths.ok) {
    return {ok: false, message: `--target-path ${targetPaths.message}`};
  }

  return {
    ok: true,
    value: installRequestFromFlags({
      agents,
      skills,
      reasons: reasons.value,
      ...(flags.allCompatible === undefined ? {} : {allCompatible: flags.allCompatible}),
      ...(flags.replaceSelection === undefined ? {} : {replaceSelection: flags.replaceSelection}),
      ...(flags.intent === undefined ? {} : {intent: flags.intent}),
      ...(flags.selectionPolicy === undefined ? {} : {selectionPolicy: flags.selectionPolicy}),
      ...(Object.keys(targetPaths.value).length === 0 ? {} : {agentTargetPaths: targetPaths.value})
    })
  };
}

function parseKeyValueFlags(
  values: string[]
): {ok: true; value: Record<string, string>} | {ok: false; message: string} {
  const parsed: Record<string, string> = {};

  for (const value of values) {
    const separatorIndex = value.indexOf('=');

    if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
      return {ok: false, message: `expects <key>=<value>, received "${value}".`};
    }

    parsed[value.slice(0, separatorIndex)] = value.slice(separatorIndex + 1);
  }

  return {ok: true, value: parsed};
}

function invalidRequest(command: MachineCommand, message: string, field: string): MachineEnvelope {
  return createFailureEnvelope({
    command,
    errors: [createMachineError('INVALID_REQUEST', message, {field})]
  });
}

function checkRemote(flags: {checkRemote?: boolean}): {checkRemote?: boolean} {
  return flags.checkRemote === undefined ? {} : {checkRemote: flags.checkRemote};
}

function readManagerPackageInfo(entryUrl: string | undefined) {
  if (entryUrl === undefined) {
    return undefined;
  }

  try {
    const runtime = readManagerPackageRuntime(entryUrl);

    return {
      packageName: runtime.packageName,
      version: runtime.currentVersion,
      installKind: runtime.installKind
    };
  } catch {
    return undefined;
  }
}
