import path from 'node:path';
import type {AgentId} from '../../agents/AgentAdapter.js';
import {getAgentAdapters} from '../../agents/adapters.js';
import type {AgentConfig, ManagerConfig} from '../../config/configSchema.js';
import {saveConfig} from '../../config/configStore.js';
import {type ApplyActionResult, applyLinkPlan} from '../../links/applyEngine.js';
import type {LinkPlan, LinkPlanOperation} from '../../links/linkPlan.js';
import type {ManagerManifest} from '../../manifest/manifestSchema.js';
import {loadManifestOrDefault} from '../../manifest/manifestStore.js';
import {isPathInside, resolveUserPath} from '../../paths.js';
import {inspectLinkTarget, type ReportContext} from '../../reports/reportInternals.js';
import type {DiscoveredSkill} from '../../skills/skillDiscovery.js';
import {isPrecondition, loadContext, requireReadySkillpack} from '../context.js';
import {
  type InstallPlanPayload,
  type InstallPlanSummary,
  computeStateFingerprint,
  createPlanArtifact,
  installPlanPayloadSchema
} from '../plans/planSchema.js';
import {loadConfirmedPlan, requireFreshState} from '../plans/planGuards.js';
import {loadPlan, savePlan} from '../plans/planStore.js';
import type {ApplicationEnvironment} from '../ports.js';
import {
  type MachineError,
  type MachineWarning,
  createMachineError,
  createMachineWarning
} from '../protocol/errors.js';
import {type NextAction, createNextAction} from '../protocol/nextActions.js';
import {type UseCaseResult, fail, failWith, succeed} from '../protocol/result.js';
import {
  type AgentPlanInput,
  buildInstallLinkPlan,
  resolveSelections,
  toPlanIssues,
  uniqueSorted
} from '../install/installPlanner.js';
import {
  type InstallRequest,
  type NormalizedInstallRequest,
  normalizeInstallRequest,
  parseInstallRequest
} from '../install/installRequest.js';

export interface InstallPlanData {
  planId?: string;
  digest?: string;
  requiresConfirmation: boolean;
  planPath?: string;
  plan: InstallPlanPayload;
}

export type InstallOperationStatus = 'applied' | 'already-satisfied' | 'skipped' | 'blocked' | 'failed';

export interface InstallOperationResult {
  type: LinkPlanOperation['type'];
  agentId: AgentId;
  skillId: string;
  targetPath: string;
  status: InstallOperationStatus;
  code: string;
  message: string;
}

export type InstallApplyStatus = 'applied' | 'already-satisfied' | 'partially-applied';

export interface InstallApplyData {
  planId: string;
  status: InstallApplyStatus;
  configChanged: boolean;
  manifestPath: string;
  operations: InstallOperationResult[];
}

export type InstallVerifyStatus =
  | 'verified'
  | 'verified-no-op'
  | 'partially-applied'
  | 'drift-detected'
  | 'blocked';

export interface InstallVerifyCheck {
  kind: 'link' | 'removal' | 'config' | 'dependency';
  agentId?: AgentId;
  skillId?: string;
  targetPath?: string;
  satisfied: boolean;
  code: string;
  message: string;
}

export interface InstallVerifyData {
  planId: string;
  status: InstallVerifyStatus;
  checks: InstallVerifyCheck[];
  blockingDoctorIssueCodes: string[];
}

/**
 * Builds one complete installation plan from the calling agent's exact selection.
 *
 * Planning is read-only apart from writing the manager-owned plan artifact. Any blocking
 * problem — unknown skill, unsupported skill/agent pair, declared skill conflict, or an
 * unmanaged target in the way — fails the command instead of being silently dropped, and no
 * plan artifact is persisted so nothing unreviewable can later be applied.
 */
