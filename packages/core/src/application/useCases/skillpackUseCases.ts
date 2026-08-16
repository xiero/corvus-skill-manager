import path from 'node:path';
import {
  type ManagerConfig,
  type SkillpackConfig,
  createDefaultManagerConfig,
  getSkillpack
} from '../../config/configSchema.js';
import {saveConfig} from '../../config/configStore.js';
import {
  type SkillpackRemoteUpdateInspection,
  applyInitialSkillpackSetup,
  applySkillpackUpdate,
  inspectSkillpackCheckout,
  inspectSkillpackRemoteUpdate,
  prepareSkillpackUpdatePreview,
  resolveSkillpackSnapshotLayout,
  skillpackRevisionRepoPath
} from '../../git/skillpackSetup.js';
import {defaultSkillpackCheckoutPath, isPathInside} from '../../paths.js';
import {
  defaultSkillpackBranch,
  defaultSkillpackId,
  defaultSkillpackRepositoryUrl
} from '../../skillpackDefaults.js';
import {isPrecondition, loadContext} from '../context.js';
import {loadConfirmedPlan, requireFreshState} from '../plans/planGuards.js';
import {
  type SkillpackSetupPlanPayload,
  type SkillpackRemovePlanPayload,
  type SkillpackUpdatePlanPayload,
  computeStateFingerprint,
  createPlanArtifact,
  skillpackSetupPlanPayloadSchema,
  skillpackRemovePlanPayloadSchema,
  skillpackUpdatePlanPayloadSchema
} from '../plans/planSchema.js';
import {savePlan} from '../plans/planStore.js';
import type {ApplicationEnvironment} from '../ports.js';
import {createMachineError, createMachineWarning} from '../protocol/errors.js';
import {createNextAction} from '../protocol/nextActions.js';
import {type UseCaseResult, fail, failWith, succeed} from '../protocol/result.js';

export interface SkillpackSetupPlanOptions {
  skillpackId?: string;
  repositoryUrl?: string;
  branch?: string;
  checkoutPath?: string;
}

export interface SkillpackSetupPlanData {
  planId: string;
  digest: string;
  requiresConfirmation: true;
  planPath: string;
  plan: SkillpackSetupPlanPayload;
}

export interface SkillpackSetupApplyData {
  planId: string;
  status: string;
  checkoutPath: string;
  activeRevisionPath?: string;
  commitHash?: string;
  message: string;
}

export interface SkillpackUpdateCheckData {
  inspection: SkillpackRemoteUpdateInspection;
}

export interface SkillpackUpdatePreviewData {
  planId?: string;
  digest?: string;
  requiresConfirmation: boolean;
  planPath?: string;
  status: string;
  message: string;
  plan?: SkillpackUpdatePlanPayload;
}

export interface SkillpackUpdateApplyData {
  planId: string;
  status: string;
  checkoutPath: string;
  activeRevisionPath?: string;
  previousCommitHash?: string;
  commitHash?: string;
  message: string;
}

export interface SkillpackRemovePlanData {
  planId: string;
  digest: string;
  requiresConfirmation: true;
  planPath: string;
  plan: SkillpackRemovePlanPayload;
}

export interface SkillpackRemoveApplyData {
  planId: string;
  skillpackId: string;
  status: 'removed';
  snapshotsPreserved: true;
}

/**
 * Plans the initial skillpack setup. Read-only apart from writing the plan artifact: it reports
 * the repository, branch, id, active path, and revision path *before* any clone happens.
 */
