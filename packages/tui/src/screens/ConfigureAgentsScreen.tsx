import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {
  type AgentAdapter,
  type AgentConfig,
  type AgentId,
  type DiscoveredSkill,
  type LinkPlan,
  type ManagerConfig,
  discoverSkillsFromCheckout,
  generateLinkPlan,
  getAgentAdapters,
  saveConfig
} from '@corvus-skill-manager/core';

type ConfigureMode = 'agents' | 'skills' | 'plan' | 'editing-target' | 'saving';

interface DraftAgentConfig {
  enabled: boolean;
  targetPath: string;
  selectedSkillIds: string[];
}

export interface ConfigureAgentsScreenProps {
  config: ManagerConfig;
  configPath: string;
  onBack: () => void;
  onConfigSaved: (config: ManagerConfig) => void;
}

const adapters = getAgentAdapters();

export function ConfigureAgentsScreen({
  config,
  configPath,
  onBack,
  onConfigSaved
}: ConfigureAgentsScreenProps): React.ReactElement {
  const [mode, setMode] = useState<ConfigureMode>('agents');
  const [selectedAgentIndex, setSelectedAgentIndex] = useState(0);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const [draftAgents, setDraftAgents] = useState<Record<AgentId, DraftAgentConfig>>(() =>
    createDraftAgents(config)
  );
  const [skills, setSkills] = useState<DiscoveredSkill[]>([]);
  const [discoveryErrors, setDiscoveryErrors] = useState<string[]>([]);
  const [discoveryWarnings, setDiscoveryWarnings] = useState<string[]>([]);
  const [plan, setPlan] = useState<LinkPlan | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  const selectedAdapter = adapters[selectedAgentIndex] ?? adapters[0];
  const selectedAgentDraft = selectedAdapter === undefined ? undefined : draftAgents[selectedAdapter.id];
  const currentSkillIds = new Set(selectedAgentDraft?.selectedSkillIds ?? []);
  const sortedSkills = useMemo(
    () => [...skills].sort((left, right) => left.id.localeCompare(right.id)),
    [skills]
  );

  useEffect(() => {
    if (config.skillpack === undefined) {
      setSkills([]);
      setDiscoveryErrors(['Skillpack is not configured.']);
      return;
    }

    let active = true;

    discoverSkillsFromCheckout(config.skillpack.checkoutPath)
      .then((result) => {
        if (!active) {
          return;
        }

        setSkills(result.skills);
        setDiscoveryErrors(result.errors.map((error) => error.message));
        setDiscoveryWarnings(result.warnings.map((warning) => warning.message));
      })
      .catch((error: unknown) => {
        if (active) {
          setDiscoveryErrors([error instanceof Error ? error.message : String(error)]);
        }
      });

    return () => {
      active = false;
    };
  }, [config.skillpack]);

  useInput((input, key) => {
    if (mode === 'saving') {
      return;
    }

    if (mode === 'editing-target') {
      if (key.return) {
        setMode('agents');
        return;
      }

      if (key.backspace || key.delete) {
        updateSelectedAgent((draft) => ({...draft, targetPath: draft.targetPath.slice(0, -1)}));
        return;
      }

      if (input.length > 0 && !key.ctrl && !key.meta) {
        updateSelectedAgent((draft) => ({...draft, targetPath: `${draft.targetPath}${input}`}));
      }

      return;
    }

    if (input === 'q' || input === 'h') {
      onBack();
      return;
    }

    if (input === 'p') {
      setPlan(createPlan());
      setMode('plan');
      return;
    }

    if (input === 's') {
      void saveDraft();
      return;
    }

    if (mode === 'plan') {
      if (input === 'b' || input === 'e') {
        setMode('agents');
      }

      return;
    }

    if (mode === 'skills') {
      if (input === 'b') {
        setMode('agents');
        return;
      }

      if (key.upArrow || input === 'k') {
        setSelectedSkillIndex((currentIndex) => Math.max(0, currentIndex - 1));
        return;
      }

      if (key.downArrow || input === 'j') {
        setSelectedSkillIndex((currentIndex) => Math.min(sortedSkills.length - 1, currentIndex + 1));
        return;
      }

      if (input === ' ') {
        const skill = sortedSkills[selectedSkillIndex];

        if (skill !== undefined && selectedAdapter !== undefined) {
          toggleSkill(selectedAdapter.id, skill.id);
        }
      }

      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedAgentIndex((currentIndex) => Math.max(0, currentIndex - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedAgentIndex((currentIndex) => Math.min(adapters.length - 1, currentIndex + 1));
      return;
    }

    if (input === ' ') {
      toggleSelectedAgent();
      return;
    }

    if (input === 't') {
      if (selectedAdapter !== undefined && selectedAdapter.supportStatus !== 'deferred') {
        setMode('editing-target');
      }

      return;
    }

    if (key.return) {
      if (selectedAgentDraft?.enabled === true) {
        setSelectedSkillIndex(0);
        setMode('skills');
      }
    }
  });

  function toggleSelectedAgent(): void {
    if (selectedAdapter === undefined) {
      return;
    }

    if (selectedAdapter.supportStatus === 'deferred' || selectedAdapter.supportStatus === 'unavailable') {
      setMessage(`${selectedAdapter.displayName} is ${selectedAdapter.supportStatus} for MVP.`);
      return;
    }

    updateSelectedAgent((draft) => ({...draft, enabled: !draft.enabled}));
    setMessage(undefined);
  }

  function updateSelectedAgent(updater: (draft: DraftAgentConfig) => DraftAgentConfig): void {
    if (selectedAdapter === undefined) {
      return;
    }

    setDraftAgents((currentDrafts) => ({
      ...currentDrafts,
      [selectedAdapter.id]: updater(currentDrafts[selectedAdapter.id])
    }));
  }

  function toggleSkill(agentId: AgentId, skillId: string): void {
    setDraftAgents((currentDrafts) => {
      const draft = currentDrafts[agentId];
      const selectedSkillIds = draft.selectedSkillIds.includes(skillId) ?
        draft.selectedSkillIds.filter((candidate) => candidate !== skillId) :
        [...draft.selectedSkillIds, skillId].sort((left, right) => left.localeCompare(right));

      return {
        ...currentDrafts,
        [agentId]: {
          ...draft,
          selectedSkillIds
        }
      };
    });
  }

  function createPlan(): LinkPlan {
    return generateLinkPlan({
      adapters,
      skills: sortedSkills.map((skill) => ({
        id: skill.id,
        absolutePath: skill.absolutePath
      })),
      selections: adapters.map((adapter) => ({
        agentId: adapter.id,
        enabled: draftAgents[adapter.id].enabled,
        targetPath: draftAgents[adapter.id].targetPath,
        selectedSkillIds: draftAgents[adapter.id].selectedSkillIds,
        previousSelectedSkillIds: config.agents?.[adapter.id]?.selectedSkillIds ?? []
      }))
    });
  }

  async function saveDraft(): Promise<void> {
    setMode('saving');

    try {
      const now = new Date().toISOString();
      const agents = Object.fromEntries(
        adapters.map((adapter) => [
          adapter.id,
          serializeAgentConfig(draftAgents[adapter.id])
        ])
      ) as Record<AgentId, AgentConfig>;
      const updatedConfig: ManagerConfig = {
        ...config,
        agents,
        updatedAt: now
      };

      await saveConfig(updatedConfig, {configPath});
      onConfigSaved(updatedConfig);
      setMessage('Agent selections saved to manager config.');
      setPlan(createPlan());
      setMode('plan');
    } catch (error) {
      setMessage(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
      setMode('agents');
    }
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>Configure Agents</Text>
        <Text dimColor>No links are created here. This screen only saves config and previews a plan.</Text>
        {message === undefined ? null : <Text color="cyan">{message}</Text>}
      </Box>

      {mode === 'skills' && selectedAdapter !== undefined ? (
        <SkillSelectionView
          adapter={selectedAdapter}
          skills={sortedSkills}
          selectedSkillIndex={selectedSkillIndex}
          selectedSkillIds={currentSkillIds}
          discoveryErrors={discoveryErrors}
        />
      ) : null}

      {mode === 'plan' ? <PlanView plan={plan ?? createPlan()} /> : null}

      {mode !== 'skills' && mode !== 'plan' ? (
        <AgentListView
          adapters={adapters}
          draftAgents={draftAgents}
          selectedAgentIndex={selectedAgentIndex}
          editingTarget={mode === 'editing-target'}
          discoveryWarnings={discoveryWarnings}
          discoveryErrors={discoveryErrors}
        />
      ) : null}

      <Text dimColor>{helpText(mode)}</Text>
    </Box>
  );
}

function createDraftAgents(config: ManagerConfig): Record<AgentId, DraftAgentConfig> {
  return Object.fromEntries(
    adapters.map((adapter) => {
      const configuredAgent = config.agents?.[adapter.id];
      const targetPath = configuredAgent?.targetPath ?? adapter.defaultTargetPath ?? '';

      return [
        adapter.id,
        {
          enabled: configuredAgent?.enabled ?? false,
          targetPath,
          selectedSkillIds: configuredAgent?.selectedSkillIds ?? []
        }
      ];
    })
  ) as Record<AgentId, DraftAgentConfig>;
}

function serializeAgentConfig(draft: DraftAgentConfig): AgentConfig {
  const targetPath = draft.targetPath.trim();
  const config: AgentConfig = {
    enabled: draft.enabled,
    selectedSkillIds: draft.selectedSkillIds
  };

  if (targetPath !== '') {
    config.targetPath = targetPath;
  }

  return config;
}

function AgentListView({
  adapters,
  draftAgents,
  selectedAgentIndex,
  editingTarget,
  discoveryWarnings,
  discoveryErrors
}: {
  adapters: AgentAdapter[];
  draftAgents: Record<AgentId, DraftAgentConfig>;
  selectedAgentIndex: number;
  editingTarget: boolean;
  discoveryWarnings: string[];
  discoveryErrors: string[];
}): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {adapters.map((adapter, index) => {
          const draft = draftAgents[adapter.id];
          const selected = index === selectedAgentIndex;
          const enabled = draft.enabled ? '[x]' : '[ ]';
          const status = adapter.supportStatus === 'supported' ? 'supported' : adapter.supportStatus;
          const target = draft.targetPath === '' ? '(set target path)' : draft.targetPath;
          const prefix = selected ? '>' : ' ';
          const line = `${prefix} ${enabled} ${adapter.displayName} (${status}) -> ${target}`;

          return selected ? (
            <Text key={adapter.id} color="cyan">
              {line}
              {editingTarget ? ' [editing]' : ''}
            </Text>
          ) : (
            <Text key={adapter.id}>{line}</Text>
          );
        })}
      </Box>

      <IssuePreview title="Discovery warnings" color="yellow" issues={discoveryWarnings} />
      <IssuePreview title="Discovery errors" color="red" issues={discoveryErrors} />
    </Box>
  );
}

function SkillSelectionView({
  adapter,
  skills,
  selectedSkillIndex,
  selectedSkillIds,
  discoveryErrors
}: {
  adapter: AgentAdapter;
  skills: DiscoveredSkill[];
  selectedSkillIndex: number;
  selectedSkillIds: Set<string>;
  discoveryErrors: string[];
}): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{adapter.displayName} Skills</Text>
      {skills.length === 0 ? <Text color="yellow">No valid skills discovered yet.</Text> : null}
      {skills.map((skill, index) => {
        const selected = index === selectedSkillIndex;
        const enabled = selectedSkillIds.has(skill.id) ? '[x]' : '[ ]';
        const line = `${selected ? '>' : ' '} ${enabled} ${skill.id} - ${skill.title}`;

        return selected ? (
          <Text key={skill.id} color="cyan">{line}</Text>
        ) : (
          <Text key={skill.id}>{line}</Text>
        );
      })}
      <IssuePreview title="Discovery errors" color="red" issues={discoveryErrors} />
    </Box>
  );
}