export async function installPlanUseCase(
  environment: ApplicationEnvironment,
  requestInput: unknown
): Promise<UseCaseResult<InstallPlanData>> {
  let request: InstallRequest;

  try {
    request = parseInstallRequest(requestInput);
  } catch (error) {
    return failWith(
      createMachineError('INVALID_REQUEST', formatRequestError(error), {field: 'request'}),
      {
        nextActions: [
          createNextAction(
            'read-capabilities',
            'Inspect the request schema advertised by the binary.',
            'corvus-skills capabilities --json'
          )
        ]
      }
    );
  }

  const normalizedRequest = normalizeInstallRequest(request);
  const context = await loadContext(environment);
  const ready = requireReadySkillpack(context);

  if (isPrecondition(ready)) {
    return fail([ready.error], {nextActions: ready.nextActions});
  }

  const unavailableSkillpacks = context.skillpacks.filter(
    (item) => !item.checkout.readable || item.discovery === undefined
  );
  if (normalizedRequest.allCompatible && unavailableSkillpacks.length > 0) {
    return failWith(
      createMachineError(
        'SKILLPACK_NOT_READY',
        `allCompatible requires every configured skillpack to be readable; unavailable: ${unavailableSkillpacks.map((item) => item.config.id).join(', ')}.`,
        {details: {skillpackIds: unavailableSkillpacks.map((item) => item.config.id)}}
      ),
      {nextActions: [createNextAction('run-doctor', 'Inspect unavailable skillpacks.', 'corvus-skills doctor --json')]}
    );
  }

  const adapters = getAgentAdapters();
  const resolved = resolveSelections({
    request: normalizedRequest,
    adapters,
    skills: ready.discovery.skills,
    config: context.config,
    homeDir: environment.homeDir
  });

  if (resolved.errors.length > 0) {
    return fail(resolved.errors, {nextActions: [listSkillsAction()]});
  }

  const built = await buildInstallLinkPlan({
    agents: resolved.agents,
    adapters,
    skills: ready.discovery.skills,
    manifest: context.manifest,
    homeDir: environment.homeDir
  });
  const summary = summarize({
    linkPlan: built.linkPlan,
    configChangeCount: built.configChanges.length,
    dependenciesAdded: resolved.dependenciesAdded,
    recommendationsNotSelected: resolved.recommendationsNotSelected,
    skills: ready.discovery.skills,
    agents: resolved.agents
  });
  const payload: InstallPlanPayload = installPlanPayloadSchema.parse({
    request: normalizedRequest,
    targetAgents: resolved.agents.map((agent) => agent.adapter.id),
    selections: built.selections,
    configChanges: built.configChanges,
    operations: built.linkPlan.operations,
    conflicts: toPlanIssues(built.linkPlan.conflicts),
    warnings: toPlanIssues(built.linkPlan.warnings),
    summary,
    skillpackCheckoutPath: ready.skillpack.checkoutPath,
    skillpackCheckoutPaths: context.skillpacks.map((item) => item.config.checkoutPath),
    managerStateDir: context.config?.managerStateDir ?? environment.managerStateDir,
    stateFingerprint: fingerprintFor({
      context,
      agents: resolved.agents,
      skills: ready.discovery.skills,
      operations: built.linkPlan.operations,
      homeDir: environment.homeDir
    })
  });

  const planWarnings = built.linkPlan.warnings.map((warning) =>
    createMachineWarning(warning.code, warning.message, {
      ...(warning.agentId === undefined ? {} : {agentId: warning.agentId}),
      ...(warning.skillId === undefined ? {} : {skillId: warning.skillId}),
      ...(warning.path === undefined ? {} : {path: warning.path})
    })
  );

  if (built.linkPlan.conflicts.length > 0) {
    return fail(
      built.linkPlan.conflicts.map((conflict) =>
        createMachineError(
          conflict.code === 'skill-target-name-conflict'
            ? 'SKILL_TARGET_NAME_CONFLICT'
            : 'UNMANAGED_TARGET_EXISTS',
          conflict.message,
          {
          ...(conflict.path === undefined ? {} : {path: conflict.path}),
          ...(conflict.agentId === undefined ? {} : {agentId: conflict.agentId}),
          ...(conflict.skillId === undefined ? {} : {skillId: conflict.skillId})
          }
        )
      ),
      {
        data: {plan: payload, requiresConfirmation: false},
        warnings: planWarnings,
        nextActions: [
          createNextAction(
            'resolve-unmanaged-target',
            'Move or remove the unmanaged target yourself, or drop that skill, then plan again.'
          )
        ]
      }
    );
  }

  const plan = createPlanArtifact({kind: 'install', payload, now: environment.now()});
  const planPath = await savePlan(environment.plansDir, plan);

  return succeed(
    {planId: plan.planId, digest: plan.digest, requiresConfirmation: true, planPath, plan: payload},
    {
      warnings: [
        ...unavailableSkillpacks.map((item) =>
          createMachineWarning(
            'skillpack-not-ready',
            `Skillpack "${item.config.id}" was excluded because its active snapshot is not readable.`,
            {path: item.config.checkoutPath}
          )
        ),
        ...planWarnings,
        ...riskWarningsFor(ready.discovery.skills, resolved.agents),
        ...resolved.recommendationsNotSelected.map((skillId) =>
          createMachineWarning(
            'recommendation-not-selected',
            `Skill "${skillId}" is recommended by a selected skill but was not selected; recommendations are never installed automatically.`,
            {skillId}
          )
        )
      ],
      nextActions: [
        createNextAction(
          'apply-install-plan',
          'Apply the reviewed plan with the exact confirmation token.',
          `corvus-skills install apply --plan-id ${plan.planId} --confirm ${plan.planId} --json`
        )
      ]
    }
  );
}

export interface InstallApplyOptions {
  planId: string;
  confirm: string;
  /** Opt-in replacement of a broken manager-owned link. Never implied by `--json`. */
  confirmReplaceBrokenManagedLinks?: boolean;
}

