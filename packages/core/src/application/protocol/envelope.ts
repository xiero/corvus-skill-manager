import {z} from 'zod';
import {canonicalJsonStringify} from './canonicalJson.js';
import {
  type MachineError,
  type MachineWarning,
  machineErrorSchema,
  machineWarningSchema
} from './errors.js';
import {exitCodeForCategory, exitCodeSuccess} from './exitCodes.js';
import {type NextAction, nextActionSchema} from './nextActions.js';

/** Version of the machine protocol envelope itself, independent of any request schema. */
export const machineProtocolVersion = 1;

/**
 * Every machine command in the public surface. This list is the single source of truth for
 * capability advertisement and CLI registration; both are tested against it.
 */
export const machineCommands = [
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
  'skills.list',
  'skills.search',
  'skills.inspect',
  'skills.validate-registry',
  'install.plan',
  'install.apply',
  'install.verify'
] as const;

export type MachineCommand = (typeof machineCommands)[number];

export const machineCommandSchema = z.enum(machineCommands);

export const machineEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(machineProtocolVersion),
    ok: z.boolean(),
    command: machineCommandSchema,
    changed: z.boolean(),
    data: z.record(z.unknown()),
    warnings: z.array(machineWarningSchema),
    errors: z.array(machineErrorSchema),
    nextActions: z.array(nextActionSchema)
  })
  .strict();

export type MachineEnvelope = z.infer<typeof machineEnvelopeSchema>;

export function parseMachineEnvelope(value: unknown): MachineEnvelope {
  return machineEnvelopeSchema.parse(value);
}

export interface CreateEnvelopeOptions {
  command: MachineCommand;
  data?: Record<string, unknown>;
  changed?: boolean;
  warnings?: MachineWarning[];
  errors?: MachineError[];
  nextActions?: NextAction[];
}

export function createSuccessEnvelope(options: CreateEnvelopeOptions): MachineEnvelope {
  return {
    schemaVersion: machineProtocolVersion,
    ok: true,
    command: options.command,
    changed: options.changed ?? false,
    data: options.data ?? {},
    warnings: options.warnings ?? [],
    errors: [],
    nextActions: options.nextActions ?? []
  };
}

export function createFailureEnvelope(
  options: CreateEnvelopeOptions & {errors: MachineError[]}
): MachineEnvelope {
  if (options.errors.length === 0) {
    throw new Error('A failure envelope requires at least one error.');
  }

  return {
    schemaVersion: machineProtocolVersion,
    ok: false,
    command: options.command,
    changed: options.changed ?? false,
    data: options.data ?? {},
    warnings: options.warnings ?? [],
    errors: options.errors,
    nextActions: options.nextActions ?? []
  };
}

/**
 * The process exit code for an envelope. Successful envelopes — including idempotent no-ops —
 * exit 0. Failures use the category of their first (most significant) error.
 */
export function exitCodeForEnvelope(envelope: MachineEnvelope): number {
  if (envelope.ok) {
    return exitCodeSuccess;
  }

  const firstError = envelope.errors[0];

  return firstError === undefined ? exitCodeSuccess : exitCodeForCategory(firstError.category);
}

/**
 * Deterministic serialization: equivalent envelopes always produce identical bytes. Optional
 * fields are already omitted by the builders, so no `undefined` can reach the output.
 */
export function serializeEnvelope(envelope: MachineEnvelope): string {
  return canonicalJsonStringify(envelope);
}
