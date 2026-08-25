import path from 'node:path';
import type {AgentId} from '../../agents/AgentAdapter.js';
import {getAgentAdapters} from '../../agents/adapters.js';
import {
  type AgentConfig,
  type ManagerConfig,
  parseBundleReference,
  resolveBundleReference
} from '../../config/configSchema.js';
import {saveConfig} from '../../config/configStore.js';
import {type ApplyActionResult, applyLinkPlan} from '../../links/applyEngine.js';
import type {LinkPlan, LinkPlanOperation} from '../../links/linkPlan.js';
import type {ManagerManifest} from '../../manifest/manifestSchema.js';
import {loadManifestOrDefault} from '../../manifest/manifestStore.js';
import {isPathInside, resolveUserPath} from '../../paths.js';
import {inspectLinkTarget, type ReportContext} from '../../reports/reportInternals.js';
import type {DiscoveredBundle, DiscoveredSkill} from '../../skills/skillDiscovery.js';
import {isPrecondition, loadContext, requireReadySkillpack} from '../context.js';
import {
  type ResolvedPlanSelection,
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
  kind: 'link' | 'removal' | 'config' | 'dependency' | 'effective';
  agentId?: AgentId;
  skillId?: string;
  targetPath?: string;
  satisfied: boolean;
  code: string;
  message: string;
  origins?: ResolvedPlanSelection['origins'];
}

export interface InstallVerifySelectionState {
  agentId: AgentId;
  roots: {skillIds: string[]; bundleIds: string[]};
  effectiveSkills: Array<{skillId: string; origins: ResolvedPlanSelection['origins']}>;
  managedSkillIds: string[];
  staleManagedSkillIds: string[];
}

export interface InstallVerifyData {
  planId: string;
  status: InstallVerifyStatus;
  checks: InstallVerifyCheck[];
  selectionState: InstallVerifySelectionState[];
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

  const bundleRegistryErrors = selectedBundleRegistryErrors(normalizedRequest, context);
  if (bundleRegistryErrors.length > 0) {
    return fail(bundleRegistryErrors, {
      nextActions: [
        createNextAction(
          'validate-registry',
          'Inspect Registry v3 relationship errors; Corvus never repairs a skillpack registry.',
          'corvus-skills skills validate-registry --json'
        )
      ]
    });
  }

