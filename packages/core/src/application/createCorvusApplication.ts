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
  skillpackSetupPlanUseCase,
  skillpackUpdateApplyUseCase,
  skillpackUpdateCheckUseCase,
  skillpackUpdatePreviewUseCase
} from './useCases/skillpackUseCases.js';
import {
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
    skillpackUpdateCheck: () => skillpackUpdateCheckUseCase(environment),
    skillpackUpdatePreview: () => skillpackUpdatePreviewUseCase(environment),
    skillpackUpdateApply: (applyOptions) => skillpackUpdateApplyUseCase(environment, applyOptions),
    discoverSkills: () => discoverSkillsUseCase(environment),
    listSkills: (listOptions) => skillsListUseCase(environment, listOptions),
    searchSkills: (searchOptions) => skillsSearchUseCase(environment, searchOptions),
    inspectSkills: (inspectOptions) => skillsInspectUseCase(environment, inspectOptions),
    validateRegistry: () => validateRegistryUseCase(environment),
    installPlan: (request) => installPlanUseCase(environment, request),
    installApply: (applyOptions) => installApplyUseCase(environment, applyOptions),
    installVerify: (verifyOptions) => installVerifyUseCase(environment, verifyOptions)
  };
}