/**
 * Applies exactly the persisted plan.
 *
 * Ordering is: link operations first (each updating manifest ownership), then the config
 * mutation, and the config records only the skills whose links actually ended up in place. A
 * partial failure therefore leaves consistent, visible state rather than a config that claims
 * links which do not exist.
 */
export async function installApplyUseCase(
  environment: ApplicationEnvironment,
  options: InstallApplyOptions
): Promise<UseCaseResult<InstallApplyData>> {
  const loadedPlan = await loadConfirmedPlan({
    plansDir: environment.plansDir,
    planId: options.planId,
    confirm: options.confirm,
    kind: 'install',
    regenerateCommand: 'install plan'
  });

  if (isPrecondition(loadedPlan)) {
    return fail([loadedPlan.error], {nextActions: loadedPlan.nextActions});
  }

  if (loadedPlan.kind !== 'install') {
    return failWith(createMachineError('PLAN_NOT_FOUND', 'Plan kind mismatch.'));
  }

  const payload = loadedPlan.payload;
  const context = await loadContext(environment);
  const ready = requireReadySkillpack(context);

  if (isPrecondition(ready)) {
    return fail([ready.error], {nextActions: ready.nextActions});
  }

  const satisfaction = await evaluatePlanSatisfaction(payload, context, environment);

  if (satisfaction.fullySatisfied) {
    return succeed<InstallApplyData>(
      {
        planId: options.planId,
        status: 'already-satisfied',
        configChanged: false,
        manifestPath: context.manifestPath,
        operations: satisfaction.operations
      },
      {
        changed: false,
        nextActions: [verifyAction(options.planId)]
      }
    );
  }

  const driftedAgents = reconcileAgentSelections(payload, context);

  if (driftedAgents.length > 0) {
    return fail(
      [
        createMachineError(
          'STALE_PLAN',
          `Agent selection changed after plan ${options.planId} was generated (${driftedAgents.join(', ')}).`,
          {details: {planId: options.planId, changedComponents: ['config'], agents: driftedAgents}}
        )
      ],
      {
        nextActions: [
          createNextAction(
            'regenerate-plan',
            'Regenerate the plan against current state, review it, then apply the new plan id.',
            'corvus-skills install plan --json'
          )
        ]
      }
    );
  }

  const staleness = requireFreshState({
    planId: options.planId,
    expected: payload.stateFingerprint,
    actual: fingerprintFor({
      context,
      agents: agentInputsFromPayload(payload, context),
      skills: ready.discovery.skills,
      operations: payload.operations,
      homeDir: environment.homeDir
    }),
    regenerateCommand: 'install plan'
  });

  if (staleness !== undefined) {
    return fail([staleness.error], {nextActions: staleness.nextActions});
  }

  const applyResult = await applyLinkPlan({
    plan: {operations: payload.operations, conflicts: [], warnings: []} satisfies LinkPlan,
    skillpackCheckoutPath: payload.skillpackCheckoutPath,
    ...(payload.skillpackCheckoutPaths === undefined ? {} : {skillpackCheckoutPaths: payload.skillpackCheckoutPaths}),
    homeDir: environment.homeDir,
    managerStateDir: payload.managerStateDir,
    now: environment.now(),
    confirmReplaceBrokenManagedLinks: options.confirmReplaceBrokenManagedLinks ?? false
  });
  const operations = [
    ...applyResult.applied,
    ...applyResult.skipped,
    ...applyResult.planned
  ]
    .map((action) => toOperationResult(action))
    .sort(
      (left, right) =>
        left.agentId.localeCompare(right.agentId) ||
        left.skillId.localeCompare(right.skillId) ||
        left.type.localeCompare(right.type)
    );
  const linkedSkillIdsByAgent = collectLinkedSkills(payload, operations);
  const configChanged = await persistSelections({
    environment,
    config: context.config,
    payload,
    linkedSkillIdsByAgent
  });
  const blocked = operations.filter((operation) => operation.status === 'blocked');
  const failed = operations.filter((operation) => operation.status === 'failed');
  const applied = operations.filter((operation) => operation.status === 'applied');
  const status: InstallApplyStatus =
    blocked.length > 0 || failed.length > 0 ? 'partially-applied' : applied.length > 0 || configChanged ? 'applied' : 'already-satisfied';
  const data: InstallApplyData = {
    planId: options.planId,
    status,
    configChanged,
    manifestPath: applyResult.manifestPath,
    operations
  };
  const needsConfirmation = operations.filter(
    (operation) => operation.code === 'broken-managed-link-needs-confirmation'
  );
  const warnings = needsConfirmation.map((operation) =>
    createMachineWarning(operation.code, operation.message, {
      path: operation.targetPath,
      agentId: operation.agentId,
      skillId: operation.skillId
    })
  );

  if (blocked.length > 0 || failed.length > 0) {
    return fail(
      [
        ...blocked.map((operation) =>
          createMachineError('UNMANAGED_TARGET_EXISTS', operation.message, {
            path: operation.targetPath,
            agentId: operation.agentId,
            skillId: operation.skillId
          })
        ),
        ...failed.map((operation) =>
          createMachineError('EXTERNAL_OPERATION_FAILED', operation.message, {
            path: operation.targetPath,
            agentId: operation.agentId,
            skillId: operation.skillId
          })
        )
      ],
      {
        changed: applied.length > 0 || configChanged,
        data: data as unknown as Record<string, unknown>,
        warnings,
        nextActions: [
          createNextAction(
            'resolve-unmanaged-target',
            'Resolve the reported targets manually, then regenerate and re-apply a plan.'
          ),
          verifyAction(options.planId)
        ]
      }
    );
  }

  return succeed(data, {
    changed: applied.length > 0 || configChanged,
    warnings,
    nextActions: [
      ...(needsConfirmation.length === 0
        ? []
        : [
            createNextAction(
              'confirm-broken-link-replacement',
              'Re-apply with explicit confirmation to replace broken manager-owned links.',
              `corvus-skills install apply --plan-id ${options.planId} --confirm ${options.planId} --replace-broken-links --json`
            )
          ]),
      verifyAction(options.planId)
    ]
  });
}

