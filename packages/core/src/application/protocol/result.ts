import {
  type MachineCommand,
  type MachineEnvelope,
  createFailureEnvelope,
  createSuccessEnvelope
} from './envelope.js';
import type {MachineError, MachineWarning} from './errors.js';
import type {NextAction} from './nextActions.js';

/**
 * The value every application use case returns.
 *
 * `ok` discriminates the union so a typed caller (the TUI) gets the concrete data shape on
 * success, while an untyped caller (the machine CLI) can serialize either branch through
 * `toMachineEnvelope` without knowing the data type.
 */
export interface UseCaseSuccess<TData> {
  ok: true;
  changed: boolean;
  data: TData;
  warnings: MachineWarning[];
  errors: [];
  nextActions: NextAction[];
}

export interface UseCaseFailure {
  ok: false;
  changed: boolean;
  data: Record<string, unknown>;
  warnings: MachineWarning[];
  errors: MachineError[];
  nextActions: NextAction[];
}

export type UseCaseResult<TData> = UseCaseSuccess<TData> | UseCaseFailure;

export interface SucceedOptions {
  changed?: boolean;
  warnings?: MachineWarning[];
  nextActions?: NextAction[];
}

export function succeed<TData>(data: TData, options: SucceedOptions = {}): UseCaseSuccess<TData> {
  return {
    ok: true,
    changed: options.changed ?? false,
    data,
    warnings: options.warnings ?? [],
    errors: [],
    nextActions: options.nextActions ?? []
  };
}

export interface FailOptions extends SucceedOptions {
  data?: Record<string, unknown>;
}

export function fail(errors: MachineError[], options: FailOptions = {}): UseCaseFailure {
  if (errors.length === 0) {
    throw new Error('A failed use case result requires at least one error.');
  }

  return {
    ok: false,
    changed: options.changed ?? false,
    data: options.data ?? {},
    warnings: options.warnings ?? [],
    errors,
    nextActions: options.nextActions ?? []
  };
}

export function failWith(error: MachineError, options: FailOptions = {}): UseCaseFailure {
  return fail([error], options);
}

/**
 * Serializes a use-case result into the versioned machine envelope. This is the only place
 * where a typed data object is widened to the envelope's `Record<string, unknown>`.
 */
export function toMachineEnvelope<TData>(
  command: MachineCommand,
  result: UseCaseResult<TData>
): MachineEnvelope {
  const data = toEnvelopeData(result.data);

  if (result.ok) {
    return createSuccessEnvelope({
      command,
      changed: result.changed,
      data,
      warnings: result.warnings,
      nextActions: result.nextActions
    });
  }

  return createFailureEnvelope({
    command,
    changed: result.changed,
    data,
    warnings: result.warnings,
    errors: result.errors,
    nextActions: result.nextActions
  });
}

function toEnvelopeData(data: unknown): Record<string, unknown> {
  if (data === null || data === undefined) {
    return {};
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    return {value: data};
  }

  return {...(data as Record<string, unknown>)};
}