export async function skillpackSetupPlanUseCase(
  environment: ApplicationEnvironment,
  options: SkillpackSetupPlanOptions = {}
): Promise<UseCaseResult<SkillpackSetupPlanData>> {
  const context = await loadContext(environment);

  if (context.configExists && context.config === undefined) {
    return failWith(
      createMachineError(
        'CONFIG_INVALID',
        `Manager config is invalid: ${context.configError ?? 'unknown validation error'}.`,
        {path: context.configPath}
      ),
      {nextActions: [createNextAction('inspect-config', 'Fix config.json before planning setup.')]}
    );
  }

  const managerStateDir = context.config?.managerStateDir ?? environment.managerStateDir;
  const skillpack = resolveSkillpackConfig(context.config, options, environment.homeDir);
  const layout = resolveSkillpackSnapshotLayout(skillpack, {homeDir: environment.homeDir});
  const checkout = await inspectSkillpackCheckout(layout.currentPath, {
    homeDir: environment.homeDir,
    git: environment.git
  });
  // The remote head is only needed when a clone is going to happen; an existing snapshot is
  // inspected, never re-cloned.
  const remoteHead = checkout.exists ? undefined : await readRemoteHead(environment, skillpack);
  const remoteCommitHash = remoteHead?.status === 'ok' ? remoteHead.commitHash : undefined;
  const expectedRevisionPath =
    remoteCommitHash === undefined ? undefined : safeRevisionPath(layout, remoteCommitHash);

  const payload: SkillpackSetupPlanPayload = skillpackSetupPlanPayloadSchema.parse({
    skillpackId: skillpack.id,
    repositoryUrl: skillpack.repositoryUrl,
    branch: skillpack.branch,
    activePath: layout.currentPath,
    revisionsPath: layout.revisionsPath,
    ...(remoteCommitHash === undefined ? {} : {expectedCommitHash: remoteCommitHash}),
    ...(expectedRevisionPath === undefined ? {} : {expectedRevisionPath}),
    managerStateDir,
    configPath: context.configPath,
    alreadyPresent: checkout.exists,
    createsConfig: !context.configExists || getSkillpack(context.config, skillpack.id) === undefined,
    stateFingerprint: computeStateFingerprint({
      config: {
        exists: context.configExists,
        skillpacks: context.config?.skillpacks ?? null,
        managerStateDir
      },
      checkout: {exists: checkout.exists, readable: checkout.readable, commitHash: checkout.commitHash ?? null}
    })
  });

  const plan = createPlanArtifact({kind: 'skillpack-setup', payload, now: environment.now()});
  const planPath = await savePlan(environment.plansDir, plan);

  return succeed<SkillpackSetupPlanData>(
    {
      planId: plan.planId,
      digest: plan.digest,
      requiresConfirmation: true,
      planPath,
      plan: payload
    },
    {
      warnings: [
        ...(checkout.exists
          ? [
              createMachineWarning(
                'skillpack-already-present',
                `An active skillpack snapshot already exists at ${layout.currentPath}; apply will inspect it, not re-clone it.`,
                {path: layout.currentPath}
              )
            ]
          : []),
        // Without a pinned commit the plan is still applicable, but apply may fail against the
        // same remote. Say so now rather than letting a mistyped branch look like a healthy plan.
        ...(remoteHead?.status === 'unreadable'
          ? [
              createMachineWarning(
                'remote-head-unreadable',
                `${remoteHead.message} The plan cannot pin an expected commit, and apply will fail if the branch is wrong.`
              )
            ]
          : [])
      ],
      nextActions: [
        createNextAction(
          'apply-skillpack-setup',
          'Apply the reviewed setup plan.',
          `corvus-skills skillpack setup-apply --plan-id ${plan.planId} --confirm ${plan.planId} --json`
        )
      ]
    }
  );
}

