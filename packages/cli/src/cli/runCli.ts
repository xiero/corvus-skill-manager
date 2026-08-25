import type {CorvusApplicationOptions, MachineCommand} from '@corvus-tools/skill-manager-core';
import {CommanderError, createProgram} from './createProgram.js';
import {createExecutor} from './executeCommand.js';
import {type CliIo, defaultCliIo, failureEnvelope, writeEnvelope} from './output.js';

export interface RunCliOptions {
  io?: CliIo;
  entryUrl?: string;
  version?: string;
  applicationOptions?: CorvusApplicationOptions;
}

export const helpExitCode = 0;
export const usageErrorExitCode = 2;

/**
 * Runs a machine command and returns its process exit code.
 *
 * The caller decides how to handle the no-argument case; this function never launches the TUI,
 * so importing it cannot pull Ink into a machine command's runtime graph.
 */
export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const io = options.io ?? defaultCliIo;
  const executor = createExecutor({
    io,
    ...(options.entryUrl === undefined ? {} : {entryUrl: options.entryUrl}),
    ...(options.applicationOptions === undefined ? {} : {applicationOptions: options.applicationOptions})
  });
  const {program, result} = createProgram({executor, io, version: options.version ?? ''});

  try {
    await program.parseAsync(argv, {from: 'user'});
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander already wrote help or the usage error through our io.
      return error.exitCode === 0 ? helpExitCode : usageErrorExitCode;
    }

    return writeEnvelope(io, failureEnvelope(commandFor(argv), error, io, {json: result.json, debug: result.debug}), {
      json: result.json,
      debug: result.debug
    });
  }

  if (result.run === undefined) {
    program.outputHelp();
    return helpExitCode;
  }

  const outputOptions = {json: result.json, debug: result.debug};

  try {
    return writeEnvelope(io, await result.run(), outputOptions);
  } catch (error) {
    return writeEnvelope(io, failureEnvelope(commandFor(argv), error, io, outputOptions), outputOptions);
  }
}

/** Best-effort command identity for an envelope produced before parsing succeeded. */
function commandFor(argv: string[]): MachineCommand {
  const positional = argv.filter((argument) => !argument.startsWith('-'));
  const candidate = positional.slice(0, 2).join('.');
  const known: MachineCommand[] = [
    'capabilities',
    'status',
    'doctor',
    'agents.list',
    'skillpack.status',
    'skillpack.setup-plan',
    'skillpack.setup-apply',
    'skillpack.update-check',
    'skillpack.update-preview',
    'skillpack.update-apply',
    'skillpack.remove-plan',
    'skillpack.remove-apply',
    'skills.list',
    'skills.search',
    'skills.inspect',
    'skills.validate-registry',
    'skills.check-version-discipline',
    'install.plan',
    'install.apply',
    'install.verify'
  ];

  if (known.includes(candidate as MachineCommand)) {
    return candidate as MachineCommand;
  }

  const single = positional[0];

  return single !== undefined && known.includes(single as MachineCommand)
    ? (single as MachineCommand)
    : 'capabilities';
}
