import {saveConfig} from '../../config/configStore.js';
import {applyLinkPlan} from '../../links/applyEngine.js';
import {assertProjectRootAllowed, assertProjectTarget, canonicalScope, projectIdentity, sameScope, type ProfileScope} from '../../profiles/profileScope.js';
import {inspectLinkTarget, type ReportContext} from '../../reports/reportInternals.js';
import {isPrecondition, loadContext, requireConfig} from '../context.js';
import {loadConfirmedPlan, requireFreshState} from '../plans/planGuards.js';
import {computeStateFingerprint, createPlanArtifact, type ProjectRemovePlanPayload} from '../plans/planSchema.js';
import {savePlan} from '../plans/planStore.js';
import type {ApplicationEnvironment} from '../ports.js';
import {createMachineError} from '../protocol/errors.js';
import {fail, failWith, succeed, type UseCaseResult} from '../protocol/result.js';

export interface ProjectsData { projects: Array<{rootPath: string; agentIds: string[]; managedLinkCount: number}> }
export interface ProjectResolveData { scope: ProfileScope }
export interface ProjectRemovePlanData { planId: string; planPath: string; requiresConfirmation: true; plan: ProjectRemovePlanPayload }
export interface ProjectRemoveApplyData { rootPath: string; status: 'removed' | 'already-satisfied' }

export async function listProjectsUseCase(environment: ApplicationEnvironment): Promise<UseCaseResult<ProjectsData>> {
  const context = await loadContext(environment);
  if (context.configExists && context.config === undefined) return failWith(createMachineError('CONFIG_INVALID', context.configError ?? 'Invalid config.'));
  return succeed({projects: Object.values(context.config?.projects ?? {}).sort((a, b) => a.rootPath.localeCompare(b.rootPath)).map((project) => ({
    rootPath: project.rootPath,
    agentIds: Object.keys(project.agents).sort(),
    managedLinkCount: Object.values(context.manifest.links).filter((entry) => sameScope(entry.scope, {kind: 'project', rootPath: project.rootPath})).length
  }))});
}

export async function resolveProjectUseCase(environment: ApplicationEnvironment, options: {rootPath: string}): Promise<UseCaseResult<ProjectResolveData>> {
  try {
    const scope = await canonicalScope({kind: 'project', rootPath: options.rootPath}, environment.homeDir);
    const context = await loadContext(environment);
    const config = requireConfig(context);
    if (isPrecondition(config)) return fail([config.error]);
    await assertProjectRootAllowed(scope, config, environment.homeDir);
    return succeed({scope});
  } catch (error) {
    return failWith(createMachineError('INVALID_REQUEST', String(error), {field: 'rootPath'}));
  }
}

export async function projectRemovePlanUseCase(environment: ApplicationEnvironment, options: {rootPath: string}): Promise<UseCaseResult<ProjectRemovePlanData>> {
  try {
    const scope = await canonicalScope({kind: 'project', rootPath: options.rootPath}, environment.homeDir);
    if (scope.kind !== 'project') throw new Error('Project scope required.');
    const context = await loadContext(environment);
    const config = requireConfig(context);
    if (isPrecondition(config)) return fail([config.error]);
    if (!context.manifestValid) throw new Error('Manifest is invalid; refusing to remove a profile.');
    if (config.projects?.[scope.rootPath] === undefined) throw new Error('Project profile does not exist.');
    await assertProjectRootAllowed(scope, config, environment.homeDir);
    const links = Object.values(context.manifest.links).filter((entry) => sameScope(entry.scope, scope)).sort((a, b) => a.targetPath.localeCompare(b.targetPath));
    for (const entry of links) {
      await assertProjectTarget(scope, entry.targetPath);
      const inspection = await inspectLinkTarget(entry.targetPath);
      if (inspection.kind !== 'missing' && (inspection.kind !== 'link' || inspection.resolvedSourcePath !== entry.sourcePath)) {
        throw new Error(`Managed target changed; refusing removal: ${entry.targetPath}`);
      }
    }
    const payload: ProjectRemovePlanPayload = {
      scope, projectIdentity: (await projectIdentity(scope))!,
      operations: links.map((entry) => ({type: 'remove-link', scope, agentId: entry.agentId, skillId: entry.skillId, targetPath: entry.targetPath})),
      stateFingerprint: await removalFingerprint(context, scope)
    };
    const plan = createPlanArtifact({kind: 'project-remove', payload, now: environment.now()});
    const planPath = await savePlan(environment.plansDir, plan);
    return succeed<ProjectRemovePlanData>({planId: plan.planId, planPath, requiresConfirmation: true, plan: payload});
  } catch (error) {
    return failWith(createMachineError('SAFETY_POLICY_BLOCKED', String(error)));
  }
}