export async function skillpackSetupApplyUseCase(
  environment: ApplicationEnvironment,
  options: {planId: string; confirm: string}
): Promise<UseCaseResult<SkillpackSetupApplyData>> {
  const loadedPlan = await loadConfirmedPlan({
    plansDir: environment.plansDir,
    planId: options.planId,
    confirm: options.confirm,
    kind: 'skillpack-setup',
    regenerateCommand: 'skillpack setup-plan'
  });

  if (isPrecondition(loadedPlan)) {
    return fail([loadedPlan.error], {nextActions: loadedPlan.nextActions});
  }

  if (loadedPlan.kind !== 'skillpack-setup') {
    return failWith(createMachineError('PLAN_NOT_FOUND', 'Plan kind mismatch.'));
  }

  const payload = loadedPlan.payload;
  const skillpack: SkillpackConfig = {
    id: payload.skillpackId,
    repositoryUrl: payload.repositoryUrl,
    branch: payload.branch,
    checkoutPath: payload.activePath
  };
  const context = await loadContext(environment);
  const layout = resolveSkillpackSnapshotLayout(skillpack, {homeDir: environment.homeDir});
  const checkout = await inspectSkillpackCheckout(layout.currentPath, {
    homeDir: environment.homeDir,
    git: environment.git
  });
  const staleness = requireFreshState({
    planId: options.planId,
    expected: payload.stateFingerprint,
    actual: computeStateFingerprint({
      config: {
        exists: context.configExists,
        skillpacks: context.config?.skillpacks ?? null,
        managerStateDir: context.config?.managerStateDir ?? environment.managerStateDir
      },
      checkout: {exists: checkout.exists, readable: checkout.readable, commitHash: checkout.commitHash ?? null}
    }),
    regenerateCommand: 'skillpack setup-plan'
  });

  if (staleness !== undefined) {
    return fail([staleness.error], {nextActions: staleness.nextActions});
  }

  const result = await applyInitialSkillpackSetup({
    config: skillpack,
    managerStateDir: payload.managerStateDir,
    homeDir: environment.homeDir,
    git: environment.git,
    now: environment.now()
  });

  if (result.status === 'clone-failed') {
    return failWith(
      createMachineError('EXTERNAL_OPERATION_FAILED', `Skillpack setup failed: ${result.message}`, {
        path: result.checkoutPath
      }),
      {
        nextActions: [
          createNextAction('retry-skillpack-setup', 'Regenerate the setup plan and retry.', 'corvus-skills skillpack setup-plan --json')
        ]
      }
    );
  }

  const configWritten = await persistSkillpackConfig(environment, context.config, skillpack);
  const changed = result.status === 'clone-complete' || configWritten;

  return succeed(
    {
      planId: options.planId,
      status: result.status,
      checkoutPath: result.checkoutPath,
      ...(result.activeRevisionPath === undefined ? {} : {activeRevisionPath: result.activeRevisionPath}),
      ...(result.commitHash === undefined ? {} : {commitHash: result.commitHash}),
      message: result.message
    },
    {
      changed,
      warnings: result.dirty
        ? [
            createMachineWarning(
              'dirty-checkout',
              `Active skillpack snapshot has ${result.dirtyFiles.length} local change(s); the manager will not repair it.`,
              {path: result.checkoutPath}
            )
          ]
        : [],
      nextActions: [
        createNextAction('list-skills', 'List the discovered skill catalog.', 'corvus-skills skills list --json')
      ]
    }
  );
}

/** Strictly read-only: `git ls-remote` only, never a fetch or pull against the active checkout. */
export async function skillpackUpdateCheckUseCase(
  environment: ApplicationEnvironment,
  options: {skillpackId?: string} = {}
): Promise<UseCaseResult<SkillpackUpdateCheckData>> {
  const context = await loadContext(environment);
  const skillpack = getSkillpack(context.config, options.skillpackId);

  if (skillpack === undefined) {
    return failWith(createMachineError('SKILLPACK_NOT_CONFIGURED', 'No skillpack is configured.'), {
      nextActions: [
        createNextAction('run-skillpack-setup-plan', 'Plan skillpack setup.', 'corvus-skills skillpack setup-plan --json')
      ]
    });
  }

  const inspection = await inspectSkillpackRemoteUpdate(skillpack, {
    homeDir: environment.homeDir,
    git: environment.git
  });

  return succeed(
    {inspection},
    {
      warnings:
        inspection.status === 'remote-unavailable'
          ? [createMachineWarning('remote-unavailable', inspection.message)]
          : [],
      nextActions: inspection.updateAvailable
        ? [
            createNextAction(
              'preview-skillpack-update',
              'Preview the new revision before activating it.',
              `corvus-skills skillpack update-preview --skillpack-id ${skillpack.id} --json`
            )
          ]
        : []
    }
  );
}

