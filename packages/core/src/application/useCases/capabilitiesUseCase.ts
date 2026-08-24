import {getAgentAdapters} from '../../agents/adapters.js';
import {currentRegistryVersion, registryVersions} from '../../registry/registrySchema.js';
import {
  defaultSkillpackBranch,
  defaultSkillpackId,
  defaultSkillpackRepositoryUrl
} from '../../skillpackDefaults.js';
import {defaultSkillpackCheckoutPath} from '../../paths.js';
import {installRequestSchemaVersion, selectionPolicies} from '../install/installRequest.js';
import {planSchemaVersion} from '../plans/planSchema.js';
import type {ApplicationEnvironment} from '../ports.js';
import {type MachineCommand, machineCommands, machineProtocolVersion} from '../protocol/envelope.js';
import {exitCodeCategoryDescriptions} from '../protocol/exitCodes.js';
import {machineErrorCodes} from '../protocol/errors.js';
import {createNextAction} from '../protocol/nextActions.js';
import {type UseCaseResult, succeed} from '../protocol/result.js';
import {searchLimits} from '../skills/skillCatalog.js';

export type CommandMode = 'read-only' | 'write';

export interface CommandOptionCapability {
  flag: string;
  description: string;
  required: boolean;
  repeatable: boolean;
}

export interface CommandCapability {
  command: MachineCommand;
  /** Exactly how the command is invoked, e.g. `install plan`. */
  cli: string;
  summary: string;
  mode: CommandMode;
  requiresConfirmation: boolean;
  /** Identifier of the schema describing this command's input, if it takes a document. */
  inputSchema?: string;
  options: CommandOptionCapability[];
}

export interface AgentCapability {
  id: string;
  displayName: string;
  supportStatus: string;
  defaultTargetPath?: string;
  notes: string[];
}

export interface CapabilitiesData {
  manager: {packageName: string; version: string; installKind: string};
  protocol: {
    schemaVersion: number;
    installRequestSchemaVersion: number;
    planSchemaVersion: number;
    errorCodes: string[];
    exitCodes: typeof exitCodeCategoryDescriptions;
  };
  registry: {supportedVersions: number[]; currentVersion: number};
  commands: CommandCapability[];
  agents: AgentCapability[];
  requestFormats: string[];
  selectionPolicies: string[];
  confirmation: {
    model: string;
    description: string;
    writeCommands: string[];
  };
  limits: {searchLimit: {min: number; max: number; default: number}};
  paths: {
    homeDir: string;
    managerStateDir: string;
    configPath: string;
    lockPath: string;
    manifestPath: string;
    plansDir: string;
    defaultSkillpackCheckoutPath: string;
  };
  defaultSkillpack: {id: string; repositoryUrl: string; branch: string};
}

const planIdOption: CommandOptionCapability = {
  flag: '--plan-id <id>',
  description: 'Identifier of the persisted plan to act on.',
  required: true,
  repeatable: false
};

const confirmOption: CommandOptionCapability = {
  flag: '--confirm <id>',
  description: 'Must repeat the exact plan id. Confirmation is never implied by --json.',
  required: true,
  repeatable: false
};

/**
 * The single source of truth for the public command surface. `capabilities` advertises this
 * list, and a test asserts the CLI parser registers exactly these commands, so the two cannot
 * drift apart.
 */