function PlanView({plan}: {plan: LinkPlan}): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>Apply Plan Preview</Text>
        <Text dimColor>This is a dry-run plan. No links or directories are created.</Text>
      </Box>
      <Box flexDirection="column">
        <Text>Operations ({plan.operations.length})</Text>
        {plan.operations.length === 0 ? <Text dimColor>None.</Text> : null}
        {plan.operations.map((operation) => (
          <Text key={`${operation.type}-${operation.agentId}-${operation.skillId}`}>
            {operation.type} {operation.agentId}/{operation.skillId} {'->'} {operation.targetPath}
          </Text>
        ))}
      </Box>
      <IssuePreview title="Conflicts" color="red" issues={plan.conflicts.map((conflict) => conflict.message)} />
      <IssuePreview title="Warnings" color="yellow" issues={plan.warnings.map((warning) => warning.message)} />
    </Box>
  );
}

function IssuePreview({
  title,
  color,
  issues
}: {
  title: string;
  color: 'red' | 'yellow';
  issues: string[];
}): React.ReactElement {
  if (issues.length === 0) {
    return <Text dimColor>{title}: none</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color={color}>{title} ({issues.length})</Text>
      {issues.slice(0, 4).map((issue, index) => (
        <Text key={`${title}-${index}`} color={color}>{issue}</Text>
      ))}
      {issues.length > 4 ? <Text color={color}>...and {issues.length - 4} more</Text> : null}
    </Box>
  );
}

function helpText(mode: ConfigureMode): string {
  if (mode === 'editing-target') {
    return 'Type target path, backspace to delete, enter to finish.';
  }

  if (mode === 'skills') {
    return 'Use up/down or j/k, space to toggle skill, b back, p plan, s save, h/q Home.';
  }

  if (mode === 'plan') {
    return 'Press b/e to edit, s to save config, h/q for Home.';
  }

  if (mode === 'saving') {
    return 'Saving manager config...';
  }

  return 'Use up/down or j/k, space toggle agent, enter skills, t target, p plan, s save, h/q Home.';
}
