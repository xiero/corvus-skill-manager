export {
  type ConfigLoadResult,
  type ConfigStoreOptions,
  ensureDefaultConfig,
  loadConfig,
  saveConfig
} from './config/configStore.js';
export {
  type AgentConfig,
  type AgentIdConfig,
  type ManagerConfig,
  type SkillpackConfig,
  agentConfigSchema,
  agentIdSchema,
  createDefaultManagerConfig,
  managerConfigSchema,
  parseManagerConfig,
  parseSkillpackConfig,
  skillpackConfigSchema
} from './config/configSchema.js';
export {type AgentAdapter, type AgentId, type AgentSupportStatus} from './agents/AgentAdapter.js';
export {agentAdapters, getAgentAdapter, getAgentAdapters} from './agents/adapters.js';
export {
  type CheckoutStatus,
  type SkillpackInspection,
  type SkillpackSetupOptions,
  type SkillpackSetupResult,
  type SkillpackSetupStatus,
  applyInitialSkillpackSetup,
  inspectSkillpackCheckout
} from './git/skillpackSetup.js';
export {type GitRunner, type GitRunOptions, type GitRunResult, runGit} from './git/gitRunner.js';
export {
  type ManagerLock,
  type SkillpackLockEntry,
  createEmptyManagerLock,
  managerLockSchema,
  parseManagerLock,
  skillpackLockEntrySchema
} from './lock/lockSchema.js';
export {
  type LockStoreOptions,
  getDefaultLockPath,
  loadLock,
  saveLock,
  upsertSkillpackLockEntry
} from './lock/lockStore.js';
export {
  type RegistrySkillEntry,
  type SkillRegistry,
  type SupportedAgent,
  registrySkillEntrySchema,
  skillRegistrySchema,
  supportedAgentSchema
} from './registry/registrySchema.js';
export {
  type DiscoveredSkill,
  type SkillDiscoveryIssue,
  type SkillDiscoveryResult,
  type SkillDiscoverySeverity,
  type SkillRiskWarning,
  discoverSkillsFromCheckout
} from './skills/skillDiscovery.js';
export {
  type AgentLinkSelection,
  type GenerateLinkPlanInput,
  type LinkCreateOperation,
  type LinkPlan,
  type LinkPlanIssue,
  type LinkPlanOperation,
  type LinkPlanSkill,
  type LinkRemoveOperation,
  type TargetState,
  generateLinkPlan
} from './links/linkPlan.js';
export {
  assertPathInside,
  configFileName,
  defaultConfigPath,
  defaultLockPath,
  defaultManagerStateDir,
  defaultSkillpackCheckoutPath,
  expandTilde,
  isPathInside,
  lockFileName,
  managerStateDirSegments,
  resolveUserPath
} from './paths.js';
export {
  defaultSkillpackBranch,
  defaultSkillpackDisplayName,
  defaultSkillpackId,
  defaultSkillpackRepositoryUrl
} from './skillpackDefaults.js';