export const commandCapabilities: readonly CommandCapability[] = [
  {
    command: 'capabilities',
    cli: 'capabilities',
    summary: 'Describe this binary: protocol version, commands, agents, paths, and exit codes.',
    mode: 'read-only',
    requiresConfirmation: false,
    options: []
  },
  {
    command: 'status',
    cli: 'status',
    summary: 'Report config, skillpack, agent, and managed-link state.',
    mode: 'read-only',
    requiresConfirmation: false,
    options: [
      {flag: '--check-remote', description: 'Also run the read-only remote update check.', required: false, repeatable: false}
    ]
  },
  {
    command: 'doctor',
    cli: 'doctor',
    summary: 'Report health issues with stable codes and suggested actions. Never repairs.',
    mode: 'read-only',
    requiresConfirmation: false,
    options: [
      {flag: '--check-remote', description: 'Also run the read-only remote update check.', required: false, repeatable: false}
    ]
  },
  {
    command: 'agents.list',
    cli: 'agents list',
    summary: 'List agent adapters with support status, target paths, and current selections.',
    mode: 'read-only',
    requiresConfirmation: false,
    options: []
  },
  {
    command: 'skillpack.status',
    cli: 'skillpack status',
    summary: 'Report configured skillpacks and their active snapshots.',
    mode: 'read-only',
    requiresConfirmation: false,
    options: [
      {flag: '--check-remote', description: 'Also run the read-only remote update check.', required: false, repeatable: false},
      {flag: '--skillpack-id <id>', description: 'Restrict output to one skillpack.', required: false, repeatable: false}
    ]
  },
  {
    command: 'skillpack.setup-plan',
    cli: 'skillpack setup-plan',
    summary: 'Plan the initial skillpack setup, reporting repository, branch, and paths before any clone.',
    mode: 'write',
    requiresConfirmation: true,
    options: [
      {flag: '--skillpack-id <id>', description: 'Override the skillpack id.', required: false, repeatable: false},
      {flag: '--repository <url>', description: 'Override the repository URL.', required: false, repeatable: false},
      {flag: '--branch <name>', description: 'Override the branch.', required: false, repeatable: false},
      {flag: '--checkout-path <path>', description: 'Override the active snapshot path.', required: false, repeatable: false}
    ]
  },
  {
    command: 'skillpack.setup-apply',
    cli: 'skillpack setup-apply',
    summary: 'Apply a reviewed setup plan. Clones only when the active snapshot is absent.',
    mode: 'write',
    requiresConfirmation: true,
    options: [planIdOption, confirmOption]
  },
  {
    command: 'skillpack.update-check',
    cli: 'skillpack update-check',
    summary: 'Read-only remote comparison using git ls-remote.',
    mode: 'read-only',
    requiresConfirmation: false,
    options: [{flag: '--skillpack-id <id>', description: 'Skillpack to check.', required: false, repeatable: false}]
  },
  {
    command: 'skillpack.update-preview',
    cli: 'skillpack update-preview',
    summary: 'Create an inactive revision snapshot and an activation plan. The current link is untouched.',
    mode: 'write',
    requiresConfirmation: true,
    options: [{flag: '--skillpack-id <id>', description: 'Skillpack to preview.', required: false, repeatable: false}]
  },
  {
    command: 'skillpack.update-apply',
    cli: 'skillpack update-apply',
    summary: 'Activate a previewed revision by repointing the manager-owned current link.',
    mode: 'write',
    requiresConfirmation: true,
    options: [planIdOption, confirmOption]
  },
  {
    command: 'skillpack.remove-plan',
    cli: 'skillpack remove-plan',
    summary: 'Plan config-only removal of an unused secondary skillpack; snapshots are preserved.',
    mode: 'write',
    requiresConfirmation: true,
    options: [{flag: '--skillpack-id <id>', description: 'Secondary skillpack to remove.', required: true, repeatable: false}]
  },
  {
    command: 'skillpack.remove-apply',
    cli: 'skillpack remove-apply',
    summary: 'Apply a reviewed secondary skillpack removal plan.',
    mode: 'write',
    requiresConfirmation: true,
    options: [planIdOption, confirmOption]
  },
  {
    command: 'skills.list',
    cli: 'skills list',
    summary: 'List discovered skills with normalized semantic metadata.',
    mode: 'read-only',
    requiresConfirmation: false,
    options: [
      {flag: '--agent <id>', description: 'Filter to skills supporting this agent.', required: false, repeatable: true}
    ]
  },
  {
    command: 'skills.search',
    cli: 'skills search',
    summary: 'Rank skills for a query using deterministic local lexical scoring. No LLM, no network.',
    mode: 'read-only',
    requiresConfirmation: false,
    options: [
      {flag: '--query <text>', description: 'Search terms.', required: true, repeatable: false},
      {flag: '--agent <id>', description: 'Filter to skills supporting this agent.', required: false, repeatable: true},
      {
        flag: '--limit <n>',
        description: `Maximum results, ${searchLimits.minLimit}-${searchLimits.maxLimit}.`,
        required: false,
        repeatable: false
      }
    ]
  },
  {
    command: 'skills.inspect',
    cli: 'skills inspect',
    summary: 'Return full normalized metadata for explicitly named skills.',
    mode: 'read-only',
    requiresConfirmation: false,
    options: [
      {flag: '<skill-id...>', description: 'One or more exact skill ids.', required: true, repeatable: true},
      {
        flag: '--include-content',
        description: 'Also return SKILL.md content for the named skills.',
        required: false,
        repeatable: false
      }
    ]
  },
  {
    command: 'skills.validate-registry',
    cli: 'skills validate-registry',
    summary: 'Validate configured skillpack registries and report coverage. Read-only, CI friendly.',
    mode: 'read-only',
    requiresConfirmation: false,
    options: []
  },
  {
    command: 'install.plan',
    cli: 'install plan',
    summary: 'Produce a persisted, digest-identified installation plan from an exact selection.',
    mode: 'write',
    requiresConfirmation: true,
    inputSchema: 'corvus.install-request.v2',
    options: [
      {flag: '--agent <id>', description: 'Target agent id.', required: true, repeatable: true},
      {flag: '--skill <id>', description: 'Exact skill id to install.', required: false, repeatable: true},
      {flag: '--reason <skill-id=text>', description: 'Provenance for a selected skill.', required: false, repeatable: true},
      {flag: '--all-compatible', description: 'Select every skill compatible with each target agent.', required: false, repeatable: false},
      {flag: '--replace-selection', description: 'Replace the targeted agents’ selections instead of adding.', required: false, repeatable: false},
      {flag: '--intent <text>', description: 'The user’s original natural-language intent, kept as provenance.', required: false, repeatable: false},
      {flag: '--selection-policy <policy>', description: `One of ${selectionPolicies.join(', ')}.`, required: false, repeatable: false},
      {flag: '--target-path <agent-id=path>', description: 'Explicit target directory for an agent.', required: false, repeatable: true},
      {flag: '--request <path|->', description: 'Read a JSON request document from a file, or - for stdin.', required: false, repeatable: false}
    ]
  },
  {
    command: 'install.apply',
    cli: 'install apply',
    summary: 'Apply exactly the persisted plan after revalidating digest, confirmation, and state.',
    mode: 'write',
    requiresConfirmation: true,
    options: [
      planIdOption,
      confirmOption,
      {
        flag: '--replace-broken-links',
        description: 'Explicitly allow replacing broken manager-owned links.',
        required: false,
        repeatable: false
      }
    ]
  },
  {
    command: 'install.verify',
    cli: 'install verify',
    summary: 'Prove a plan reached the filesystem and config it described. Strictly read-only.',
    mode: 'read-only',
    requiresConfirmation: false,
    options: [planIdOption]
  }
] as const;