/** Strictly read-only proof that a plan reached the filesystem and config it described. */
export async function installVerifyUseCase(
  environment: ApplicationEnvironment,
  options: {planId: string}
): Promise<UseCaseResult<InstallVerifyData>> {
  const loaded = await loadPlan(environment.plansDir, options.planId);

  if (loaded.status !== 'loaded') {
    return failWith(
      createMachineError(
        loaded.status === 'digest-mismatch' ? 'PLAN_DIGEST_MISMATCH' : 'PLAN_NOT_FOUND',
        loaded.status === 'digest-mismatch'
          ? `Stored plan ${options.planId} no longer matches its digest.`
          : `No plan stored for id ${options.planId}.`,
        {path: loaded.planPath}
      ),
      {nextActions: [createNextAction('regenerate-plan', 'Generate a new plan.', 'corvus-skills install plan --json')]}
    );
  }

  if (loaded.plan.kind !== 'install') {
    return failWith(
      createMachineError('PLAN_NOT_FOUND', `Plan ${options.planId} is not an install plan.`, {
        path: loaded.planPath
      })
    );
  }

  const payload = loaded.plan.payload;
  const context = await loadContext(environment);
  const checks: InstallVerifyCheck[] = [];
  let blocked = false;
  let drift = false;
  let missing = 0;
  let satisfiedLinks = 0;

  for (const operation of payload.operations) {
    if (operation.type === 'create-link') {
      const targetPath = resolveUserPath(operation.targetPath, environment.homeDir);
      const manifestEntry = context.manifest.links[targetPath];
      const inspection = await inspectLinkTarget(targetPath);

      if (inspection.kind === 'missing') {
        missing += 1;
        checks.push(linkCheck(operation, targetPath, false, 'missing-managed-link', 'Expected manager-owned link is missing.'));
        continue;
      }

      if (inspection.kind === 'not-link') {
        blocked = true;
        checks.push(linkCheck(operation, targetPath, false, 'unmanaged-target-exists', 'Target exists but is not a link.'));
        continue;
      }

      if (manifestEntry === undefined) {
        blocked = true;
        checks.push(linkCheck(operation, targetPath, false, 'not-manager-owned', 'Link exists but is not recorded as manager-owned.'));
        continue;
      }

      if (
        manifestEntry.agentId !== operation.agentId ||
        manifestEntry.skillId !== operation.skillId ||
        manifestEntry.sourcePath !== resolveUserPath(operation.sourcePath, environment.homeDir)
      ) {
        drift = true;
        checks.push(linkCheck(operation, targetPath, false, 'manifest-mismatch', 'Manifest ownership does not match the plan.'));
        continue;
      }

      if (inspection.broken || inspection.resolvedSourcePath !== manifestEntry.sourcePath) {
        drift = true;
        checks.push(linkCheck(operation, targetPath, false, 'link-target-mismatch', 'Link does not resolve to the recorded source.'));
        continue;
      }

      const checkoutPaths = payload.skillpackCheckoutPaths ?? [payload.skillpackCheckoutPath];
      if (!checkoutPaths.some((checkoutPath) => isPathInside(checkoutPath, manifestEntry.sourcePath))) {
        drift = true;
        checks.push(
          linkCheck(operation, targetPath, false, 'source-outside-skillpack', 'Link source is outside configured active skillpack snapshots.')
        );
        continue;
      }

      satisfiedLinks += 1;
      checks.push(linkCheck(operation, targetPath, true, 'managed-link-present', 'Manager-owned link resolves to the active skillpack.'));
      continue;
    }

    const targetPath = resolveUserPath(operation.targetPath, environment.homeDir);
    const inspection = await inspectLinkTarget(targetPath);
    const removed = inspection.kind === 'missing' && context.manifest.links[targetPath] === undefined;

    if (!removed) {
      missing += 1;
    } else {
      satisfiedLinks += 1;
    }

    checks.push({
      kind: 'removal',
      agentId: operation.agentId,
      skillId: operation.skillId,
      targetPath,
      satisfied: removed,
      code: removed ? 'managed-link-removed' : 'planned-removal-outstanding',
      message: removed ? 'Planned removal is complete.' : 'Planned removal has not happened yet.'
    });
  }

  for (const configChange of payload.configChanges) {
    const agentConfig: AgentConfig | undefined = context.config?.agents?.[configChange.agentId];
    const actualSkills = uniqueSorted(agentConfig?.selectedSkillIds ?? []);
    const expectedSkills = uniqueSorted(configChange.selectedSkillIdsTo);
    const actualBundles = uniqueSorted(agentConfig?.selectedBundleIds ?? []);
    const expectedBundles = uniqueSorted(configChange.selectedBundleIdsTo);
    const satisfied =
      agentConfig?.enabled === true &&
      sameIds(actualSkills, expectedSkills) &&
      sameIds(actualBundles, expectedBundles);

    if (!satisfied) {
      drift = true;
    }

    checks.push({
      kind: 'config',
      agentId: configChange.agentId,
      satisfied,
      code: satisfied ? 'config-selection-matches' : 'config-selection-mismatch',
      message: satisfied
        ? 'Config records the expected root selection for this agent.'
        : `Config root selection for ${configChange.agentId} does not match the plan.`
    });
  }

  for (const selection of payload.selections.filter((entry) => entry.reasonKind === 'dependency-of')) {
    const manifestEntry = Object.values(context.manifest.links).find(
      (entry) => entry.agentId === selection.agentId && entry.skillId === selection.skillId
    );
    const inspection = manifestEntry === undefined ? undefined : await inspectLinkTarget(manifestEntry.targetPath);
    const satisfied =
      manifestEntry !== undefined &&
      inspection?.kind === 'link' &&
      !inspection.broken &&
      inspection.resolvedSourcePath === manifestEntry.sourcePath;

    if (!satisfied) {
      drift = true;
    }

    checks.push({
      kind: 'dependency',
      agentId: selection.agentId,
      skillId: selection.skillId,
      satisfied,
      code: satisfied ? 'dependency-installed' : 'dependency-missing',
      message: satisfied
        ? `Required dependency ${selection.skillId} is linked (${selection.reason}).`
        : `Required dependency ${selection.skillId} is not linked (${selection.reason}).`
    });
  }

  const affectedTargets = new Set(
    payload.operations.map((operation) => resolveUserPath(operation.targetPath, environment.homeDir))
  );
  const blockingDoctorIssueCodes = uniqueSorted(
    (context.plan?.conflicts ?? [])
      .filter((conflict) => conflict.path !== undefined && affectedTargets.has(conflict.path))
      .map((conflict) => conflict.code)
  );

  if (blockingDoctorIssueCodes.length > 0) {
    blocked = true;
  }

  const isNoOp = payload.operations.length === 0 && payload.configChanges.length === 0;
  const status: InstallVerifyStatus = blocked
    ? 'blocked'
    : missing > 0 && satisfiedLinks > 0
      ? 'partially-applied'
      : missing > 0
        ? 'partially-applied'
        : drift
          ? 'drift-detected'
          : isNoOp
            ? 'verified-no-op'
            : 'verified';

  return succeed(
    {planId: options.planId, status, checks, blockingDoctorIssueCodes},
    {nextActions: verifyNextActions(status, options.planId)}
  );
}

