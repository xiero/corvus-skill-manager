import {createHash} from 'node:crypto';
import {z} from 'zod';
import {agentIdSchema, skillReferencePattern} from '../../config/configSchema.js';
import {selectionProvenanceKinds} from '../../skills/selectionModel.js';
import {canonicalJsonStringify} from '../protocol/canonicalJson.js';

/** Version of the persisted plan artifact format. */
export const planSchemaVersion = 3;

export const planKinds = ['skillpack-setup', 'skillpack-update', 'skillpack-remove', 'install'] as const;

export type PlanKind = (typeof planKinds)[number];

export const planKindSchema = z.enum(planKinds);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'Must be a lowercase sha256 hex digest.');

/** `<kind>-<first 32 hex chars of the digest>`; filesystem-safe by construction. */
export const planIdPattern = /^[a-z][a-z0-9-]{0,31}-[a-f0-9]{32}$/;

export const planIdSchema = z.string().regex(planIdPattern, 'Malformed plan id.');

/**
 * A digest over every piece of local state that could invalidate an apply. Components are kept
 * separately so a stale plan can say exactly what drifted rather than just "something changed".
 */
export const stateFingerprintSchema = z
  .object({
    algorithm: z.literal('sha256'),
    value: sha256Schema,
    components: z.record(sha256Schema)
  })
  .strict();

export type StateFingerprint = z.infer<typeof stateFingerprintSchema>;

export function computeStateFingerprint(components: Record<string, unknown>): StateFingerprint {
  const componentDigests = Object.fromEntries(
    Object.entries(components)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, value]): [string, string] => [name, sha256Hex(canonicalJsonStringify(value))])
  );

  return {
    algorithm: 'sha256',
    value: sha256Hex(canonicalJsonStringify(componentDigests)),
    components: componentDigests
  };
}

/** Component names whose digests differ between two fingerprints, in stable order. */
export function diffStateFingerprints(expected: StateFingerprint, actual: StateFingerprint): string[] {
  const names = [...new Set([...Object.keys(expected.components), ...Object.keys(actual.components)])].sort();

  return names.filter((name) => expected.components[name] !== actual.components[name]);
}

export const linkCreateOperationSchema = z
  .object({
    type: z.literal('create-link'),
    agentId: agentIdSchema,
    skillId: z.string().min(1),
    sourcePath: z.string().min(1),
    targetPath: z.string().min(1)
  })
  .strict();

export const linkRemoveOperationSchema = z
  .object({
    type: z.literal('remove-link'),
    agentId: agentIdSchema,
    skillId: z.string().min(1),
    targetPath: z.string().min(1)
  })
  .strict();

export const linkPlanOperationSchema = z.discriminatedUnion('type', [
  linkCreateOperationSchema,
  linkRemoveOperationSchema
]);

export const planIssueSchema = z
  .object({
    severity: z.enum(['warning', 'conflict']),
    code: z.string().min(1),
    message: z.string().min(1),
    agentId: agentIdSchema.optional(),
    skillId: z.string().min(1).optional(),
    path: z.string().min(1).optional()
  })
  .strict();

export type PlanIssue = z.infer<typeof planIssueSchema>;

const rootReferenceListSchema = z
  .array(z.string().regex(skillReferencePattern, 'Use a qualified <skillpack-id>:<local-id> reference.'))
  .transform(uniqueSorted);

export const agentConfigChangeSchema = z
  .object({
    agentId: agentIdSchema,
    enabledFrom: z.boolean(),
    enabledTo: z.boolean(),
    targetPathFrom: z.string().min(1).optional(),
    targetPathTo: z.string().min(1).optional(),
    /** Explicit/root skill selections only; effective link operations remain separate. */
    selectedSkillIdsFrom: rootReferenceListSchema,
    selectedSkillIdsTo: rootReferenceListSchema,
    /** Explicit/root bundle selections only. */
    selectedBundleIdsFrom: rootReferenceListSchema,
    selectedBundleIdsTo: rootReferenceListSchema
  })
  .strict();

export type AgentConfigChange = z.infer<typeof agentConfigChangeSchema>;

export const agentRootSelectionSchema = z
  .object({
    agentId: agentIdSchema,
    selectedSkillIds: rootReferenceListSchema,
    selectedBundleIds: rootReferenceListSchema
  })
  .strict();

export type AgentRootSelection = z.infer<typeof agentRootSelectionSchema>;

export const selectionProvenanceSchema = z
  .object({
    kind: z.enum(selectionProvenanceKinds),
    reason: z.string().min(1)
  })
  .strict();

export const resolvedSkillSelectionSchema = z
  .object({
    agentId: agentIdSchema,
    skillId: z.string().min(1),
    reason: z.string().min(1),
    reasonKind: z.enum(selectionProvenanceKinds),
    origins: z.array(selectionProvenanceSchema).min(1)
  })
  .strict();

