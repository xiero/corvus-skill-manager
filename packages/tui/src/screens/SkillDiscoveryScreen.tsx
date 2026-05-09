import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {
  type ManagerConfig,
  type SkillDiscoveryResult,
  discoverSkillsFromCheckout
} from '@corvus-skill-manager/core';

type DiscoveryState =
  | {status: 'not-configured'}
  | {status: 'loading'}
  | {status: 'loaded'; result: SkillDiscoveryResult}
  | {status: 'error'; message: string};

export interface SkillDiscoveryScreenProps {
  config?: ManagerConfig;
  onBack: () => void;
}

export function SkillDiscoveryScreen({config, onBack}: SkillDiscoveryScreenProps): React.ReactElement {
  const [state, setState] = useState<DiscoveryState>(
    config?.skillpack === undefined ? {status: 'not-configured'} : {status: 'loading'}
  );

  useEffect(() => {
    if (config?.skillpack === undefined) {
      setState({status: 'not-configured'});
      return;
    }

    let active = true;
    setState({status: 'loading'});

    discoverSkillsFromCheckout(config.skillpack.checkoutPath)
      .then((result) => {
        if (active) {
          setState({status: 'loaded', result});
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({status: 'error', message: error instanceof Error ? error.message : String(error)});
        }
      });

    return () => {
      active = false;
    };
  }, [config?.skillpack]);

  useInput((input) => {
    if (input === 'q' || input === 'h') {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Status</Text>
      <DiscoveryBody state={state} />
      <Text dimColor>Press h or q for Home.</Text>
    </Box>
  );
}

function DiscoveryBody({state}: {state: DiscoveryState}): React.ReactElement {
  if (state.status === 'not-configured') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">Skillpack not configured.</Text>
        <Text>Use Setup Skillpack before discovery.</Text>
      </Box>
    );
  }

  if (state.status === 'loading') {
    return <Text>Loading registry.json and SKILL.md metadata...</Text>;
  }

  if (state.status === 'error') {
    return <Text color="red">{state.message}</Text>;
  }

  return <DiscoveryResultView result={state.result} />;
}

export function DiscoveryResultView({result}: {result: SkillDiscoveryResult}): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text>
          Skillpack root: <Text color="cyan">{result.skillpackRoot}</Text>
        </Text>
        <Text>
          Registry: <Text color="cyan">{result.registryPath}</Text>
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text bold>Skills ({result.skills.length})</Text>
        {result.skills.length === 0 ? <Text dimColor>No valid skills discovered.</Text> : null}
        {result.skills.map((skill) => (
          <Box key={skill.id} flexDirection="column">
            <Text>
              <Text color="green">{skill.id}</Text> - {skill.title}
            </Text>
            <Text dimColor>
              {skill.description} [{skill.supportedAgents.join(', ')}]
            </Text>
            {skill.tags.length > 0 ? <Text dimColor>Tags: {skill.tags.join(', ')}</Text> : null}
          </Box>
        ))}
      </Box>

      <IssueList title="Warnings" color="yellow" issues={result.warnings} />
      <IssueList title="Errors" color="red" issues={result.errors} />
    </Box>
  );
}

function IssueList({
  title,
  color,
  issues
}: {
  title: string;
  color: 'yellow' | 'red';
  issues: Array<{code: string; message: string; skillId?: string}>;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>{title} ({issues.length})</Text>
      {issues.length === 0 ? <Text dimColor>None.</Text> : null}
      {issues.map((issue, index) => (
        <Text key={`${issue.code}-${issue.skillId ?? 'global'}-${index}`} color={color}>
          {issue.skillId === undefined ? '' : `${issue.skillId}: `}{issue.message}
        </Text>
      ))}
    </Box>
  );
}