/**
 * Prepares an inactive immutable revision snapshot and the activation plan. The `current` link
 * is untouched here; activation requires the plan id plus explicit confirmation.
 */
export async function skillpackUpdatePreviewUseCase(
  environment: ApplicationEnvironment,
  options: {skillpackId?: string} = {}
): Promise<UseCaseResult<SkillpackUpdatePreviewData>> {
  const context = await loadContext(environment);
  const skillpack = getSkillpack(context.config, options.skillpackId);

  if (skillpack === undefined) {
    return failWith(createMachineError('SKILLPACK_NOT_CONFIGURED', 'No skillpack is configured.'), {
      nextActions: [
        createNextAction('run-skillpack-setup-plan', 'Plan skillpack setup.', 'corvus-skills skillpack setup-plan --json')
      ]
    });
  }

  const preview = await prepareSkillpackUpdatePreview({
    config: skillpack,
    managerStateDir: context.config?.managerStateDir ?? environment.managerStateDir,
    homeDir: environment.homeDir,
    git: environment.git,
    now: environment.now()
  });

  if (preview.status === 'preview-failed') {
    return failWith(
      createMachineError('EXTERNAL_OPERATION_FAILED', `Update preview failed: ${preview.message}`, {
        path: preview.checkoutPath
      })
    );
  }

  if (
    preview.status === 'no-update' ||
    preview.candidateRevisionPath === undefined ||
    preview.activeCommitHash === undefined ||
    preview.remoteCommitHash === undefined
  ) {
    return succeed({
      requiresConfirmation: false,
      status: preview.status,
      message: preview.message
    });
  }

  const payload: SkillpackUpdatePlanPayload = skillpackUpdatePlanPayloadSchema.parse({
    skillpackId: skillpack.id,
    repositoryUrl: skillpack.repositoryUrl,
    branch: skillpack.branch,
    activePath: preview.checkoutPath,
    activeCommitHash: preview.activeCommitHash,
    remoteCommitHash: preview.remoteCommitHash,
    candidateRevisionPath: preview.candidateRevisionPath,
    addedSkillIds: preview.addedSkillIds,
    removedSkillIds: preview.removedSkillIds,
    changedSkillIds: preview.changedSkillIds,
    changedFiles: preview.changedFiles,
    managerStateDir: context.config?.managerStateDir ?? environment.managerStateDir,
    stateFingerprint: computeStateFingerprint({
      active: {commitHash: preview.activeCommitHash, checkoutPath: preview.checkoutPath},
      remote: {commitHash: preview.remoteCommitHash}
    })
  });

  const plan = createPlanArtifact({kind: 'skillpack-update', payload, now: environment.now()});
  const planPath = await savePlan(environment.plansDir, plan);

  return succeed(
    {
      planId: plan.planId,
      digest: plan.digest,
      requiresConfirmation: true,
      planPath,
      status: preview.status,
      message: preview.message,
      plan: payload
    },
    {
      changed: true,
      nextActions: [
        createNextAction(
          'apply-skillpack-update',
          'Activate the previewed revision after reviewing the skill changes.',
          `corvus-skills skillpack update-apply --plan-id ${plan.planId} --confirm ${plan.planId} --json`
        )
      ]
    }
  );
}