export type ResolvedPlanSelection = z.infer<typeof resolvedSkillSelectionSchema>;

export const installPlanSummarySchema = z
  .object({
    creates: z.number().int().nonnegative(),
    removals: z.number().int().nonnegative(),
    alreadySatisfied: z.number().int().nonnegative(),
    bundlesSelected: z.array(z.string().min(1)),
    bundleMembersAdded: z.array(z.string().min(1)),
    dependenciesAdded: z.array(z.string().min(1)),
    effectiveSkills: z.array(z.string().min(1)),
    recommendationsNotSelected: z.array(z.string().min(1)),
    conflicts: z.number().int().nonnegative(),
    riskWarnings: z.number().int().nonnegative(),
    configChanges: z.number().int().nonnegative()
  })
  .strict();

export type InstallPlanSummary = z.infer<typeof installPlanSummarySchema>;

const normalizedSelectedSkillSchema = z
  .object({
    id: z.string().min(1),
    reason: z.string().min(1).optional()
  })
  .strict();

const normalizedSelectedBundleSchema = z.object({id: z.string().min(1)}).strict();

export const normalizedInstallRequestSchema = z
  .object({
    schemaVersion: z.literal(2),
    intent: z.string().min(1).optional(),
    selectionPolicy: z.enum(['minimal', 'balanced', 'complete']).optional(),
    targetAgents: z.array(z.string().min(1)),
    selectedSkills: z.array(normalizedSelectedSkillSchema).optional(),
    selectedBundles: z.array(normalizedSelectedBundleSchema).optional(),
    bundleSelectionMode: z.enum(['preserve', 'explicit']),
    allCompatible: z.boolean(),
    replaceSelection: z.boolean(),
    agentTargetPaths: z.record(z.string().min(1)).optional()
  })
  .strict();

export const installPlanPayloadSchema = z
  .object({
    request: normalizedInstallRequestSchema,
    targetAgents: z.array(agentIdSchema),
    rootSelections: z.array(agentRootSelectionSchema),
    selections: z.array(resolvedSkillSelectionSchema),
    configChanges: z.array(agentConfigChangeSchema),
    operations: z.array(linkPlanOperationSchema),
    conflicts: z.array(planIssueSchema),
    warnings: z.array(planIssueSchema),
    summary: installPlanSummarySchema,
    skillpackCheckoutPath: z.string().min(1),
    skillpackCheckoutPaths: z.array(z.string().min(1)).min(1).optional(),
    managerStateDir: z.string().min(1),
    stateFingerprint: stateFingerprintSchema
  })
  .strict();

export type InstallPlanPayload = z.infer<typeof installPlanPayloadSchema>;

export const skillpackSetupPlanPayloadSchema = z
  .object({
    skillpackId: z.string().min(1),
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1),
    /** The manager-owned `current` link path that will point at the activated revision. */
    activePath: z.string().min(1),
    revisionsPath: z.string().min(1),
    /** Known only when the remote head could be read before cloning. */
    expectedCommitHash: z.string().min(1).optional(),
    expectedRevisionPath: z.string().min(1).optional(),
    managerStateDir: z.string().min(1),
    configPath: z.string().min(1),
    /** True when the active snapshot already exists, making apply an idempotent no-op. */
    alreadyPresent: z.boolean(),
    createsConfig: z.boolean(),
    stateFingerprint: stateFingerprintSchema
  })
  .strict();

export type SkillpackSetupPlanPayload = z.infer<typeof skillpackSetupPlanPayloadSchema>;

export const revisionEntityDeltaSchema = z
  .object({
    id: z.string().min(1),
    change: z.enum(['added', 'removed', 'changed']),
    previousVersion: z.string().min(1).optional(),
    nextVersion: z.string().min(1).optional(),
    versionChange: z.enum(['major', 'minor', 'patch', 'same', 'unknown']),
    breakingRisk: z.boolean()
  })
  .strict();

export const affectedBundleReasonSchema = z
  .object({
    kind: z.enum([
      'bundle-added',
      'bundle-removed',
      'bundle-changed',
      'member-added',
      'member-removed',
      'effective-skill-added',
      'effective-skill-removed',
      'effective-skill-changed'
    ]),
    entityId: z.string().min(1),
    versionChange: z.enum(['major', 'minor', 'patch', 'same', 'unknown']),
    breakingRisk: z.boolean(),
    message: z.string().min(1)
  })
  .strict();

export const affectedBundleUpdateSchema = z
  .object({
    bundleId: z.string().min(1),
    breakingRisk: z.boolean(),
    reasons: z.array(affectedBundleReasonSchema)
  })
  .strict();