function verifyNextActions(status: InstallVerifyStatus, planId: string): NextAction[] {
  if (status === 'verified' || status === 'verified-no-op') {
    return [];
  }

  if (status === 'blocked') {
    return [
      createNextAction(
        'resolve-unmanaged-target',
        'Resolve the unmanaged targets manually; verify never repairs anything.'
      ),
      createNextAction('run-doctor', 'Inspect the full diagnosis.', 'corvus-skills doctor --json')
    ];
  }

  if (status === 'partially-applied') {
    return [
      createNextAction(
        'reapply-plan',
        'Re-apply the plan to complete the outstanding operations.',
        `corvus-skills install apply --plan-id ${planId} --confirm ${planId} --json`
      ),
      createNextAction('run-doctor', 'Inspect the full diagnosis.', 'corvus-skills doctor --json')
    ];
  }

  return [
    createNextAction(
      'regenerate-plan',
      'Local state drifted from the plan; regenerate a plan against current state.',
      'corvus-skills install plan --json'
    ),
    createNextAction('run-doctor', 'Inspect the full diagnosis.', 'corvus-skills doctor --json')
  ];
}

function linkCheck(
  operation: LinkPlanOperation,
  targetPath: string,
  satisfied: boolean,
  code: string,
  message: string
): InstallVerifyCheck {
  return {
    kind: 'link',
    agentId: operation.agentId,
    skillId: operation.skillId,
    targetPath,
    satisfied,
    code,
    message
  };
}

