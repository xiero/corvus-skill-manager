import type {AgentAdapter, AgentId} from './AgentAdapter.js';

export const agentAdapters = [
  {
    id: 'codex',
    displayName: 'OpenAI Codex CLI',
    supportStatus: 'supported',
    defaultTargetPath: '~/.agents/skills'
  },
  {
    id: 'claude',
    displayName: 'Claude Code',
    supportStatus: 'supported',
    defaultTargetPath: '~/.claude/skills'
  },
  {
    id: 'copilot',
    displayName: 'GitHub Copilot CLI',
    supportStatus: 'supported',
    defaultTargetPath: '~/.copilot/skills',
    notes: ['Uses the implementation-plan Copilot CLI skill path strategy.']
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    supportStatus: 'supported',
    defaultTargetPath: '~/.config/opencode/skills',
    notes: ['Uses the implementation-plan OpenCode skill path strategy.']
  },
  {
    id: 'pi',
    displayName: 'Pi Agent',
    supportStatus: 'supported',
    defaultTargetPath: '~/.pi/agent/skills',
    notes: ['Uses the implementation-plan Pi Agent skill path strategy.']
  },
  {
    id: 'custom',
    displayName: 'Custom Agent',
    supportStatus: 'custom',
    notes: ['Set a target path before planning links.']
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    supportStatus: 'supported',
    defaultTargetPath: '~/.gemini/skills',
    notes: ['Uses Gemini CLI Agent Skills directory support.']
  }
] as const satisfies AgentAdapter[];

export function getAgentAdapters(): AgentAdapter[] {
  return agentAdapters.map((adapter) => ({...adapter}));
}

export function getAgentAdapter(agentId: AgentId): AgentAdapter | undefined {
  const adapter = agentAdapters.find((candidate) => candidate.id === agentId);
  return adapter === undefined ? undefined : {...adapter};
}
