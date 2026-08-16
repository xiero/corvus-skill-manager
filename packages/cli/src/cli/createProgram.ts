import {Command, CommanderError} from 'commander';
import type {MachineEnvelope} from '@corvus-tools/skill-manager-core';
import type {Executor} from './executeCommand.js';
import type {CliIo} from './output.js';

export interface ProgramResult {
  /** Set when a machine command was selected; awaited by the caller. */
  run?: () => Promise<MachineEnvelope>;
  json: boolean;
  debug: boolean;
}

export const aiQuickStartLine = 'For coding agents: corvus-skills capabilities --json';

/**
 * Builds the argument parser. Parsing never performs work: each action records a thunk, which
 * the caller awaits. That keeps async execution out of Commander's synchronous action handling.
 */
export function createProgram(options: {
  executor: Executor;
  io: CliIo;
  version: string;
}): {program: Command; result: ProgramResult} {
  const result: ProgramResult = {json: false, debug: false};
  const program = new Command();

  program
    .name('corvus-skills')
    .description(
      [
        'Corvus Skill Manager — wire local skillpacks into supported coding agents.',
        '',
        aiQuickStartLine,
        '',
        'Run with no arguments to open the interactive TUI.'
      ].join('\n')
    )
    .version(version(options.version), '-v, --version', 'Print the manager version.')
    .helpOption('-h, --help', 'Show help.')
    .configureOutput({
      writeOut: (chunk) => options.io.writeOut(chunk),
      writeErr: (chunk) => options.io.writeErr(chunk),
      outputError: (chunk) => options.io.writeErr(chunk)
    })
    .showSuggestionAfterError(false)
    .exitOverride();

  const register = (command: Command, run: (opts: Record<string, unknown>) => Promise<MachineEnvelope> | MachineEnvelope) => {
    command
      .option('--json', 'Emit exactly one machine-readable JSON document on stdout.')
      .option('--debug', 'Write diagnostics to stderr. Never contaminates stdout.')
      .exitOverride()
      .configureOutput({
        writeOut: (chunk) => options.io.writeOut(chunk),
        writeErr: (chunk) => options.io.writeErr(chunk),
        outputError: (chunk) => options.io.writeErr(chunk)
      })
      .action((...actionArguments: unknown[]) => {
        const commandOptions = (command.opts() as Record<string, unknown>) ?? {};

        result.json = commandOptions.json === true;
        result.debug = commandOptions.debug === true;
        result.run = async () => run({...commandOptions, __args: actionArguments});
      });

    return command;
  };

  register(program.command('capabilities').description('Describe this binary for a coding agent.'), () =>
    options.executor.capabilities()
  );

  register(
    program
      .command('status')
      .description('Report config, skillpack, agent, and managed-link state.')
      .option('--check-remote', 'Also run the read-only remote update check.'),
    async (opts) => options.executor.status({checkRemote: opts.checkRemote === true})
  );

  register(
    program
      .command('doctor')
      .description('Report health issues with stable codes. Never repairs anything.')
      .option('--check-remote', 'Also run the read-only remote update check.'),
    async (opts) => options.executor.doctor({checkRemote: opts.checkRemote === true})
  );

  const agents = program.command('agents').description('Agent adapter commands.');
  register(agents.command('list').description('List agent adapters and their current selections.'), async () =>
    options.executor.agentsList()
  );

  const skillpack = program.command('skillpack').description('Skillpack snapshot commands.');

  register(
    skillpack
      .command('status')
      .description('Report the configured skillpack and its active snapshot.')
      .option('--check-remote', 'Also run the read-only remote update check.')
      .option('--skillpack-id <id>', 'Restrict output to one skillpack.'),
    async (opts) => options.executor.skillpackStatus({
      checkRemote: opts.checkRemote === true,
      ...(typeof opts.skillpackId === 'string' ? {skillpackId: opts.skillpackId} : {})
    })
  );

  register(
    skillpack
      .command('setup-plan')
      .description('Plan the initial skillpack setup before any clone happens.')
      .option('--skillpack-id <id>', 'Override the skillpack id.')
      .option('--repository <url>', 'Override the repository URL.')
      .option('--branch <name>', 'Override the branch.')
      .option('--checkout-path <path>', 'Override the active snapshot path.'),
    async (opts) =>
      options.executor.skillpackSetupPlan({
        ...(typeof opts.skillpackId === 'string' ? {skillpackId: opts.skillpackId} : {}),
        ...(typeof opts.repository === 'string' ? {repository: opts.repository} : {}),
        ...(typeof opts.branch === 'string' ? {branch: opts.branch} : {}),
        ...(typeof opts.checkoutPath === 'string' ? {checkoutPath: opts.checkoutPath} : {})
      })
  );

  register(
    skillpack
      .command('setup-apply')
      .description('Apply a reviewed setup plan.')
      .requiredOption('--plan-id <id>', 'Identifier of the persisted plan.')
      .requiredOption('--confirm <id>', 'Must repeat the exact plan id.'),
    async (opts) =>
      options.executor.skillpackSetupApply({planId: String(opts.planId), confirm: String(opts.confirm)})
  );

  register(
    skillpack.command('update-check').description('Read-only remote comparison using git ls-remote.')
      .option('--skillpack-id <id>', 'Skillpack to check (defaults to corvus-skillpack).'),
    async (opts) => options.executor.skillpackUpdateCheck(
      typeof opts.skillpackId === 'string' ? {skillpackId: opts.skillpackId} : {}
    )
  );

  register(
    skillpack
      .command('update-preview')
      .description('Create an inactive revision snapshot and an activation plan.')
      .option('--skillpack-id <id>', 'Skillpack to preview (defaults to corvus-skillpack).'),
    async (opts) => options.executor.skillpackUpdatePreview(
      typeof opts.skillpackId === 'string' ? {skillpackId: opts.skillpackId} : {}
    )
  );

  register(
    skillpack
      .command('update-apply')
      .description('Activate a previewed revision.')
      .requiredOption('--plan-id <id>', 'Identifier of the persisted plan.')
      .requiredOption('--confirm <id>', 'Must repeat the exact plan id.'),
    async (opts) =>
      options.executor.skillpackUpdateApply({planId: String(opts.planId), confirm: String(opts.confirm)})
  );

  register(
    skillpack
      .command('remove-plan')
      .description('Plan removal of an unused secondary skillpack registration.')
      .requiredOption('--skillpack-id <id>', 'Secondary skillpack to remove.'),
    async (opts) => options.executor.skillpackRemovePlan({skillpackId: String(opts.skillpackId)})
  );

  register(
    skillpack
      .command('remove-apply')
      .description('Apply a reviewed skillpack removal plan; snapshots are preserved.')
      .requiredOption('--plan-id <id>', 'Identifier of the persisted plan.')
      .requiredOption('--confirm <id>', 'Must repeat the exact plan id.'),
    async (opts) =>
      options.executor.skillpackRemoveApply({planId: String(opts.planId), confirm: String(opts.confirm)})
  );

  const skills = program.command('skills').description('Skill catalog commands.');

  register(
    skills
      .command('list')
      .description('List discovered skills with normalized semantic metadata.')
      .option('--agent <id>', 'Filter to skills supporting this agent.', collect, []),
    async (opts) => options.executor.skillsList({agent: asStringArray(opts.agent)})
  );

  register(
    skills
      .command('search')
      .description('Rank skills for a query using deterministic local scoring.')
      .requiredOption('--query <text>', 'Search terms.')
      .option('--agent <id>', 'Filter to skills supporting this agent.', collect, [])
      .option('--limit <n>', 'Maximum number of results.'),
    async (opts) =>
      options.executor.skillsSearch({
        query: String(opts.query),
        agent: asStringArray(opts.agent),
        ...(typeof opts.limit === 'string' ? {limit: opts.limit} : {})
      })
  );

  register(
    skills
      .command('inspect')
      .description('Return full normalized metadata for named skills.')
      .argument('<skill-id...>', 'One or more exact skill ids.')
      .option('--include-content', 'Also return SKILL.md content for the named skills.'),
    async (opts) => {
      const args = (opts.__args as unknown[] | undefined) ?? [];
      const skillIds = Array.isArray(args[0]) ? (args[0] as string[]) : [];

      return options.executor.skillsInspect(skillIds, {includeContent: opts.includeContent === true});
    }
  );

  register(
    skills
      .command('validate-registry')
      .description('Validate the active skillpack registry and report coverage.'),
    async () => options.executor.skillsValidateRegistry()
  );

  const install = program.command('install').description('Installation commands.');

  register(
    install
      .command('plan')
      .description('Produce a persisted, digest-identified installation plan.')
      .option('--agent <id>', 'Target agent id.', collect, [])
      .option('--skill <id>', 'Exact skill id to install.', collect, [])
      .option('--reason <skill-id=text>', 'Provenance for a selected skill.', collect, [])
      .option('--target-path <agent-id=path>', 'Explicit target directory for an agent.', collect, [])
      .option('--all-compatible', 'Select every skill compatible with each target agent.')
      .option('--replace-selection', 'Replace the targeted agents’ selections instead of adding.')
      .option('--intent <text>', 'The user’s original natural-language intent, kept as provenance.')
      .option('--selection-policy <policy>', 'One of minimal, balanced, complete.')
      .option('--request <path>', 'Read a JSON request document from a file, or - for stdin.'),
    async (opts) =>
      options.executor.installPlan({
        agent: asStringArray(opts.agent),
        skill: asStringArray(opts.skill),
        reason: asStringArray(opts.reason),
        targetPath: asStringArray(opts.targetPath),
        ...(opts.allCompatible === undefined ? {} : {allCompatible: opts.allCompatible === true}),
        ...(opts.replaceSelection === undefined ? {} : {replaceSelection: opts.replaceSelection === true}),
        ...(typeof opts.intent === 'string' ? {intent: opts.intent} : {}),
        ...(typeof opts.selectionPolicy === 'string' ? {selectionPolicy: opts.selectionPolicy} : {}),
        ...(typeof opts.request === 'string' ? {request: opts.request} : {})
      })
  );

  register(
    install
      .command('apply')
      .description('Apply exactly the persisted plan.')
      .requiredOption('--plan-id <id>', 'Identifier of the persisted plan.')
      .requiredOption('--confirm <id>', 'Must repeat the exact plan id.')
      .option('--replace-broken-links', 'Explicitly allow replacing broken manager-owned links.'),
    async (opts) =>
      options.executor.installApply({
        planId: String(opts.planId),
        confirm: String(opts.confirm),
        ...(opts.replaceBrokenLinks === undefined
          ? {}
          : {replaceBrokenLinks: opts.replaceBrokenLinks === true})
      })
  );

  register(
    install
      .command('verify')
      .description('Prove a plan reached the filesystem and config it described.')
      .requiredOption('--plan-id <id>', 'Identifier of the persisted plan.'),
    async (opts) => options.executor.installVerify({planId: String(opts.planId)})
  );

  return {program, result};
}

export {CommanderError};

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function version(value: string): string {
  return value === '' ? '0.0.0' : value;
}
