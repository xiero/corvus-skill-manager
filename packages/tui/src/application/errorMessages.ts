import type {MachineError, MachineErrorCode} from '@corvus-tools/skill-manager-core';

/**
 * Human-readable wording for each protocol error code.
 *
 * The TUI reuses the machine error codes rather than inventing its own vocabulary, and renders
 * these sentences instead of raw JSON.
 */
const messagesByCode: Record<MachineErrorCode, string> = {
  INVALID_REQUEST: 'That request was not valid.',
  CONFIG_NOT_FOUND: 'Manager config is missing. Run Setup Skillpack to create it.',
  CONFIG_INVALID: 'Manager config is invalid. Fix config.json before continuing.',
  SKILLPACK_NOT_CONFIGURED: 'No skillpack is configured yet. Use Setup Skillpack.',
  SKILLPACK_NOT_READY: 'The active skillpack snapshot is missing or unreadable.',
  SKILL_NOT_FOUND: 'That skill is not in the active skillpack.',
  SKILL_NOT_SUPPORTED_BY_AGENT: 'That skill does not support the selected agent.',
  SKILL_CONFLICT: 'Those skills declare a conflict and cannot both be installed.',
  UNKNOWN_AGENT: 'That agent is not a known adapter.',
  AGENT_NOT_SUPPORTED: 'That agent cannot receive linked skills yet.',
  AGENT_TARGET_REQUIRED: 'Set a target path for that agent before planning links.',
  UNMANAGED_TARGET_EXISTS: 'A target already exists and is not manager-owned. Move it yourself first.',
  PLAN_NOT_FOUND: 'That plan is no longer available. Generate a new preview.',
  PLAN_CONFIRMATION_REQUIRED: 'Explicit confirmation is required before applying.',
  PLAN_DIGEST_MISMATCH: 'The stored plan was modified after it was generated. Generate a new preview.',
  STALE_PLAN: 'Local state changed after the preview was generated. Generate a new preview.',
  SAFETY_POLICY_BLOCKED: 'A safety rule blocked that operation.',
  EXTERNAL_OPERATION_FAILED: 'An external operation failed.',
  INTERNAL_ERROR: 'Something went wrong.'
};

export function describeMachineError(error: MachineError): string {
  const summary = messagesByCode[error.code] ?? messagesByCode.INTERNAL_ERROR;

  return summary === error.message ? summary : `${summary} ${error.message}`;
}

/** Joins several errors into one line suitable for the TUI's single message slot. */
export function describeMachineErrors(errors: readonly MachineError[]): string {
  if (errors.length === 0) {
    return messagesByCode.INTERNAL_ERROR;
  }

  return errors.map((error) => describeMachineError(error)).join(' ');
}
