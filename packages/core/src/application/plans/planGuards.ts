import {type ContextPrecondition} from '../context.js';
import {createMachineError} from '../protocol/errors.js';
import {createNextAction} from '../protocol/nextActions.js';
import {
  type PersistedPlan,
  type PlanKind,
  type StateFingerprint,
  diffStateFingerprints
} from './planSchema.js';
import {loadPlan} from './planStore.js';

export interface LoadConfirmedPlanOptions {
  plansDir: string;
  planId: string;
  confirm: string;
  kind: PlanKind;
  /** CLI form used in regenerate hints, e.g. `install plan`. */
  regenerateCommand: string;
}

/**
 * Loads a plan for an apply command and enforces the confirmation contract:
 * the plan must exist, parse, still match its own digest, be of the expected kind, and the
 * caller must repeat the plan id as the confirmation token. `--json` alone is never enough.
 */
export async function loadConfirmedPlan(
  options: LoadConfirmedPlanOptions
): Promise<PersistedPlan | ContextPrecondition> {
  if (options.confirm !== options.planId) {
    return {
      error: createMachineError(
        'PLAN_CONFIRMATION_REQUIRED',
        `Confirmation token does not match the plan id. Pass --confirm ${options.planId}.`,
        {details: {planId: options.planId, confirm: options.confirm}}
      ),
      nextActions: [
        createNextAction(
          'repeat-confirmation',
          'Repeat the exact plan id as the confirmation token.',
          `corvus-skills ${applyCommandFor(options.kind)} --plan-id ${options.planId} --confirm ${options.planId} --json`
        )
      ]
    };
  }

  const loaded = await loadPlan(options.plansDir, options.planId);

  if (loaded.status === 'not-found') {
    return {
      error: createMachineError('PLAN_NOT_FOUND', `No plan stored for id ${options.planId}.`, {
        path: loaded.planPath,
        details: {planId: options.planId}
      }),
      nextActions: [regeneratePlanAction(options.regenerateCommand)]
    };
  }

  if (loaded.status === 'invalid') {
    return {
      error: createMachineError('PLAN_NOT_FOUND', `Stored plan ${options.planId} is unreadable: ${loaded.message}`, {
        path: loaded.planPath,
        details: {planId: options.planId}
      }),
      nextActions: [regeneratePlanAction(options.regenerateCommand)]
    };
  }

  if (loaded.status === 'digest-mismatch') {
    return {
      error: createMachineError(
        'PLAN_DIGEST_MISMATCH',
        `Stored plan ${options.planId} no longer matches its digest; it was modified after it was generated.`,
        {path: loaded.planPath, details: {planId: options.planId}}
      ),
      nextActions: [regeneratePlanAction(options.regenerateCommand)]
    };
  }

  if (loaded.plan.kind !== options.kind) {
    return {
      error: createMachineError(
        'PLAN_NOT_FOUND',
        `Plan ${options.planId} is a ${loaded.plan.kind} plan, not a ${options.kind} plan.`,
        {path: loaded.planPath, details: {planId: options.planId, kind: loaded.plan.kind}}
      ),
      nextActions: [regeneratePlanAction(options.regenerateCommand)]
    };
  }

  return loaded.plan;
}

/**
 * Compares the fingerprint captured at plan time with the fingerprint of current state.
 * Returns a `STALE_PLAN` precondition naming the drifted components, so the calling agent can
 * regenerate deliberately. Corvus never regenerates and applies silently.
 */
export function requireFreshState(options: {
  planId: string;
  expected: StateFingerprint;
  actual: StateFingerprint;
  regenerateCommand: string;
}): ContextPrecondition | undefined {
  if (options.expected.value === options.actual.value) {
    return undefined;
  }

  const changedComponents = diffStateFingerprints(options.expected, options.actual);

  return {
    error: createMachineError(
      'STALE_PLAN',
      `Local state changed after plan ${options.planId} was generated (${changedComponents.join(', ') || 'unknown'}).`,
      {
        details: {
          planId: options.planId,
          changedComponents,
          expectedFingerprint: options.expected.value,
          actualFingerprint: options.actual.value
        }
      }
    ),
    nextActions: [regeneratePlanAction(options.regenerateCommand)]
  };
}

function regeneratePlanAction(regenerateCommand: string) {
  return createNextAction(
    'regenerate-plan',
    'Regenerate the plan against current state, review it, then apply the new plan id.',
    `corvus-skills ${regenerateCommand} --json`
  );
}

function applyCommandFor(kind: PlanKind): string {
  if (kind === 'install') {
    return 'install apply';
  }

  if (kind === 'skillpack-setup') return 'skillpack setup-apply';
  if (kind === 'skillpack-remove') return 'skillpack remove-apply';
  return 'skillpack update-apply';
}