interface PlanSatisfaction {
  fullySatisfied: boolean;
  operations: InstallOperationResult[];
}

/**
 * Detects an already-applied plan before the staleness check runs. Without this, a successful
 * apply would make its own plan look stale on a second run, instead of the required idempotent
 * no-op.
 */
async function evaluatePlanSatisfaction(
  payload: InstallPlanPayload,
  context: ReportContext,
  environment: ApplicationEnvironment
): Promise<PlanSatisfaction> {
  const operations: InstallOperationResult[] = [];
  let fullySatisfied = true;

  for (const operation of payload.operations) {
    const targetPath = resolveUserPath(operation.targetPath, environment.homeDir);
    const manifestEntry = context.manifest.links[targetPath];
    const inspection = await inspectLinkTarget(targetPath);

    if (operation.type === 'create-link') {
      const satisfied =
        inspection.kind === 'link' &&
        !inspection.broken &&
        manifestEntry !== undefined &&
        manifestEntry.agentId === operation.agentId &&
        manifestEntry.skillId === operation.skillId &&
        manifestEntry.sourcePath === resolveUserPath(operation.sourcePath, environment.homeDir) &&
        inspection.resolvedSourcePath === manifestEntry.sourcePath;

      fullySatisfied &&= satisfied;
      operations.push({
        type: operation.type,
        agentId: operation.agentId,
        skillId: operation.skillId,
        targetPath,
        status: satisfied ? 'already-satisfied' : 'skipped',
        code: satisfied ? 'managed-link-already-present' : 'not-yet-applied',
        message: satisfied ? `Managed link already exists: ${targetPath}` : `Not applied yet: ${targetPath}`
      });
      continue;
    }

    const satisfied = inspection.kind === 'missing' && manifestEntry === undefined;
    fullySatisfied &&= satisfied;
    operations.push({
      type: operation.type,
      agentId: operation.agentId,
      skillId: operation.skillId,
      targetPath,
      status: satisfied ? 'already-satisfied' : 'skipped',
      code: satisfied ? 'managed-link-already-removed' : 'not-yet-applied',
      message: satisfied ? `Managed link already removed: ${targetPath}` : `Not removed yet: ${targetPath}`
    });
  }

  for (const configChange of payload.configChanges) {
    const agentConfig: AgentConfig | undefined = context.config?.agents?.[configChange.agentId];
    const actualSkills = uniqueSorted(agentConfig?.selectedSkillIds ?? []);
    const expectedSkills = uniqueSorted(configChange.selectedSkillIdsTo);
    const actualBundles = uniqueSorted(agentConfig?.selectedBundleIds ?? []);
    const expectedBundles = uniqueSorted(configChange.selectedBundleIdsTo);

    fullySatisfied &&=
      agentConfig?.enabled === configChange.enabledTo &&
      (agentConfig?.targetPath ?? configChange.targetPathTo) === configChange.targetPathTo &&
      sameIds(actualSkills, expectedSkills) &&
      sameIds(actualBundles, expectedBundles);
  }

  return {fullySatisfied, operations};
}

function toOperationResult(action: ApplyActionResult): InstallOperationResult {
  const targetPath = action.operation.targetPath;
  const status = operationStatusFor(action);

  return {
    type: action.operation.type,
    agentId: action.operation.agentId,
    skillId: action.operation.skillId,
    targetPath,
    status,
    code: action.code,
    message: action.message
  };
}

const alreadySatisfiedCodes = new Set(['managed-link-already-present', 'removed-stale-manifest-entry']);
const blockedCodes = new Set([
  'unmanaged-file-exists',
  'unmanaged-directory-exists',
  'unmanaged-symlink-exists',
  'manifest-mismatch',
  'not-manager-owned',
  'target-is-not-link',
  'link-target-mismatch'
]);
const failedCodes = new Set(['missing-source', 'source-outside-skillpack']);

function operationStatusFor(action: ApplyActionResult): InstallOperationStatus {
  if (action.status === 'applied') {
    return alreadySatisfiedCodes.has(action.code) ? 'already-satisfied' : 'applied';
  }

  if (alreadySatisfiedCodes.has(action.code)) {
    return 'already-satisfied';
  }

  if (blockedCodes.has(action.code)) {
    return 'blocked';
  }

  if (failedCodes.has(action.code)) {
    return 'failed';
  }

  return 'skipped';
}

/** Skills whose link is actually in place after apply, per agent. */
function collectLinkedSkills(
  payload: InstallPlanPayload,
  operations: readonly InstallOperationResult[]
): Map<AgentId, Set<string>> {
  const byAgent = new Map<AgentId, Set<string>>();

  for (const configChange of payload.configChanges) {
    byAgent.set(configChange.agentId, new Set(configChange.selectedSkillIdsTo));
  }

  for (const operation of operations) {
    const skillIds = byAgent.get(operation.agentId);

    if (skillIds === undefined) {
      continue;
    }

    if (operation.type === 'create-link' && (operation.status === 'blocked' || operation.status === 'failed' || operation.status === 'skipped')) {
      skillIds.delete(operation.skillId);
    }
  }

  return byAgent;
}

