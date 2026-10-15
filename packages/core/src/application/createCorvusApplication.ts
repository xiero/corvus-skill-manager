import {failWith, type UseCaseResult} from './protocol/result.js';
import {createMachineError} from './protocol/errors.js';
import type {ProfileScope} from '../profiles/profileScope.js';
import {listProjectsUseCase, resolveProjectUseCase, projectRemovePlanUseCase, projectRemoveApplyUseCase} from './useCases/projectUseCases.js';
import type {CorvusApplication} from './CorvusApplication.js';
import {type CorvusApplicationOptions, resolveApplicationEnvironment} from './ports.js';
import {capabilitiesUseCase} from './useCases/capabilitiesUseCase.js';
import {
  installApplyUseCase,
  installPlanUseCase,
  installVerifyUseCase
} from './useCases/installUseCases.js';
import {
  skillpackSetupApplyUseCase,
  skillpackRemoveApplyUseCase,
  skillpackRemovePlanUseCase,
  skillpackSetupPlanUseCase,
  skillpackUpdateApplyUseCase,
  skillpackUpdateCheckUseCase,
  skillpackUpdatePreviewUseCase
} from './useCases/skillpackUseCases.js';
import {
  bundlesInspectUseCase,
  bundlesListUseCase,
  bundlesSearchUseCase,
  checkVersionDisciplineUseCase,
  discoverSkillsUseCase,
  skillsInspectUseCase,
  skillsListUseCase,
  skillsSearchUseCase,
  validateRegistryUseCase
} from './useCases/skillsUseCases.js';
import {
  agentsListUseCase,
  doctorUseCase,
  skillpackStatusUseCase,
  statusUseCase
} from './useCases/statusUseCases.js';

/**
 * Builds the shared application service. All side-effecting dependencies come from
 * `options`, so tests can point it at a temporary home directory with a stubbed git runner.
 */
export function createCorvusApplication(options: CorvusApplicationOptions = {}): CorvusApplication {
  const environment = resolveApplicationEnvironment(options);

  return {
    environment,
    listProjects: () => listProjectsUseCase(environment),
    resolveProject: (options) => resolveProjectUseCase(environment, options),
    projectRemovePlan: (options) => projectRemovePlanUseCase(environment, options),
    projectRemoveApply: (options) => projectRemoveApplyUseCase(environment, options),
    capabilities: () => capabilitiesUseCase(environment),
    status: (statusOptions) => scopeRead(() => statusUseCase(environment, statusOptions), statusOptions?.scope),
    doctor: (statusOptions) => scopeRead(() => doctorUseCase(environment, statusOptions), statusOptions?.scope),
    listAgents: (options) => scopeRead(() => agentsListUseCase(environment, options), options?.scope),
    skillpackStatus: (statusOptions) => skillpackStatusUseCase(environment, statusOptions),
    skillpackSetupPlan: (planOptions) => skillpackSetupPlanUseCase(environment, planOptions),
    skillpackSetupApply: (applyOptions) => skillpackSetupApplyUseCase(environment, applyOptions),
    skillpackUpdateCheck: (skillpackOptions) => skillpackUpdateCheckUseCase(environment, skillpackOptions),
    skillpackUpdatePreview: (skillpackOptions) => skillpackUpdatePreviewUseCase(environment, skillpackOptions),
    skillpackUpdateApply: (applyOptions) => skillpackUpdateApplyUseCase(environment, applyOptions),
    skillpackRemovePlan: (removeOptions) => skillpackRemovePlanUseCase(environment, removeOptions),
    skillpackRemoveApply: (applyOptions) => skillpackRemoveApplyUseCase(environment, applyOptions),
    discoverSkills: () => discoverSkillsUseCase(environment),
    listSkills: (listOptions) => skillsListUseCase(environment, listOptions),
    searchSkills: (searchOptions) => skillsSearchUseCase(environment, searchOptions),
    inspectSkills: (inspectOptions) => skillsInspectUseCase(environment, inspectOptions),
    validateRegistry: () => validateRegistryUseCase(environment),
    checkVersionDiscipline: (checkOptions) => checkVersionDisciplineUseCase(environment, checkOptions),
    listBundles: (listOptions) => bundlesListUseCase(environment, listOptions),
    searchBundles: (searchOptions) => bundlesSearchUseCase(environment, searchOptions),
    inspectBundles: (inspectOptions) => bundlesInspectUseCase(environment, inspectOptions),
    installPlan: (request) => installPlanUseCase(environment, request),
    installApply: (applyOptions) => installApplyUseCase(environment, applyOptions),
    installVerify: (verifyOptions) => installVerifyUseCase(environment, verifyOptions)
  };
}

async function scopeRead<T>(read: () => Promise<UseCaseResult<T>>, scope?: ProfileScope): Promise<UseCaseResult<T>> {
  try {return await read();} catch (error) {
    if (scope?.kind !== 'project') throw error;
    return failWith(createMachineError('INVALID_REQUEST', String(error), {field: 'scope', path: scope.rootPath}));
  }
}
