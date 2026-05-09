export type AgentId = 'codex' | 'claude' | 'copilot' | 'opencode' | 'pi' | 'custom' | 'gemini';

export type AgentSupportStatus = 'supported' | 'deferred' | 'custom' | 'unavailable';

export interface AgentAdapter {
  id: AgentId;
  displayName: string;
  supportStatus: AgentSupportStatus;
  defaultTargetPath?: string;
  notes?: string[];
  warnings?: string[];
}