async function persistSelections(options: {
  environment: ApplicationEnvironment;
  config: ManagerConfig | undefined;
  payload: InstallPlanPayload;
  linkedSkillIdsByAgent: Map<AgentId, Set<string>>;
}): Promise<boolean> {
  if (options.payload.configChanges.length === 0 || options.config === undefined) {
    return false;
  }

  const agents: Record<string, AgentConfig> = {...(options.config.agents ?? {})};
  let changed = false;

  for (const configChange of options.payload.configChanges) {
    const existing = agents[configChange.agentId];
    const selectedSkillIds = uniqueSorted([
      ...(options.linkedSkillIdsByAgent.get(configChange.agentId) ?? new Set(configChange.selectedSkillIdsTo))
    ]);
    const nextAgentConfig: AgentConfig = {
      enabled: configChange.enabledTo,
      ...(configChange.targetPathTo === undefined ? {} : {targetPath: configChange.targetPathTo}),
      selectedSkillIds,
      selectedBundleIds: uniqueSorted(configChange.selectedBundleIdsTo)
    };

    if (
      existing?.enabled === nextAgentConfig.enabled &&
      existing.targetPath === nextAgentConfig.targetPath &&
      existing.selectedSkillIds.length === selectedSkillIds.length &&
      existing.selectedSkillIds.every((skillId, index) => selectedSkillIds[index] === skillId) &&
      sameIds(existing.selectedBundleIds, nextAgentConfig.selectedBundleIds)
    ) {
      continue;
    }

    agents[configChange.agentId] = nextAgentConfig;
    changed = true;
  }

  if (!changed) {
    return false;
  }

  await saveConfig(
    {...options.config, updatedAt: options.environment.now().toISOString(), agents},
    {configPath: options.environment.configPath}
  );

  return true;
}

function agentInputsFromPayload(payload: InstallPlanPayload, context: ReportContext): AgentPlanInput[] {
  const adapters = new Map(getAgentAdapters().map((adapter) => [adapter.id, adapter]));

  return payload.configChanges.flatMap((configChange): AgentPlanInput[] => {
    const adapter = adapters.get(configChange.agentId);

    if (adapter === undefined) {
      return [];
    }

    const agentConfig: AgentConfig | undefined = context.config?.agents?.[configChange.agentId];

    return [
      {
        adapter,
        targetPath: configChange.targetPathTo ?? adapter.defaultTargetPath ?? '',
        previousSelectedSkillIds: uniqueSorted(agentConfig?.selectedSkillIds ?? []),
        previousSelectedBundleIds: uniqueSorted(agentConfig?.selectedBundleIds ?? []),
        previousEffectiveSkillIds: uniqueSorted(
          payload.operations
            .filter((operation) => operation.agentId === configChange.agentId)
            .map((operation) => operation.skillId)
        ),
        previousEnabled: agentConfig?.enabled ?? false,
        ...(agentConfig?.targetPath === undefined ? {} : {previousTargetPath: agentConfig.targetPath}),
        nextSelectedSkillIds: uniqueSorted(configChange.selectedSkillIdsTo),
        nextSelectedBundleIds: uniqueSorted(configChange.selectedBundleIdsTo),
        effectiveSelectedSkillIds: uniqueSorted(
          payload.selections
            .filter((selection) => selection.agentId === configChange.agentId)
            .map((selection) => selection.skillId)
        ),
        selections: []
      }
    ];
  });
}

/**
 * Digests the local state the plan *depends on but does not itself change*: the skillpack
 * config and active revision, the metadata of the skills it touches, the manifest entries it
 * does not own, and the set of target paths.
 *
 * State the plan does change — the targeted agents' selections and the manifest entries for its
 * own targets — is deliberately excluded. Including it would make every successful apply
 * invalidate its own plan, breaking the required idempotent re-apply. Those parts are validated
 * instead by `reconcileAgentSelections` and by `applyLinkPlan`'s per-operation ownership checks.
 */
