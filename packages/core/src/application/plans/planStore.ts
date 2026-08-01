import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {assertPathInside, isPathInside} from '../../paths.js';
import {
  type PersistedPlan,
  parsePersistedPlan,
  planDigestMatches,
  planIdPattern
} from './planSchema.js';

export type PlanLoadResult =
  | {status: 'loaded'; plan: PersistedPlan; planPath: string}
  | {status: 'not-found'; planPath: string}
  | {status: 'invalid'; planPath: string; message: string}
  | {status: 'digest-mismatch'; planPath: string; plan: PersistedPlan};

/**
 * Resolves the file backing a plan id, rejecting traversal and any id that is not in the
 * manager's own `<kind>-<digest>` form. Plan storage can never escape the plans directory.
 */
export function resolvePlanPath(plansDir: string, planId: string): string {
  if (!planIdPattern.test(planId)) {
    throw new Error(`Refusing to use malformed plan id: ${planId}`);
  }

  const planPath = path.resolve(plansDir, `${planId}.json`);

  assertPathInside(plansDir, planPath);

  if (path.dirname(planPath) !== path.resolve(plansDir)) {
    throw new Error(`Refusing to use plan path outside the plans directory: ${planPath}`);
  }

  return planPath;
}

export function isPlanPathSafe(plansDir: string, planId: string): boolean {
  try {
    return isPathInside(plansDir, resolvePlanPath(plansDir, planId));
  } catch {
    return false;
  }
}

/** Writes the plan atomically: a temporary file in the same directory, then a rename. */
export async function savePlan(plansDir: string, plan: PersistedPlan): Promise<string> {
  const planPath = resolvePlanPath(plansDir, plan.planId);
  const temporaryPath = path.join(plansDir, `.tmp-${process.pid}-${randomUUID()}`);

  await fs.mkdir(plansDir, {recursive: true});

  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, planPath);
  } catch (error) {
    await fs.rm(temporaryPath, {force: true});
    throw error;
  }

  return planPath;
}

export async function loadPlan(plansDir: string, planId: string): Promise<PlanLoadResult> {
  let planPath: string;

  try {
    planPath = resolvePlanPath(plansDir, planId);
  } catch (error) {
    return {
      status: 'invalid',
      planPath: path.join(plansDir, `${planId}.json`),
      message: error instanceof Error ? error.message : String(error)
    };
  }

  let rawPlan: string;

  try {
    rawPlan = await fs.readFile(planPath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return {status: 'not-found', planPath};
    }

    return {status: 'invalid', planPath, message: error instanceof Error ? error.message : String(error)};
  }

  let plan: PersistedPlan;

  try {
    plan = parsePersistedPlan(JSON.parse(rawPlan));
  } catch (error) {
    return {status: 'invalid', planPath, message: error instanceof Error ? error.message : String(error)};
  }

  if (plan.planId !== planId) {
    return {status: 'invalid', planPath, message: `Stored plan id ${plan.planId} does not match ${planId}.`};
  }

  if (!planDigestMatches(plan)) {
    return {status: 'digest-mismatch', planPath, plan};
  }

  return {status: 'loaded', plan, planPath};
}

export async function deletePlan(plansDir: string, planId: string): Promise<void> {
  await fs.rm(resolvePlanPath(plansDir, planId), {force: true});
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
