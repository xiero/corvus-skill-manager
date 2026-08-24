import type {ApplicationEnvironment} from './ports.js';
import type {UseCaseResult} from './protocol/result.js';
import type {CapabilitiesData} from './useCases/capabilitiesUseCase.js';
import type {
  InstallApplyData,
  InstallApplyOptions,
  InstallPlanData,
  InstallVerifyData
} from './useCases/installUseCases.js';
import type {
  SkillpackSetupApplyData,
  SkillpackSetupPlanData,
  SkillpackSetupPlanOptions,
  SkillpackRemoveApplyData,
  SkillpackRemovePlanData,
  SkillpackUpdateApplyData,
  SkillpackUpdateCheckData,
  SkillpackUpdatePreviewData
} from './useCases/skillpackUseCases.js';
import type {
  BundlesInspectData,
  BundlesInspectOptions,
  BundlesListData,
  BundlesListOptions,
  BundlesSearchData,
  BundlesSearchOptions,
  DiscoverSkillsData,
  SkillsInspectData,
  SkillsInspectOptions,
  SkillsListData,
  SkillsListOptions,
  SkillsSearchData,
  SkillsSearchOptions,
  ValidateRegistryData
} from './useCases/skillsUseCases.js';
import type {
  AgentListData,
  DoctorData,
  SkillpackStatusData,
  StatusData,
  StatusUseCaseOptions
} from './useCases/statusUseCases.js';

/**
 * The shared workflow surface. The Ink TUI and the machine CLI both call these methods, so
 * setup, discovery, planning, apply, and verification have exactly one implementation.
 *
 * Every method returns a protocol-layer result rather than a rendered string, and no method
 * parses a command line.
 */
export interface CorvusApplication {
  readonly environment: ApplicationEnvironment;

  capabilities(): UseCaseResult<CapabilitiesData>;

  status(options?: StatusUseCaseOptions): Promise<UseCaseResult<StatusData>>;
  doctor(options?: StatusUseCaseOptions): Promise<UseCaseResult<DoctorData>>;
  listAgents(): Promise<UseCaseResult<AgentListData>>;

  skillpackStatus(options?: StatusUseCaseOptions): Promise<UseCaseResult<SkillpackStatusData>>;
  skillpackSetupPlan(options?: SkillpackSetupPlanOptions): Promise<UseCaseResult<SkillpackSetupPlanData>>;
  skillpackSetupApply(options: {
    planId: string;
    confirm: string;
  }): Promise<UseCaseResult<SkillpackSetupApplyData>>;
  skillpackUpdateCheck(options?: {skillpackId?: string}): Promise<UseCaseResult<SkillpackUpdateCheckData>>;
  skillpackUpdatePreview(options?: {skillpackId?: string}): Promise<UseCaseResult<SkillpackUpdatePreviewData>>;
  skillpackUpdateApply(options: {
    planId: string;
    confirm: string;
  }): Promise<UseCaseResult<SkillpackUpdateApplyData>>;
  skillpackRemovePlan(options: {skillpackId: string}): Promise<UseCaseResult<SkillpackRemovePlanData>>;
  skillpackRemoveApply(options: {
    planId: string;
    confirm: string;
  }): Promise<UseCaseResult<SkillpackRemoveApplyData>>;

  /** Raw discovery result, sharing the same precondition handling as the catalog commands. */
  discoverSkills(): Promise<UseCaseResult<DiscoverSkillsData>>;
  listSkills(options?: SkillsListOptions): Promise<UseCaseResult<SkillsListData>>;
  searchSkills(options: SkillsSearchOptions): Promise<UseCaseResult<SkillsSearchData>>;
  inspectSkills(options: SkillsInspectOptions): Promise<UseCaseResult<SkillsInspectData>>;
  validateRegistry(): Promise<UseCaseResult<ValidateRegistryData>>;
  listBundles(options?: BundlesListOptions): Promise<UseCaseResult<BundlesListData>>;
  searchBundles(options: BundlesSearchOptions): Promise<UseCaseResult<BundlesSearchData>>;
  inspectBundles(options: BundlesInspectOptions): Promise<UseCaseResult<BundlesInspectData>>;

  /** `request` is an unvalidated request document; it is parsed against the public schema. */
  installPlan(request: unknown): Promise<UseCaseResult<InstallPlanData>>;
  installApply(options: InstallApplyOptions): Promise<UseCaseResult<InstallApplyData>>;
  installVerify(options: {planId: string}): Promise<UseCaseResult<InstallVerifyData>>;
}
