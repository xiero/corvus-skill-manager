import {
  type MachineCommand,
  type MachineEnvelope,
  createFailureEnvelope,
  createMachineError,
  exitCodeForEnvelope,
  machineErrorFromUnknown,
  serializeEnvelope
} from '@corvus-tools/skill-manager-core';

export interface CliIo {
  writeOut: (chunk: string) => void;
  writeErr: (chunk: string) => void;
  readStdin: () => Promise<string>;
}

export const defaultCliIo: CliIo = {
  writeOut: (chunk) => {
    process.stdout.write(chunk);
  },
  writeErr: (chunk) => {
    process.stderr.write(chunk);
  },
  readStdin: async () => {
    const chunks: Buffer[] = [];

    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString('utf8');
  }
};

export interface OutputOptions {
  json: boolean;
  debug: boolean;
}

/**
 * Writes the result of a machine command.
 *
 * In JSON mode stdout receives exactly one JSON document and nothing else — no colour, no ANSI,
 * no terminal clearing, no prompts. Diagnostics always go to stderr.
 */
export function writeEnvelope(io: CliIo, envelope: MachineEnvelope, options: OutputOptions): number {
  if (options.json) {
    io.writeOut(`${serializeEnvelope(envelope)}\n`);
  } else {
    io.writeOut(renderHuman(envelope));
  }

  if (options.debug) {
    io.writeErr(`[debug] command=${envelope.command} ok=${envelope.ok} changed=${envelope.changed}\n`);
  }

  return exitCodeForEnvelope(envelope);
}

/** A plain-text rendering for humans running a machine command without `--json`. */
function renderHuman(envelope: MachineEnvelope): string {
  const lines: string[] = [`${envelope.ok ? 'ok' : 'failed'}: ${envelope.command}`];

  if (envelope.changed) {
    lines.push('changed: yes');
  }

  for (const error of envelope.errors) {
    lines.push(`error [${error.code}] ${error.message}${error.path === undefined ? '' : ` (${error.path})`}`);
  }

  for (const warning of envelope.warnings) {
    lines.push(`warning [${warning.code}] ${warning.message}`);
  }

  for (const [key, value] of Object.entries(envelope.data)) {
    lines.push(`${key}: ${summarizeValue(value)}`);
  }

  for (const action of envelope.nextActions) {
    lines.push(`next: ${action.description}${action.command === undefined ? '' : ` -> ${action.command}`}`);
  }

  lines.push('', 'Add --json for the full machine-readable result.');

  return `${lines.join('\n')}\n`;
}

function summarizeValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `${value.length} item(s)`;
  }

  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).join(', ')}}`;
  }

  return String(value);
}

/** Wraps an unexpected failure in a stable envelope instead of leaking a stack trace. */
export function failureEnvelope(
  command: MachineCommand,
  error: unknown,
  io: CliIo,
  options: OutputOptions
): MachineEnvelope {
  if (options.debug && error instanceof Error && error.stack !== undefined) {
    io.writeErr(`${error.stack}\n`);
  }

  return createFailureEnvelope({command, errors: [machineErrorFromUnknown(error)]});
}

export function interruptedEnvelope(command: MachineCommand): MachineEnvelope {
  return createFailureEnvelope({
    command,
    errors: [createMachineError('INTERNAL_ERROR', 'Interrupted before the command completed.')]
  });
}