export async function projectRemoveApplyUseCase(environment: ApplicationEnvironment, options: {planId: string; confirm: string}): Promise<UseCaseResult<ProjectRemoveApplyData>> {
  const loaded = await loadConfirmedPlan({...options, plansDir: environment.plansDir, kind: 'project-remove', regenerateCommand: 'projects remove-plan'});
  if (isPrecondition(loaded)) return fail([loaded.error], {nextActions: loaded.nextActions});
  if (loaded.kind !== 'project-remove') return failWith(createMachineError('PLAN_NOT_FOUND', 'Wrong plan kind.'));
  const {scope} = loaded.payload;
  try {
    const context = await loadContext(environment);
    const config = requireConfig(context);
    if (isPrecondition(config)) return fail([config.error]);
    if (!context.manifestValid) throw new Error('Invalid manifest.');
    if (await projectIdentity(scope) !== loaded.payload.projectIdentity) throw new Error('Project root changed since preview.');
    await assertProjectRootAllowed(scope, config, environment.homeDir);
    if (config.projects?.[scope.rootPath] === undefined && !Object.values(context.manifest.links).some((entry) => sameScope(entry.scope, scope))) {
      return succeed<ProjectRemoveApplyData>({rootPath: scope.rootPath, status: 'already-satisfied'});
    }
    const stale = requireFreshState({planId: options.planId, expected: loaded.payload.stateFingerprint, actual: await removalFingerprint(context, scope), regenerateCommand: 'projects remove-plan'});
    if (stale !== undefined) return fail([stale.error], {nextActions: stale.nextActions});
    for (const operation of loaded.payload.operations) {
      if (!sameScope(operation.scope, scope)) throw new Error('Invalid operation scope.');
      await assertProjectTarget(scope, operation.targetPath);
    }
    const result = await applyLinkPlan({
      plan: {operations: loaded.payload.operations, conflicts: [], warnings: []},
      expectedProjectIdentity: loaded.payload.projectIdentity,
      managerStateDir: config.managerStateDir, homeDir: environment.homeDir,
      skillpackCheckoutPath: config.managerStateDir, now: environment.now()
    });
    if (result.skipped.length > 0) return failWith(createMachineError('SAFETY_POLICY_BLOCKED', result.skipped.map((item) => item.message).join('; ')), {changed: result.applied.length > 0});
    const projects = {...config.projects};
    delete projects[scope.rootPath];
    await saveConfig({...config, projects, updatedAt: environment.now().toISOString()}, {configPath: environment.configPath});
    return succeed<ProjectRemoveApplyData>({rootPath: scope.rootPath, status: 'removed'}, {changed: true});
  } catch (error) {
    return failWith(createMachineError('STALE_PLAN', String(error)));
  }
}

async function removalFingerprint(context: ReportContext, scope: ProfileScope) {
  const links = Object.values(context.manifest.links).filter((entry) => sameScope(entry.scope, scope)).sort((a, b) => a.targetPath.localeCompare(b.targetPath));
  const targets = await Promise.all(links.map(async (entry) => ({path: entry.targetPath, state: await inspectLinkTarget(entry.targetPath)})));
  return computeStateFingerprint({config: context.config, manifest: context.manifest, targets});
}