export const skillpackUpdatePlanPayloadSchema = z
  .object({
    skillpackId: z.string().min(1),
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1),
    activePath: z.string().min(1),
    activeCommitHash: z.string().min(1),
    remoteCommitHash: z.string().min(1),
    candidateRevisionPath: z.string().min(1),
    addedSkillIds: z.array(z.string().min(1)),
    removedSkillIds: z.array(z.string().min(1)),
    changedSkillIds: z.array(z.string().min(1)),
    changedFiles: z.array(z.string().min(1)),
    /** Optional only so pre-Phase-8 plan-schema-v3 artifacts retain byte-identical payloads. */
    skillDeltas: z.array(revisionEntityDeltaSchema).optional(),
    bundleDeltas: z.array(revisionEntityDeltaSchema).optional(),
    affectedBundles: z.array(affectedBundleUpdateSchema).optional(),
    managerStateDir: z.string().min(1),
    stateFingerprint: stateFingerprintSchema
  })
  .strict();

export type SkillpackUpdatePlanPayload = z.infer<typeof skillpackUpdatePlanPayloadSchema>;

export const skillpackRemovePlanPayloadSchema = z
  .object({
    skillpackId: z.string().min(1),
    repositoryUrl: z.string().min(1),
    activePath: z.string().min(1),
    configPath: z.string().min(1),
    managerStateDir: z.string().min(1),
    stateFingerprint: stateFingerprintSchema
  })
  .strict();

export type SkillpackRemovePlanPayload = z.infer<typeof skillpackRemovePlanPayloadSchema>;

const planBaseShape = {
  planSchemaVersion: z.literal(planSchemaVersion),
  planId: planIdSchema,
  digest: sha256Schema,
  /** Audit metadata only. Deliberately excluded from the digest payload. */
  createdAt: z.string().datetime(),
  requiresConfirmation: z.literal(true)
};

export const persistedPlanSchema = z.discriminatedUnion('kind', [
  z.object({...planBaseShape, kind: z.literal('install'), payload: installPlanPayloadSchema}).strict(),
  z
    .object({...planBaseShape, kind: z.literal('skillpack-setup'), payload: skillpackSetupPlanPayloadSchema})
    .strict(),
  z
    .object({...planBaseShape, kind: z.literal('skillpack-update'), payload: skillpackUpdatePlanPayloadSchema})
    .strict(),
  z
    .object({...planBaseShape, kind: z.literal('skillpack-remove'), payload: skillpackRemovePlanPayloadSchema})
    .strict()
]);

export type PersistedPlan = z.infer<typeof persistedPlanSchema>;
export type InstallPlanArtifact = Extract<PersistedPlan, {kind: 'install'}>;
export type SkillpackSetupPlanArtifact = Extract<PersistedPlan, {kind: 'skillpack-setup'}>;
export type SkillpackUpdatePlanArtifact = Extract<PersistedPlan, {kind: 'skillpack-update'}>;
export type SkillpackRemovePlanArtifact = Extract<PersistedPlan, {kind: 'skillpack-remove'}>;

/**
 * The digest covers exactly `{planSchemaVersion, kind, payload}`. `createdAt`, `planId`, and
 * `digest` itself are excluded, so two runs against identical state and an identical request
 * produce an identical digest.
 */
export function computePlanDigest(kind: PlanKind, payload: unknown): string {
  return sha256Hex(canonicalJsonStringify({planSchemaVersion, kind, payload}));
}

export function planIdFromDigest(kind: PlanKind, digest: string): string {
  return `${kind}-${digest.slice(0, 32)}`;
}

export interface CreatePlanOptions<TKind extends PlanKind, TPayload> {
  kind: TKind;
  payload: TPayload;
  now: Date;
}

export function createPlanArtifact<TKind extends PlanKind, TPayload>(
  options: CreatePlanOptions<TKind, TPayload>
): {
  planSchemaVersion: typeof planSchemaVersion;
  kind: TKind;
  planId: string;
  digest: string;
  createdAt: string;
  requiresConfirmation: true;
  payload: TPayload;
} {
  const digest = computePlanDigest(options.kind, options.payload);

  return {
    planSchemaVersion,
    kind: options.kind,
    planId: planIdFromDigest(options.kind, digest),
    digest,
    createdAt: options.now.toISOString(),
    requiresConfirmation: true,
    payload: options.payload
  };
}

/** True when the stored digest still matches the stored payload (i.e. the file is untampered). */
export function planDigestMatches(plan: PersistedPlan): boolean {
  return computePlanDigest(plan.kind, plan.payload) === plan.digest &&
    planIdFromDigest(plan.kind, plan.digest) === plan.planId;
}

export function parsePersistedPlan(value: unknown): PersistedPlan {
  return persistedPlanSchema.parse(value);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
