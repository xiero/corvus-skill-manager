/**
 * Broad process exit-code categories for machine commands.
 *
 * The JSON error code inside the envelope is authoritative; these numbers are only a coarse
 * classification so a shell caller can branch without parsing JSON.
 */
export const machineErrorCategories = [
  'invalid-request',
  'conflict',
  'confirmation',
  'safety',
  'external',
  'internal'
] as const;

export type MachineErrorCategory = (typeof machineErrorCategories)[number];

export const exitCodeSuccess = 0;

const categoryExitCodes: Record<MachineErrorCategory, number> = {
  'invalid-request': 2,
  conflict: 3,
  confirmation: 4,
  safety: 5,
  external: 6,
  internal: 7
};

export function exitCodeForCategory(category: MachineErrorCategory): number {
  return categoryExitCodes[category];
}

export interface ExitCodeCategoryDescription {
  exitCode: number;
  category: MachineErrorCategory | 'success';
  meaning: string;
}

/** Deterministic, documentation-facing description of the exit-code contract. */
export const exitCodeCategoryDescriptions: readonly ExitCodeCategoryDescription[] = [
  {exitCode: 0, category: 'success', meaning: 'Successful command, including an idempotent no-op.'},
  {exitCode: 2, category: 'invalid-request', meaning: 'Invalid input, request, or schema.'},
  {exitCode: 3, category: 'conflict', meaning: 'Conflict or unsafe target state.'},
  {exitCode: 4, category: 'confirmation', meaning: 'Explicit confirmation required or stale plan.'},
  {exitCode: 5, category: 'safety', meaning: 'Safety policy blocked the operation.'},
  {exitCode: 6, category: 'external', meaning: 'External dependency, filesystem, git, or network failure.'},
  {exitCode: 7, category: 'internal', meaning: 'Unexpected internal failure.'}
] as const;
