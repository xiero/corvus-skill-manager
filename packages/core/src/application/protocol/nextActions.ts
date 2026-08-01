import {z} from 'zod';

/**
 * A machine-readable hint telling the calling agent what to do next. Next actions are advice,
 * never an authorization: a write still requires its own command plus explicit confirmation.
 */
export const nextActionSchema = z
  .object({
    code: z.string().min(1),
    description: z.string().min(1),
    command: z.string().min(1).optional()
  })
  .strict();

export type NextAction = z.infer<typeof nextActionSchema>;

export function createNextAction(code: string, description: string, command?: string): NextAction {
  return {
    code,
    description,
    ...(command === undefined ? {} : {command})
  };
}

/** Removes duplicate codes while preserving first-seen order, so output stays deterministic. */
export function dedupeNextActions(actions: NextAction[]): NextAction[] {
  const seen = new Set<string>();
  const result: NextAction[] = [];

  for (const action of actions) {
    if (seen.has(action.code)) {
      continue;
    }

    seen.add(action.code);
    result.push(action);
  }

  return result;
}
