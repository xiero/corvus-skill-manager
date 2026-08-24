import {z} from 'zod';
import {agentIdSchema} from '../../config/configSchema.js';

/** Current emitted request version. Persisted request v1 documents remain readable. */
export const installRequestSchemaVersion = 2;
export const legacyInstallRequestSchemaVersion = 1;

export const selectionPolicies = ['minimal', 'balanced', 'complete'] as const;

export type SelectionPolicy = (typeof selectionPolicies)[number];

export const selectionPolicySchema = z.enum(selectionPolicies);

export const installRequestLimits = {
  intentLength: 500,
  reasonLength: 280,
  selectedSkills: 256,
  selectedBundles: 256,
  targetAgents: 16
} as const;

const trimmedString = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim() !== '', {message: 'Must not be blank.'});

const selectableReferenceSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-zA-Z0-9._-]+(?::[a-zA-Z0-9._-]+)?$/,
    'Use a local id or qualified <skillpack-id>:<local-id> reference.'
  );

export const selectedSkillRequestSchema = z
  .object({
    id: selectableReferenceSchema,
    reason: trimmedString(installRequestLimits.reasonLength).optional()
  })
  .strict();

export const selectedBundleRequestSchema = z.object({id: selectableReferenceSchema}).strict();

const commonRequestFields = {
  /** The user's original natural-language intent, kept purely as audit provenance. */
  intent: trimmedString(installRequestLimits.intentLength).optional(),
  /** Records how broadly the caller interpreted intent; Corvus never makes that choice. */
  selectionPolicy: selectionPolicySchema.optional(),
  targetAgents: z.array(agentIdSchema).min(1).max(installRequestLimits.targetAgents),
  selectedSkills: z.array(selectedSkillRequestSchema).max(installRequestLimits.selectedSkills).optional(),
  allCompatible: z.boolean().optional(),
  /** Replace both root collections for targeted agents instead of adding supplied roots. */
  replaceSelection: z.boolean().optional(),
  /** Explicit target directory per agent; required for the `custom` agent. */
  agentTargetPaths: z.record(agentIdSchema, z.string().min(1)).optional()
};

export const installRequestV1Schema = z
  .object({schemaVersion: z.literal(legacyInstallRequestSchemaVersion), ...commonRequestFields})
  .strict();

export const installRequestV2Schema = z
  .object({
    schemaVersion: z.literal(installRequestSchemaVersion),
    ...commonRequestFields,
    selectedBundles: z
      .array(selectedBundleRequestSchema)
      .max(installRequestLimits.selectedBundles)
      .optional()
  })
  .strict();

export const installRequestSchema = z
  .discriminatedUnion('schemaVersion', [installRequestV1Schema, installRequestV2Schema])
  .superRefine((value, context) => {
    const hasSkills = value.selectedSkills !== undefined;
    const hasBundles = value.schemaVersion === 2 && value.selectedBundles !== undefined;
    const hasExplicitSelection = hasSkills || hasBundles;
    const wantsAllCompatible = value.allCompatible === true;

    if (hasExplicitSelection && wantsAllCompatible) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide explicit selectedSkills/selectedBundles or allCompatible, never both.',
        path: [hasBundles ? 'selectedBundles' : 'selectedSkills']
      });
    }

    if (!hasExplicitSelection && !wantsAllCompatible) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide selectedSkills/selectedBundles (possibly empty) or allCompatible: true.',
        path: ['selectedSkills']
      });
    }
  });

export type InstallRequest = z.infer<typeof installRequestSchema>;

export interface NormalizedSelectedSkill {
  id: string;
  reason?: string;
}

export interface NormalizedSelectedBundle {
  id: string;
}

/** Canonical v2 form used by planning and persisted plan digests. */
export interface NormalizedInstallRequest {
  schemaVersion: typeof installRequestSchemaVersion;
  intent?: string;
  selectionPolicy?: SelectionPolicy;
  targetAgents: string[];
  selectedSkills?: NormalizedSelectedSkill[];
  selectedBundles?: NormalizedSelectedBundle[];
  /** Legacy v1 requests preserve existing bundle roots because they could not express them. */
  bundleSelectionMode: 'preserve' | 'explicit';
  allCompatible: boolean;
  replaceSelection: boolean;
  agentTargetPaths?: Record<string, string>;
}

export function parseInstallRequest(value: unknown): InstallRequest {
  return installRequestSchema.parse(value);
}

/** Normalizes validated v1/v2 input to byte-stable v2; duplicate first-skill reasons win. */
export function normalizeInstallRequest(request: InstallRequest): NormalizedInstallRequest {
  const targetAgents = [...new Set(request.targetAgents)].sort((left, right) => left.localeCompare(right));
  const intent = request.intent?.trim();
  const agentTargetPaths = normalizeAgentTargetPaths(request.agentTargetPaths);
  const allCompatible = request.allCompatible === true;

  return {
    schemaVersion: installRequestSchemaVersion,
    ...(intent === undefined || intent === '' ? {} : {intent}),
    ...(request.selectionPolicy === undefined ? {} : {selectionPolicy: request.selectionPolicy}),
    targetAgents,
    ...(allCompatible
      ? {}
      : {
          selectedSkills: normalizeSelectedSkills(request.selectedSkills ?? []),
          selectedBundles: normalizeSelectedBundles(
            request.schemaVersion === 2 ? (request.selectedBundles ?? []) : []
          )
        }),
    bundleSelectionMode: request.schemaVersion === 1 ? 'preserve' : 'explicit',
    allCompatible,
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
    if (id === '' || byId.has(id)) continue;
    const reason = selected.reason?.trim();
    byId.set(id, {id, ...(reason === undefined || reason === '' ? {} : {reason})});
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeSelectedBundles(
  selectedBundles: ReadonlyArray<{id: string}>
): NormalizedSelectedBundle[] {
  return [...new Set(selectedBundles.map((selected) => selected.id.trim()).filter((id) => id !== ''))]
    .sort((left, right) => left.localeCompare(right))
    .map((id) => ({id}));
}

function normalizeAgentTargetPaths(
  agentTargetPaths: Record<string, string | undefined> | undefined
): Record<string, string> | undefined {
  if (agentTargetPaths === undefined) return undefined;

  const entries = Object.entries(agentTargetPaths)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1].trim() !== '')
    .map(([agentId, targetPath]): [string, string] => [agentId, targetPath.trim()])
    .sort(([left], [right]) => left.localeCompare(right));

  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

export interface InstallRequestFlags {
  agents?: string[];
  skills?: string[];
  bundles?: string[];
  reasons?: Record<string, string>;
  allCompatible?: boolean;
  replaceSelection?: boolean;
  intent?: string;
  selectionPolicy?: string;
  agentTargetPaths?: Record<string, string>;
}

/** Builds an unvalidated current-version request; CLI transport and documents share parsing. */
export function installRequestFromFlags(flags: InstallRequestFlags): unknown {
  const skills = flags.skills ?? [];
  const bundles = flags.bundles ?? [];

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
          }),
          selectedBundles: bundles.map((id) => ({id}))
        }),
    ...(flags.replaceSelection === undefined ? {} : {replaceSelection: flags.replaceSelection}),
    ...(flags.agentTargetPaths === undefined ? {} : {agentTargetPaths: flags.agentTargetPaths})
  };
}
