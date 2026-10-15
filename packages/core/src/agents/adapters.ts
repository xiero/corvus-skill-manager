import type {AgentAdapter, AgentId} from './AgentAdapter.js';

export const agentAdapters = [
  {
    id: 'codex',
    projectTargetPath: '.agents/skills',
    displayName: 'OpenAI Codex CLI',
    supportStatus: 'supported',
    defaultTargetPath: '~/.agents/skills'
  },
  {
    id: 'claude',
    projectTargetPath: '.claude/skills',
    displayName: 'Claude Code',
    supportStatus: 'supported',
    defaultTargetPath: '~/.claude/skills'
  },
  {
    id: 'copilot',
    projectTargetPath: '.github/skills',
    displayName: 'GitHub Copilot CLI',
    supportStatus: 'supported',
    defaultTargetPath: '~/.copilot/skills',
    notes: ['Uses the implementation-plan Copilot CLI skill path strategy.']
  },
  {
    id: 'opencode',
    projectTargetPath: '.opencode/skills',
    displayName: 'OpenCode',
    supportStatus: 'supported',
    defaultTargetPath: '~/.config/opencode/skills',
    notes: ['Uses the implementation-plan OpenCode skill path strategy.']
  },
  {
    id: 'pi',
    projectTargetPath: '.pi/skills',
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
    projectTargetPath: '.gemini/skills',
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