function fingerprintFor(options: {
  context: ReportContext;
  agents: readonly AgentPlanInput[];
  skills: readonly DiscoveredSkill[];
  operations: readonly LinkPlanOperation[];
  homeDir: string;
}) {
  const skillIds = new Set(options.operations.map((operation) => operation.skillId));
  const relevantSkills = options.skills
    .filter((skill) => skillIds.has(skill.ref ?? skill.id))
    .map((skill) => ({
      id: skill.ref ?? skill.id,
      absolutePath: skill.absolutePath,
      supportedAgents: [...skill.supportedAgents].sort(),
      requires: [...skill.requires].sort(),
      conflictsWith: [...skill.conflictsWith].sort()
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const planTargetPaths = new Set(
    options.operations.map((operation) => resolveUserPath(operation.targetPath, options.homeDir))
  );

  return computeStateFingerprint({
    config: {skillpacks: options.context.config?.skillpacks ?? null},
    manifest: Object.fromEntries(
      Object.entries(options.context.manifest.links)
        .filter(([targetPath]) => !planTargetPaths.has(targetPath))
        .map(([targetPath, entry]): [string, unknown] => [
          targetPath,
          {agentId: entry.agentId, skillId: entry.skillId, sourcePath: entry.sourcePath, linkType: entry.linkType}
        ])
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    ),
    skillpacks: options.context.skillpacks.map((item) => ({
      id: item.config.id,
      checkoutPath: item.config.checkoutPath,
      commitHash: item.checkout.commitHash ?? null,
      activeRevisionPath: options.context.lock?.skillpacks[item.config.id]?.activeRevisionPath ?? null
    })),
    skills: relevantSkills,
    targets: uniqueSorted([...planTargetPaths])
  });
}

/**
 * A targeted agent's current selection must still be recognisable as either the state the plan
 * was computed against, or the state the plan intends to produce. Anything else means someone
 * changed the selection in between, and applying a replacement plan on top of it would leave
 * config and links inconsistent.
 */
function reconcileAgentSelections(payload: InstallPlanPayload, context: ReportContext): AgentId[] {
  const drifted: AgentId[] = [];

  for (const configChange of payload.configChanges) {
    const agentConfig: AgentConfig | undefined = context.config?.agents?.[configChange.agentId];
    const actualSkills = uniqueSorted(agentConfig?.selectedSkillIds ?? []);
    const actualBundles = uniqueSorted(agentConfig?.selectedBundleIds ?? []);
    const matchesBefore =
      sameIds(actualSkills, uniqueSorted(configChange.selectedSkillIdsFrom)) &&
      sameIds(actualBundles, uniqueSorted(configChange.selectedBundleIdsFrom));
    const matchesAfter =
      sameIds(actualSkills, uniqueSorted(configChange.selectedSkillIdsTo)) &&
      sameIds(actualBundles, uniqueSorted(configChange.selectedBundleIdsTo));

    if (!matchesBefore && !matchesAfter) {
      drifted.push(configChange.agentId);
    }
  }

  return drifted;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function summarize(options: {
  linkPlan: LinkPlan;
  configChangeCount: number;
  dependenciesAdded: string[];
  recommendationsNotSelected: string[];
  skills: readonly DiscoveredSkill[];
  agents: readonly AgentPlanInput[];
}): InstallPlanSummary {
  const selectedSkillIds = new Set(options.agents.flatMap((agent) => agent.effectiveSelectedSkillIds));

  return {
    creates: options.linkPlan.operations.filter((operation) => operation.type === 'create-link').length,
    removals: options.linkPlan.operations.filter((operation) => operation.type === 'remove-link').length,
    alreadySatisfied: options.linkPlan.warnings.filter(
      (warning) => warning.code === 'managed-link-already-present'
    ).length,
    dependenciesAdded: options.dependenciesAdded,
    recommendationsNotSelected: options.recommendationsNotSelected,
    conflicts: options.linkPlan.conflicts.length,
    riskWarnings: options.skills
      .filter((skill) => selectedSkillIds.has(skill.id))
      .reduce((total, skill) => total + skill.riskWarnings.length, 0),
    configChanges: options.configChangeCount
  };
}

function riskWarningsFor(
  skills: readonly DiscoveredSkill[],
  agents: readonly AgentPlanInput[]
): MachineWarning[] {
  const selectedSkillIds = new Set(agents.flatMap((agent) => agent.effectiveSelectedSkillIds));

  return skills
    .filter((skill) => selectedSkillIds.has(skill.id))
    .flatMap((skill) =>
      skill.riskWarnings.map((warning) =>
        createMachineWarning(warning.code, warning.message, {
          skillId: skill.id,
          ...(warning.path === undefined ? {} : {path: warning.path})
        })
      )
    );
}

function listSkillsAction(): NextAction {
  return createNextAction(
    'list-skills',
    'List available skill IDs and their agent compatibility.',
    'corvus-skills skills list --json'
  );
}

function verifyAction(planId: string): NextAction {
  return createNextAction(
    'verify-install',
    'Verify the installation result.',
    `corvus-skills install verify --plan-id ${planId} --json`
  );
}

function formatRequestError(error: unknown): string {
  if (error instanceof Error) {
    const zodIssues = (error as {issues?: Array<{path: Array<string | number>; message: string}>}).issues;

    if (Array.isArray(zodIssues)) {
      return zodIssues
        .map((issue) => `${issue.path.length === 0 ? '<root>' : issue.path.join('.')}: ${issue.message}`)
        .join('; ');
    }

    return error.message;
  }

  return String(error);
}

export function planPathFor(plansDir: string, planId: string): string {
  return path.join(plansDir, `${planId}.json`);
}
