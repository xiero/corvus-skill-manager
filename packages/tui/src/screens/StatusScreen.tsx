import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {StatusReport} from '@corvus-tools/skill-manager-core';
import {useCorvusApplication} from '../application/applicationContext.js';
import {describeMachineErrors} from '../application/errorMessages.js';
import {CommandBar} from './CommandBar.js';

type StatusScreenState =
  | {status: 'loading'}
  | {status: 'loaded'; report: StatusReport}
  | {status: 'error'; message: string};

export interface StatusScreenProps {
  configPath: string;
  onBack: () => void;
}

export function StatusScreen({configPath, onBack}: StatusScreenProps): React.ReactElement {
  const [state, setState] = useState<StatusScreenState>({status: 'loading'});
  const application = useCorvusApplication(configPath);

  useEffect(() => {
    let active = true;
    setState({status: 'loading'});

    application
      .status({checkRemote: true})
      .then((result) => {
        if (!active) {
          return;
        }

        setState(
          result.ok
            ? {status: 'loaded', report: result.data.report}
            : {status: 'error', message: describeMachineErrors(result.errors)}
        );
      })
      .catch((error: unknown) => {
        if (active) {
          setState({status: 'error', message: error instanceof Error ? error.message : String(error)});
        }
      });

    return () => {
      active = false;
    };
  }, [application]);

  useInput((input) => {
    if (input === 'q' || input === 'h') {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Status</Text>
      <StatusBody state={state} />
      <CommandBar hints={[{key: 'h', label: 'Home'}, {key: 'q', label: 'Home'}]} />
    </Box>
  );
}

function StatusBody({state}: {state: StatusScreenState}): React.ReactElement {
  if (state.status === 'loading') {
    return <Text>Reading config, lock, manifest, skillpack, and filesystem state...</Text>;
  }

  if (state.status === 'error') {
    return <Text color="red">{state.message}</Text>;
  }

  return <StatusReportView report={state.report} />;
}

export function StatusReportView({report}: {report: StatusReport}): React.ReactElement {
  const enabledAgents = report.agents.filter((agent) => agent.enabled);

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text>
          Config: <Text color="cyan">{report.configPath}</Text>
        </Text>
        <Text>
          Config state:{' '}
          <Text color={report.configExists && report.configValid ? 'green' : 'red'}>
            {report.configExists ? report.configValid ? 'valid' : 'invalid' : 'missing'}
          </Text>
        </Text>
        {report.configError === undefined ? null : <Text color="red">{report.configError}</Text>}
      </Box>

      <Box flexDirection="column">
        <Text bold>Skillpacks ({report.skillpacks.length})</Text>
        {report.skillpacks.length === 0 ? <Text color="yellow">Not configured.</Text> : null}
        {report.skillpacks.map((skillpack) => (
          <Box key={skillpack.id} flexDirection="column" marginBottom={1}>
            <Text>ID: {skillpack.id}</Text>
            <Text>Checkout: {skillpack.checkoutPath}</Text>
            <Text>Repository: {skillpack.repositoryUrl}</Text>
            <Text>Branch: {skillpack.branch}</Text>
            <Text>Recorded commit: {skillpack.recordedCommit ?? '(none)'}</Text>
            <Text>Current commit: {skillpack.currentCommit ?? '(unreadable)'}</Text>
            {skillpack.activeRevisionPath === undefined ? null : (
              <Text>Active revision: {skillpack.activeRevisionPath}</Text>
            )}
            <Text>Remote commit: {skillpack.remoteCommit ?? '(not checked)'}</Text>
            {skillpack.updateAvailable === undefined ? null : (
              <Text>
                Remote update:{' '}
                <Text color={skillpack.updateAvailable ? 'yellow' : 'green'}>
                  {skillpack.updateAvailable ? 'available' : 'none'}
                </Text>
              </Text>
            )}
            {skillpack.updateMessage === undefined ? null : <Text dimColor>{skillpack.updateMessage}</Text>}
            <Text>
              Dirty:{' '}
              <Text color={skillpack.dirty ? 'yellow' : 'green'}>
                {skillpack.dirty === undefined ? 'unknown' : skillpack.dirty ? 'yes' : 'no'}
              </Text>
            </Text>
            <Text>
              Discovered skills: {skillpack.discoveredSkillCount} ({skillpack.discoveryWarningCount} warnings,{' '}
              {skillpack.discoveryErrorCount} errors)
            </Text>
          </Box>
        ))}
      </Box>

      <Box flexDirection="column">
        <Text bold>Agents</Text>
        {enabledAgents.length === 0 ? <Text dimColor>No enabled agents.</Text> : null}
        {enabledAgents.map((agent) => (
          <Text key={agent.id}>
            <Text color="green">{agent.displayName}</Text>
            {' -> '}
            {agent.targetPath ?? '(default)'} ::{' '}
            {agent.selectedSkillIds.length === 0 ? '(no skills)' : agent.selectedSkillIds.join(', ')}
          </Text>
        ))}
      </Box>

      <Box flexDirection="column">
        <Text bold>Managed Links</Text>
        <Text>Manifest: {report.manifestPath}</Text>
        <Text>Count: {report.managedLinkCount}</Text>
      </Box>
    </Box>
  );
}