/** Activates a previewed revision. Rejects remote/head drift through the state fingerprint. */
export async function skillpackUpdateApplyUseCase(
  environment: ApplicationEnvironment,
  options: {planId: string; confirm: string}
): Promise<UseCaseResult<SkillpackUpdateApplyData>> {
  const loadedPlan = await loadConfirmedPlan({
    plansDir: environment.plansDir,
    planId: options.planId,
    confirm: options.confirm,
    kind: 'skillpack-update',
    regenerateCommand: 'skillpack update-preview'
  });

  if (isPrecondition(loadedPlan)) {
    return fail([loadedPlan.error], {nextActions: loadedPlan.nextActions});
  }

  if (loadedPlan.kind !== 'skillpack-update') {
    return failWith(createMachineError('PLAN_NOT_FOUND', 'Plan kind mismatch.'));
  }

  const payload = loadedPlan.payload;
  const context = await loadContext(environment);
  const skillpack = getSkillpack(context.config, payload.skillpackId);

  if (skillpack === undefined) {
    return failWith(createMachineError('SKILLPACK_NOT_CONFIGURED', 'No skillpack is configured.'));
  }

  const inspection = await inspectSkillpackRemoteUpdate(skillpack, {
    homeDir: environment.homeDir,
    git: environment.git
  });
  const staleness = requireFreshState({
    planId: options.planId,
    expected: payload.stateFingerprint,
    actual: computeStateFingerprint({
      active: {commitHash: inspection.activeCommitHash ?? null, checkoutPath: inspection.checkoutPath},
      remote: {commitHash: inspection.remoteCommitHash ?? null}
    }),
    regenerateCommand: 'skillpack update-preview'
  });

  if (staleness !== undefined) {
    return fail([staleness.error], {nextActions: staleness.nextActions});
  }

  const result = await applySkillpackUpdate({
    config: skillpack,
    managerStateDir: payload.managerStateDir,
    homeDir: environment.homeDir,
    git: environment.git,
    now: environment.now()
  });

  if (result.status === 'update-failed') {
    return failWith(
      createMachineError('EXTERNAL_OPERATION_FAILED', `Revision activation failed: ${result.message}`, {
        path: result.checkoutPath
      })
    );
  }

  return succeed(
    {
      planId: options.planId,
      status: result.status,
      checkoutPath: result.checkoutPath,
      ...(result.activeRevisionPath === undefined ? {} : {activeRevisionPath: result.activeRevisionPath}),
      ...(result.previousCommitHash === undefined ? {} : {previousCommitHash: result.previousCommitHash}),
      ...(result.commitHash === undefined ? {} : {commitHash: result.commitHash}),
      message: result.message
    },
    {
      changed: result.status === 'update-applied',
      nextActions: [
        createNextAction(
          'verify-installed-links',
          'Managed links now resolve through the new revision; re-run doctor to confirm.',
          'corvus-skills doctor --json'
        )
      ]
    }
  );
}