  const adapters = getAgentAdapters();
  const resolved = resolveSelections({
    request: normalizedRequest,
    adapters,
    skills: ready.discovery.skills,
    bundles: ready.discovery.bundles,
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
    bundleMembersAdded: resolved.bundleMembersAdded,
    dependenciesAdded: resolved.dependenciesAdded,
    recommendationsNotSelected: resolved.recommendationsNotSelected,
    skills: ready.discovery.skills,
    agents: resolved.agents
  });
  const payload: InstallPlanPayload = installPlanPayloadSchema.parse({
    request: normalizedRequest,
    targetAgents: resolved.agents.map((agent) => agent.adapter.id),
    rootSelections: resolved.agents.map((agent) => ({
      agentId: agent.adapter.id,
      selectedSkillIds: agent.nextSelectedSkillIds,
      selectedBundleIds: agent.nextSelectedBundleIds
    })),
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
      bundles: ready.discovery.bundles,
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

function selectedBundleRegistryErrors(
  request: NormalizedInstallRequest,
  context: ReportContext
): MachineError[] {
  if (request.allCompatible) return [];

  const errors: MachineError[] = [];

  for (const selected of request.selectedBundles ?? []) {
    const bundleRef = resolveBundleReference(selected.id);
    const parsed = parseBundleReference(bundleRef);
    if (parsed === undefined) continue;

    const discovery = context.skillpacks.find(
      (skillpack) => skillpack.config.id === parsed.skillpackId
    )?.discovery;
    if (discovery === undefined) continue;

    const bundle = discovery.bundles.find((candidate) => candidate.id === parsed.bundleId);
    const directMemberIds = new Set(bundle?.members.map((member) => member.id) ?? []);

    for (const issue of discovery.errors) {
      const affectsBundle =
        issue.bundleId === parsed.bundleId ||
        (issue.code === 'required-skill-version-mismatch' &&
          issue.skillId !== undefined &&
          directMemberIds.has(issue.skillId));
      if (!affectsBundle) continue;

      const versionMismatch =
        issue.code === 'bundle-member-version-mismatch' ||
        issue.code === 'required-skill-version-mismatch';
      errors.push(
        createMachineError(
          versionMismatch ? 'VERSION_MISMATCH' : 'BUNDLE_MEMBER_MISMATCH',
          issue.message,
          {
            field: 'selectedBundles',
            ...(issue.skillId === undefined ? {} : {skillId: issue.skillId}),
            details: {
              bundleRef,
              registryIssueCode: issue.code,
              ...(issue.memberId === undefined ? {} : {memberId: issue.memberId}),
              ...(issue.versionRange === undefined ? {} : {versionRange: issue.versionRange}),
              ...(issue.actualVersion === undefined ? {} : {actualVersion: issue.actualVersion})
            }
          }
        )
      );
    }
  }

  return errors.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      String(left.details?.bundleRef ?? '').localeCompare(String(right.details?.bundleRef ?? '')) ||
      left.message.localeCompare(right.message)
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
          {details: {planId: options.planId, changedComponents: ['rootSelections'], agents: driftedAgents}}
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
      bundles: ready.discovery.bundles,
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

  for (const rootSelection of payload.rootSelections) {
    const agentConfig: AgentConfig | undefined = context.config?.agents?.[rootSelection.agentId];
    const actualSkills = uniqueSorted(agentConfig?.selectedSkillIds ?? []);
    const expectedSkills = uniqueSorted(rootSelection.selectedSkillIds);
    const actualBundles = uniqueSorted(agentConfig?.selectedBundleIds ?? []);
    const expectedBundles = uniqueSorted(rootSelection.selectedBundleIds);
    const satisfied =
      agentConfig?.enabled === true &&
      sameIds(actualSkills, expectedSkills) &&
      sameIds(actualBundles, expectedBundles);

    if (!satisfied) {
      drift = true;
    }

    checks.push({
      kind: 'config',
      agentId: rootSelection.agentId,
      satisfied,
      code: satisfied ? 'config-selection-matches' : 'config-selection-mismatch',
      message: satisfied
        ? 'Config records the expected root selection for this agent.'
        : `Config root selection for ${rootSelection.agentId} does not match the plan.`
    });
  }

  for (const selection of payload.selections) {
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
      kind: selection.reasonKind === 'dependency-of' ? 'dependency' : 'effective',
      agentId: selection.agentId,
      skillId: selection.skillId,
      satisfied,
      code:
        selection.reasonKind === 'dependency-of'
          ? satisfied
            ? 'dependency-installed'
            : 'dependency-missing'
          : satisfied
            ? 'effective-skill-installed'
            : 'effective-skill-missing',
      message: satisfied
        ? `Effective skill ${selection.skillId} is linked (${selection.reason}).`
        : `Effective skill ${selection.skillId} is not linked (${selection.reason}).`,
      origins: selection.origins
    });
  }

  const selectionState: InstallVerifySelectionState[] = payload.rootSelections.map((rootSelection) => {
    const effectiveSkills = payload.selections
      .filter((selection) => selection.agentId === rootSelection.agentId)
      .map((selection) => ({skillId: selection.skillId, origins: selection.origins}));
    const effectiveIds = new Set(effectiveSkills.map((selection) => selection.skillId));
    const managedSkillIds = uniqueSorted(
      Object.values(context.manifest.links)
        .filter((entry) => entry.agentId === rootSelection.agentId)
        .map((entry) => entry.skillId)
    );
    const staleManagedSkillIds = managedSkillIds.filter((skillId) => !effectiveIds.has(skillId));

    if (staleManagedSkillIds.length > 0) {
      drift = true;
      for (const skillId of staleManagedSkillIds) {
        checks.push({
          kind: 'effective',
          agentId: rootSelection.agentId,
          skillId,
          satisfied: false,
          code: 'stale-managed-link',
          message: `Manager-owned link ${skillId} is no longer implied by the plan's root selection.`
        });
      }
    }

    return {
      agentId: rootSelection.agentId,
      roots: {
        skillIds: uniqueSorted(rootSelection.selectedSkillIds),
        bundleIds: uniqueSorted(rootSelection.selectedBundleIds)
      },
      effectiveSkills,
      managedSkillIds,
      staleManagedSkillIds
    };
  });

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
    {planId: options.planId, status, checks, selectionState, blockingDoctorIssueCodes},
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

  return payload.rootSelections.flatMap((rootSelection): AgentPlanInput[] => {
    const adapter = adapters.get(rootSelection.agentId);

    if (adapter === undefined) {
      return [];
    }

    const configChange = payload.configChanges.find((change) => change.agentId === rootSelection.agentId);
    const agentConfig: AgentConfig | undefined = context.config?.agents?.[rootSelection.agentId];

    return [
      {
        adapter,
        targetPath: configChange?.targetPathTo ?? agentConfig?.targetPath ?? adapter.defaultTargetPath ?? '',
        previousSelectedSkillIds: uniqueSorted(
          configChange?.selectedSkillIdsFrom ?? rootSelection.selectedSkillIds
        ),
        previousSelectedBundleIds: uniqueSorted(
          configChange?.selectedBundleIdsFrom ?? rootSelection.selectedBundleIds
        ),
        previousEffectiveSkillIds: uniqueSorted(
          payload.operations
            .filter((operation) => operation.agentId === rootSelection.agentId)
            .map((operation) => operation.skillId)
        ),
        previousEnabled: configChange?.enabledFrom ?? agentConfig?.enabled ?? false,
        ...(agentConfig?.targetPath === undefined ? {} : {previousTargetPath: agentConfig.targetPath}),
        nextSelectedSkillIds: uniqueSorted(rootSelection.selectedSkillIds),
        nextSelectedBundleIds: uniqueSorted(rootSelection.selectedBundleIds),
        effectiveSelectedSkillIds: uniqueSorted(
          payload.selections
            .filter((selection) => selection.agentId === rootSelection.agentId)
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
 * Targeted root selections are represented as a recognized before/after state, so a successful
 * or partial apply remains re-applicable while any third root state changes the independently
 * named `rootSelections` component. Plan-owned manifest targets remain guarded per operation.
 */
function fingerprintFor(options: {
  context: ReportContext;
  agents: readonly AgentPlanInput[];
  skills: readonly DiscoveredSkill[];
  bundles: readonly DiscoveredBundle[];
  operations: readonly LinkPlanOperation[];
  homeDir: string;
}) {
  const skillIds = new Set([
    ...options.operations.map((operation) => operation.skillId),
    ...options.agents.flatMap((agent) => [
      ...agent.previousEffectiveSkillIds,
      ...agent.effectiveSelectedSkillIds
    ])
  ]);
  const bundleIds = new Set(
    options.agents.flatMap((agent) => [
      ...agent.previousSelectedBundleIds,
      ...agent.nextSelectedBundleIds
    ])
  );
  const relevantSkills = options.skills
    .filter((skill) => skillIds.has(skill.ref ?? skill.id))
    .map((skill) => ({
      id: skill.ref ?? skill.id,
      version: skill.version ?? null,
      absolutePath: skill.absolutePath,
      supportedAgents: [...skill.supportedAgents].sort(),
      requires: [...skill.requires].sort(),
      recommends: [...skill.recommends].sort(),
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
    registry: {
      skills: relevantSkills,
      bundles: options.bundles
        .filter((bundle) => bundleIds.has(bundle.ref ?? bundle.id))
        .map((bundle) => ({
          id: bundle.ref ?? bundle.id,
          version: bundle.version,
          members: bundle.members.map((member) => ({
            id: member.ref ?? member.id,
            versionRange: member.versionRange,
            actualVersion: member.actualVersion ?? null
          }))
        }))
        .sort((left, right) => left.id.localeCompare(right.id))
    },
    rootSelections: fingerprintRootSelections(options.context, options.agents),
    targets: uniqueSorted([...planTargetPaths])
  });
}

function fingerprintRootSelections(
  context: ReportContext,
  agents: readonly AgentPlanInput[]
): Array<Record<string, unknown>> {
  return [...agents]
    .sort((left, right) => left.adapter.id.localeCompare(right.adapter.id))
    .map((agent) => {
      const current = context.config?.agents?.[agent.adapter.id];
      const actualSkills = uniqueSorted(current?.selectedSkillIds ?? []);
      const actualBundles = uniqueSorted(current?.selectedBundleIds ?? []);
      const before = {
        selectedSkillIds: uniqueSorted(agent.previousSelectedSkillIds),
        selectedBundleIds: uniqueSorted(agent.previousSelectedBundleIds)
      };
      const after = {
        selectedSkillIds: uniqueSorted(agent.nextSelectedSkillIds),
        selectedBundleIds: uniqueSorted(agent.nextSelectedBundleIds)
      };
      const recognized =
        (sameIds(actualSkills, before.selectedSkillIds) && sameIds(actualBundles, before.selectedBundleIds)) ||
        (sameIds(actualSkills, after.selectedSkillIds) && sameIds(actualBundles, after.selectedBundleIds));

      return {
        agentId: agent.adapter.id,
        before,
        after,
        state: recognized ? 'recognized' : 'drift',
        ...(recognized ? {} : {actual: {selectedSkillIds: actualSkills, selectedBundleIds: actualBundles}})
      };
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
  bundleMembersAdded: string[];
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
    bundlesSelected: uniqueSorted(options.agents.flatMap((agent) => agent.nextSelectedBundleIds)),
    bundleMembersAdded: uniqueSorted(options.bundleMembersAdded),
    dependenciesAdded: options.dependenciesAdded,
    effectiveSkills: uniqueSorted(options.agents.flatMap((agent) => agent.effectiveSelectedSkillIds)),
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
