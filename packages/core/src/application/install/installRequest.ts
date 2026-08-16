import {z} from 'zod';
import {agentIdSchema} from '../../config/configSchema.js';

/**
 * Version of the install request contract. Deliberately independent from the machine protocol
 * version and from internal TypeScript types, so a request document written today keeps a
 * stable meaning.
 */
export const installRequestSchemaVersion = 1;

export const selectionPolicies = ['minimal', 'balanced', 'complete'] as const;

export type SelectionPolicy = (typeof selectionPolicies)[number];

export const selectionPolicySchema = z.enum(selectionPolicies);

export const installRequestLimits = {
  intentLength: 500,
  reasonLength: 280,
  selectedSkills: 256,
  targetAgents: 16
} as const;

const trimmedString = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim() !== '', {message: 'Must not be blank.'});

export const selectedSkillRequestSchema = z
  .object({
    id: z.string().min(1).regex(/^[a-zA-Z0-9._-]+(?::[a-zA-Z0-9._-]+)?$/, 'Use a skill id or <skillpack-id>:<skill-id>.'),
    reason: trimmedString(installRequestLimits.reasonLength).optional()
  })
  .strict();

export const installRequestSchema = z
  .object({
    schemaVersion: z.literal(installRequestSchemaVersion),
    /** The user's original natural-language intent, kept purely as audit provenance. */
    intent: trimmedString(installRequestLimits.intentLength).optional(),
    /**
     * Provenance for how broadly the calling agent interpreted the intent. Corvus records it;
     * it never invokes an LLM to second-guess subjective relevance.
     */
    selectionPolicy: selectionPolicySchema.optional(),
    targetAgents: z.array(agentIdSchema).min(1).max(installRequestLimits.targetAgents),
    selectedSkills: z.array(selectedSkillRequestSchema).max(installRequestLimits.selectedSkills).optional(),
    allCompatible: z.boolean().optional(),
    /** Replace the targeted agents' selections instead of adding to them. */
    replaceSelection: z.boolean().optional(),
    /** Explicit target directory per agent; required for the `custom` agent. */
    agentTargetPaths: z.record(agentIdSchema, z.string().min(1)).optional()
  })
  .strict()
  .superRefine((value, context) => {
    const hasExplicitSelection = value.selectedSkills !== undefined;
    const wantsAllCompatible = value.allCompatible === true;

    if (hasExplicitSelection && wantsAllCompatible) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either selectedSkills or allCompatible, never both.',
        path: ['selectedSkills']
      });
    }

    if (!hasExplicitSelection && !wantsAllCompatible) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide selectedSkills (possibly empty) or allCompatible: true.',
        path: ['selectedSkills']
      });
    }
  });

export type InstallRequest = z.infer<typeof installRequestSchema>;

export interface NormalizedSelectedSkill {
  id: string;
  reason?: string;
}

/**
 * The canonical form of a request. Equivalent CLI flags and request documents normalize to the
 * exact same object, which is what makes the plan digest reproducible.
 */
export interface NormalizedInstallRequest {
  schemaVersion: typeof installRequestSchemaVersion;
  intent?: string;
  selectionPolicy?: SelectionPolicy;
  targetAgents: string[];
  selectedSkills?: NormalizedSelectedSkill[];
  allCompatible: boolean;
  replaceSelection: boolean;
  agentTargetPaths?: Record<string, string>;
}

export function parseInstallRequest(value: unknown): InstallRequest {
  return installRequestSchema.parse(value);
}

/**
 * Normalizes a validated request: target agents and selected skills are sorted and
 * deduplicated, and the first reason given for a duplicated skill wins. Sorting means input
 * ordering cannot change the resulting plan digest.
 */
export function normalizeInstallRequest(request: InstallRequest): NormalizedInstallRequest {
  const targetAgents = [...new Set(request.targetAgents)].sort((left, right) => left.localeCompare(right));
  const intent = request.intent?.trim();
  const agentTargetPaths = normalizeAgentTargetPaths(request.agentTargetPaths);

  return {
    schemaVersion: installRequestSchemaVersion,
    ...(intent === undefined || intent === '' ? {} : {intent}),
    ...(request.selectionPolicy === undefined ? {} : {selectionPolicy: request.selectionPolicy}),
    targetAgents,
    ...(request.selectedSkills === undefined
      ? {}
      : {selectedSkills: normalizeSelectedSkills(request.selectedSkills)}),
    allCompatible: request.allCompatible === true,
    replaceSelection: request.replaceSelection === true,
    ...(agentTargetPaths === undefined ? {} : {agentTargetPaths})
  };
}

function normalizeSelectedSkills(
  selectedSkills: ReadonlyArray<{id: string; reason?: string | undefined}>
): NormalizedSelectedSkill[] {
  const byId = new Map<string, NormalizedSelectedSkill>();

  for (const selected of selectedSkills) {
    const id = selected.id.trim();

    if (id === '' || byId.has(id)) {
      continue;
    }

    const reason = selected.reason?.trim();
    byId.set(id, {id, ...(reason === undefined || reason === '' ? {} : {reason})});
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeAgentTargetPaths(
  agentTargetPaths: Record<string, string | undefined> | undefined
): Record<string, string> | undefined {
  if (agentTargetPaths === undefined) {
    return undefined;
  }

  const entries = Object.entries(agentTargetPaths)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1].trim() !== '')
    .map(([agentId, targetPath]): [string, string] => [agentId, targetPath.trim()])
    .sort(([left], [right]) => left.localeCompare(right));

  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

export interface InstallRequestFlags {
  agents?: string[];
  skills?: string[];
  reasons?: Record<string, string>;
  allCompatible?: boolean;
  replaceSelection?: boolean;
  intent?: string;
  selectionPolicy?: string;
  agentTargetPaths?: Record<string, string>;
}

/**
 * Builds an unvalidated request document from repeated CLI flags. The result goes through the
 * exact same schema and normalization as a `--request` document, so both entry points cannot
 * drift apart.
 */
export function installRequestFromFlags(flags: InstallRequestFlags): unknown {
  const skills = flags.skills ?? [];

  return {
    schemaVersion: installRequestSchemaVersion,
    ...(flags.intent === undefined ? {} : {intent: flags.intent}),
    ...(flags.selectionPolicy === undefined ? {} : {selectionPolicy: flags.selectionPolicy}),
    targetAgents: flags.agents ?? [],
    ...(flags.allCompatible === true
      ? {allCompatible: true}
      : {
          selectedSkills: skills.map((id) => {
            const reason = flags.reasons?.[id];
            return {id, ...(reason === undefined ? {} : {reason})};
          })
        }),
    ...(flags.replaceSelection === undefined ? {} : {replaceSelection: flags.replaceSelection}),
    ...(flags.agentTargetPaths === undefined ? {} : {agentTargetPaths: flags.agentTargetPaths})
  };
}
