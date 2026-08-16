import {z} from 'zod';
import {type MachineErrorCategory, exitCodeForCategory} from './exitCodes.js';

/**
 * Stable symbolic error taxonomy. These codes are part of the public machine contract:
 * a code never changes meaning and never changes category.
 */
export const machineErrorCodes = [
  'INVALID_REQUEST',
  'CONFIG_NOT_FOUND',
  'CONFIG_INVALID',
  'SKILLPACK_NOT_CONFIGURED',
  'SKILLPACK_NOT_READY',
  'SKILL_NOT_FOUND',
  'SKILL_NOT_SUPPORTED_BY_AGENT',
  'SKILL_CONFLICT',
  'SKILL_TARGET_NAME_CONFLICT',
  'UNKNOWN_AGENT',
  'AGENT_NOT_SUPPORTED',
  'AGENT_TARGET_REQUIRED',
  'UNMANAGED_TARGET_EXISTS',
  'PLAN_NOT_FOUND',
  'PLAN_CONFIRMATION_REQUIRED',
  'PLAN_DIGEST_MISMATCH',
  'STALE_PLAN',
  'SAFETY_POLICY_BLOCKED',
  'EXTERNAL_OPERATION_FAILED',
  'INTERNAL_ERROR'
] as const;

export type MachineErrorCode = (typeof machineErrorCodes)[number];

export const machineErrorCodeSchema = z.enum(machineErrorCodes);

const errorCodeCategories: Record<MachineErrorCode, MachineErrorCategory> = {
  INVALID_REQUEST: 'invalid-request',
  CONFIG_NOT_FOUND: 'conflict',
  CONFIG_INVALID: 'invalid-request',
  SKILLPACK_NOT_CONFIGURED: 'conflict',
  SKILLPACK_NOT_READY: 'conflict',
  SKILL_NOT_FOUND: 'invalid-request',
  SKILL_NOT_SUPPORTED_BY_AGENT: 'conflict',
  SKILL_CONFLICT: 'conflict',
  SKILL_TARGET_NAME_CONFLICT: 'conflict',
  UNKNOWN_AGENT: 'invalid-request',
  AGENT_NOT_SUPPORTED: 'conflict',
  AGENT_TARGET_REQUIRED: 'conflict',
  UNMANAGED_TARGET_EXISTS: 'conflict',
  PLAN_NOT_FOUND: 'confirmation',
  PLAN_CONFIRMATION_REQUIRED: 'confirmation',
  PLAN_DIGEST_MISMATCH: 'confirmation',
  STALE_PLAN: 'confirmation',
  SAFETY_POLICY_BLOCKED: 'safety',
  EXTERNAL_OPERATION_FAILED: 'external',
  INTERNAL_ERROR: 'internal'
};

const retryableErrorCodes = new Set<MachineErrorCode>(['EXTERNAL_OPERATION_FAILED']);

export function categoryForErrorCode(code: MachineErrorCode): MachineErrorCategory {
  return errorCodeCategories[code];
}

export function exitCodeForErrorCode(code: MachineErrorCode): number {
  return exitCodeForCategory(categoryForErrorCode(code));
}

export const machineErrorSchema = z
  .object({
    code: machineErrorCodeSchema,
    category: z.enum(['invalid-request', 'conflict', 'confirmation', 'safety', 'external', 'internal']),
    message: z.string().min(1),
    retryable: z.boolean(),
    path: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
    skillId: z.string().min(1).optional(),
    field: z.string().min(1).optional(),
    details: z.record(z.unknown()).optional()
  })
  .strict();

export type MachineError = z.infer<typeof machineErrorSchema>;

export const machineWarningSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    path: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
    skillId: z.string().min(1).optional()
  })
  .strict();

export type MachineWarning = z.infer<typeof machineWarningSchema>;

export interface CreateMachineErrorOptions {
  path?: string;
  agentId?: string;
  skillId?: string;
  field?: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

/**
 * Builds a machine error with a consistent category. Optional fields are omitted entirely
 * rather than emitted as `undefined`.
 */
export function createMachineError(
  code: MachineErrorCode,
  message: string,
  options: CreateMachineErrorOptions = {}
): MachineError {
  return {
    code,
    category: categoryForErrorCode(code),
    message,
    retryable: options.retryable ?? retryableErrorCodes.has(code),
    ...(options.path === undefined ? {} : {path: options.path}),
    ...(options.agentId === undefined ? {} : {agentId: options.agentId}),
    ...(options.skillId === undefined ? {} : {skillId: options.skillId}),
    ...(options.field === undefined ? {} : {field: options.field}),
    ...(options.details === undefined ? {} : {details: options.details})
  };
}

export interface CreateMachineWarningOptions {
  path?: string;
  agentId?: string;
  skillId?: string;
}

export function createMachineWarning(
  code: string,
  message: string,
  options: CreateMachineWarningOptions = {}
): MachineWarning {
  return {
    code,
    message,
    ...(options.path === undefined ? {} : {path: options.path}),
    ...(options.agentId === undefined ? {} : {agentId: options.agentId}),
    ...(options.skillId === undefined ? {} : {skillId: options.skillId})
  };
}

/**
 * Converts an arbitrary thrown value into a machine error without leaking a stack trace.
 * Stack traces are only ever surfaced through an explicit debug channel on stderr.
 */
export function machineErrorFromUnknown(
  error: unknown,
  options: {code?: MachineErrorCode; fallbackMessage?: string} & CreateMachineErrorOptions = {}
): MachineError {
  const {code = 'INTERNAL_ERROR', fallbackMessage = 'Unexpected internal failure.', ...errorOptions} = options;
  const message = sanitizeErrorMessage(error) ?? fallbackMessage;

  return createMachineError(code, message, errorOptions);
}

function sanitizeErrorMessage(error: unknown): string | undefined {
  if (error instanceof z.ZodError) {
    return formatZodError(error);
  }

  if (error instanceof Error) {
    const firstLine = error.message.split('\n')[0]?.trim();
    return firstLine === undefined || firstLine === '' ? undefined : firstLine;
  }

  if (typeof error === 'string' && error.trim() !== '') {
    return error.split('\n')[0]?.trim();
  }

  return undefined;
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const issuePath = issue.path.length === 0 ? '<root>' : issue.path.join('.');
      return `${issuePath}: ${issue.message}`;
    })
    .join('; ');
}