/** Plans config-only removal. Immutable snapshots and the manager-owned current link are retained. */
export async function skillpackRemovePlanUseCase(
  environment: ApplicationEnvironment,
  options: {skillpackId: string}
): Promise<UseCaseResult<SkillpackRemovePlanData>> {
  if (options.skillpackId === defaultSkillpackId) {
    return failWith(
      createMachineError('SAFETY_POLICY_BLOCKED', 'The default corvus-skillpack is protected and cannot be removed.', {
        details: {skillpackId: options.skillpackId}
      })
    );
  }

  const context = await loadContext(environment);
  const skillpack = getSkillpack(context.config, options.skillpackId);

  if (skillpack === undefined) {
    return failWith(
      createMachineError('SKILLPACK_NOT_CONFIGURED', `Skillpack "${options.skillpackId}" is not configured.`)
    );
  }

  const usage = skillpackUsage(context.config, context.manifest.links, options.skillpackId, skillpack.checkoutPath);
  if (usage.selectedByAgents.length > 0 || usage.managedTargets.length > 0) {
    return failWith(
      createMachineError(
        'SAFETY_POLICY_BLOCKED',
        `Skillpack "${options.skillpackId}" is still in use; remove its selected skills first.`,
        {details: usage}
      )
    );
  }

  const payload = skillpackRemovePlanPayloadSchema.parse({
    skillpackId: skillpack.id,
    repositoryUrl: skillpack.repositoryUrl,
    activePath: skillpack.checkoutPath,
    configPath: context.configPath,
    managerStateDir: context.config?.managerStateDir ?? environment.managerStateDir,
    stateFingerprint: computeStateFingerprint({skillpack, usage})
  });
  const plan = createPlanArtifact({kind: 'skillpack-remove', payload, now: environment.now()});
  const planPath = await savePlan(environment.plansDir, plan);

  return succeed<SkillpackRemovePlanData>(
    {planId: plan.planId, digest: plan.digest, requiresConfirmation: true, planPath, plan: payload},
    {
      nextActions: [
        createNextAction(
          'apply-skillpack-remove',
          'Remove the reviewed skillpack registration while preserving its snapshots.',
          `corvus-skills skillpack remove-apply --plan-id ${plan.planId} --confirm ${plan.planId} --json`
        )
      ]
    }
  );
}

export async function skillpackRemoveApplyUseCase(
  environment: ApplicationEnvironment,
  options: {planId: string; confirm: string}
): Promise<UseCaseResult<SkillpackRemoveApplyData>> {
  const loadedPlan = await loadConfirmedPlan({
    plansDir: environment.plansDir,
    planId: options.planId,
    confirm: options.confirm,
    kind: 'skillpack-remove',
    regenerateCommand: 'skillpack remove-plan --skillpack-id <secondary-skillpack-id>'
  });

  if (isPrecondition(loadedPlan)) return fail([loadedPlan.error], {nextActions: loadedPlan.nextActions});
  if (loadedPlan.kind !== 'skillpack-remove') return failWith(createMachineError('PLAN_NOT_FOUND', 'Plan kind mismatch.'));

  const payload = loadedPlan.payload;
  const context = await loadContext(environment);
  const skillpack = getSkillpack(context.config, payload.skillpackId);
  if (skillpack === undefined || context.config === undefined) {
    return failWith(createMachineError('STALE_PLAN', `Skillpack "${payload.skillpackId}" is no longer configured.`));
  }
  const usage = skillpackUsage(context.config, context.manifest.links, payload.skillpackId, skillpack.checkoutPath);
  const staleness = requireFreshState({
    planId: options.planId,
    expected: payload.stateFingerprint,
    actual: computeStateFingerprint({skillpack, usage}),
    regenerateCommand: `skillpack remove-plan --skillpack-id ${payload.skillpackId}`
  });
  if (staleness !== undefined) return fail([staleness.error], {nextActions: staleness.nextActions});

  const skillpacks = {...(context.config.skillpacks ?? {})};
  delete skillpacks[payload.skillpackId];
  await saveConfig(
    {...context.config, version: 2, skillpacks, updatedAt: environment.now().toISOString()},
    {configPath: environment.configPath}
  );

  return succeed<SkillpackRemoveApplyData>(
    {planId: options.planId, skillpackId: payload.skillpackId, status: 'removed', snapshotsPreserved: true},
    {changed: true}
  );
}

function skillpackUsage(
  config: ManagerConfig | undefined,
  links: Record<string, {skillId: string; sourcePath: string}>,
  skillpackId: string,
  checkoutPath: string
): {selectedByAgents: string[]; managedTargets: string[]} {
  const prefix = `${skillpackId}:`;
  return {
    selectedByAgents: Object.entries(config?.agents ?? {})
      .filter(([, agent]) => agent.selectedSkillIds.some((ref) => ref.startsWith(prefix)))
      .map(([agentId]) => agentId)
      .sort(),
    managedTargets: Object.entries(links)
      .filter(([, entry]) => entry.skillId.startsWith(prefix) || isPathInside(checkoutPath, entry.sourcePath))
      .map(([targetPath]) => targetPath)
      .sort()
  };
}

