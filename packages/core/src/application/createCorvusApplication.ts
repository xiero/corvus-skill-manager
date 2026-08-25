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
    capabilities: () => capabilitiesUseCase(environment),
    status: (statusOptions) => statusUseCase(environment, statusOptions),
    doctor: (statusOptions) => doctorUseCase(environment, statusOptions),
    listAgents: () => agentsListUseCase(environment),
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