/**
 * Describes the binary without touching skillpack state, so an agent can call it on a fresh
 * machine before anything is configured. The output is deterministic and contains no
 * timestamps.
 */
export function capabilitiesUseCase(
  environment: ApplicationEnvironment
): UseCaseResult<CapabilitiesData> {
  const agents = getAgentAdapters().map(
    (adapter): AgentCapability => ({
      id: adapter.id,
      displayName: adapter.displayName,
      supportStatus: adapter.supportStatus,
      ...(adapter.defaultTargetPath === undefined ? {} : {defaultTargetPath: adapter.defaultTargetPath}),
      notes: [...(adapter.notes ?? [])]
    })
  );

  return succeed(
    {
      manager: {
        packageName: environment.managerPackage.packageName,
        version: environment.managerPackage.version,
        installKind: environment.managerPackage.installKind
      },
      protocol: {
        schemaVersion: machineProtocolVersion,
        installRequestSchemaVersion,
        planSchemaVersion,
        errorCodes: [...machineErrorCodes],
        exitCodes: exitCodeCategoryDescriptions
      },
      registry: {supportedVersions: [...registryVersions], currentVersion: currentRegistryVersion},
      commands: [...commandCapabilities],
      agents,
      requestFormats: ['cli-flags', 'json-request-file', 'json-request-stdin'],
      selectionPolicies: [...selectionPolicies],
      confirmation: {
        model: 'plan-then-apply',
        description:
          'Every write is two-phase: a plan command persists a digest-identified plan, and the apply command must repeat that plan id as --confirm. --json is never implicit authorization.',
        writeCommands: commandCapabilities
          .filter((command) => command.mode === 'write')
          .map((command) => command.cli)
      },
      limits: {
        searchLimit: {
          min: searchLimits.minLimit,
          max: searchLimits.maxLimit,
          default: searchLimits.defaultLimit
        }
      },
      paths: {
        homeDir: environment.homeDir,
        managerStateDir: environment.managerStateDir,
        configPath: environment.configPath,
        lockPath: environment.lockPath,
        manifestPath: environment.manifestPath,
        plansDir: environment.plansDir,
        defaultSkillpackCheckoutPath: defaultSkillpackCheckoutPath(defaultSkillpackId, environment.homeDir)
      },
      defaultSkillpack: {
        id: defaultSkillpackId,
        repositoryUrl: defaultSkillpackRepositoryUrl,
        branch: defaultSkillpackBranch
      }
    },
    {
      nextActions: [
        createNextAction('run-status', 'Inspect current local state.', 'corvus-skills status --json'),
        createNextAction(
          'run-skillpack-setup-plan',
          'If no skillpack is ready, plan its setup.',
          'corvus-skills skillpack setup-plan --json'
        ),
        createNextAction(
          'search-skills',
          'Translate the user intent into search terms, then choose exact skill IDs.',
          'corvus-skills skills search --query "<terms>" --json'
        ),
        createNextAction(
          'plan-install',
          'Plan an installation for the exact skill IDs.',
          'corvus-skills install plan --agent <id> --skill <id> --json'
        )
      ]
    }
  );
}

export function machineCommandList(): readonly MachineCommand[] {
  return machineCommands;
}