function resolveSkillpackConfig(
  config: ManagerConfig | undefined,
  options: SkillpackSetupPlanOptions,
  homeDir: string
): SkillpackConfig {
  const id = options.skillpackId ?? defaultSkillpackId;
  const existing = getSkillpack(config, id);

  return {
    id,
    repositoryUrl: options.repositoryUrl ?? existing?.repositoryUrl ?? defaultSkillpackRepositoryUrl,
    branch: options.branch ?? existing?.branch ?? defaultSkillpackBranch,
    checkoutPath: options.checkoutPath ?? existing?.checkoutPath ?? defaultSkillpackCheckoutPath(id, homeDir)
  };
}

type RemoteHeadResult =
  | {status: 'ok'; commitHash: string}
  | {status: 'unreadable'; message: string};

/**
 * Reads the remote branch head with a read-only `git ls-remote`.
 *
 * Failure is reported rather than swallowed: a caller that cannot pin the expected commit needs
 * to say so, otherwise a mistyped branch looks like a healthy plan and only fails at apply time.
 */
async function readRemoteHead(
  environment: ApplicationEnvironment,
  skillpack: SkillpackConfig
): Promise<RemoteHeadResult> {
  try {
    const output = (
      await environment.git(['ls-remote', skillpack.repositoryUrl, `refs/heads/${skillpack.branch}`])
    ).stdout.trim();
    const firstLine = output.split('\n').find((line) => line.trim() !== '');
    const commitHash = firstLine?.split(/\s+/)[0]?.trim().toLowerCase();

    if (commitHash === undefined || !/^[a-f0-9]{7,64}$/.test(commitHash)) {
      return {
        status: 'unreadable',
        message: `No branch named "${skillpack.branch}" was found at ${skillpack.repositoryUrl}.`
      };
    }

    return {status: 'ok', commitHash};
  } catch (error) {
    return {
      status: 'unreadable',
      message: `Remote head lookup failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
    };
  }
}

function safeRevisionPath(
  layout: ReturnType<typeof resolveSkillpackSnapshotLayout>,
  commitHash: string
): string | undefined {
  try {
    return skillpackRevisionRepoPath(layout, commitHash);
  } catch {
    return path.join(layout.revisionsPath, '<commit>', 'repo');
  }
}

/**
 * Writes the skillpack into config, creating a default config when none exists. This only ever
 * happens from an explicitly confirmed setup apply, never from a read-only command.
 */
async function persistSkillpackConfig(
  environment: ApplicationEnvironment,
  existingConfig: ManagerConfig | undefined,
  skillpack: SkillpackConfig
): Promise<boolean> {
  const timestamp = environment.now().toISOString();

  if (existingConfig === undefined) {
    const base = createDefaultManagerConfig({
      managerStateDir: environment.managerStateDir,
      homeDir: environment.homeDir,
      now: environment.now()
    });
    await saveConfig(
      {
        ...base,
        skillpacks: {...(base.skillpacks ?? {}), [skillpack.id]: skillpack}
      },
      {configPath: environment.configPath}
    );

    return true;
  }

  if (
    getSkillpack(existingConfig, skillpack.id)?.repositoryUrl === skillpack.repositoryUrl &&
    getSkillpack(existingConfig, skillpack.id)?.branch === skillpack.branch &&
    getSkillpack(existingConfig, skillpack.id)?.checkoutPath === skillpack.checkoutPath
  ) {
    return false;
  }

  await saveConfig(
    {
      ...existingConfig,
      version: 2,
      updatedAt: timestamp,
      skillpacks: {...(existingConfig.skillpacks ?? {}), [skillpack.id]: skillpack}
    },
    {configPath: environment.configPath}
  );
  return true;
}
