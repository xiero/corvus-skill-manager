import type {AgentId, AgentSupportStatus} from '../agents/AgentAdapter.js';

export interface StatusReportAgent {
  id: AgentId;
  displayName: string;
  supportStatus: AgentSupportStatus;
  enabled: boolean;
  targetPath?: string;
  selectedSkillIds: string[];
}

export interface StatusReportSkillpack {
  id: string;
  repositoryUrl: string;
  branch: string;
  checkoutPath: string;
  activeRevisionPath?: string;
  recordedCommit?: string;
  currentCommit?: string;
  remoteCommit?: string;
  updateAvailable?: boolean;
  updateCheckStatus?: string;
  updateMessage?: string;
  checkoutExists: boolean;
  checkoutReadable: boolean;
  dirty?: boolean;
  dirtyFiles: string[];
  discoveredSkillCount: number;
  discoveryWarningCount: number;
  discoveryErrorCount: number;
}

export interface StatusReport {
  configPath: string;
  configExists: boolean;
  configValid: boolean;
  configError?: string;
  managerStateDir?: string;
  skillpack?: StatusReportSkillpack;
  agents: StatusReportAgent[];
  managedLinkCount: number;
  manifestPath: string;
  manifestValid: boolean;
  manifestError?: string;
}

export type DoctorIssueSeverity = 'error' | 'warning' | 'info';

export interface DoctorIssue {
  severity: DoctorIssueSeverity;
  code: string;
  message: string;
  action: string;
  path?: string;
  agentId?: AgentId;
  skillId?: string;
}

export interface DoctorReport {
  configPath: string;
  healthy: boolean;
  issues: DoctorIssue[];
  status: StatusReport;
}
