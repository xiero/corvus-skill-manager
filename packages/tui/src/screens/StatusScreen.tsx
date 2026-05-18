import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {
  type StatusReport,
  buildStatusReport
} from '@corvus-tools/skill-manager-core';
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

  useEffect(() => {
    let active = true;
    setState({status: 'loading'});

    buildStatusReport({configPath, checkRemote: true})
      .then((report) => {
        if (active) {
          setState({status: 'loaded', report});
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
  }, [configPath]);

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
        <Text bold>Skillpack</Text>
        {report.skillpack === undefined ? <Text color="yellow">Not configured.</Text> : (
          <>
            <Text>ID: {report.skillpack.id}</Text>
            <Text>Checkout: {report.skillpack.checkoutPath}</Text>
            <Text>Repository: {report.skillpack.repositoryUrl}</Text>
            <Text>Branch: {report.skillpack.branch}</Text>
            <Text>Recorded commit: {report.skillpack.recordedCommit ?? '(none)'}</Text>
            <Text>Current commit: {report.skillpack.currentCommit ?? '(unreadable)'}</Text>
            {report.skillpack.activeRevisionPath === undefined ? null : (
              <Text>Active revision: {report.skillpack.activeRevisionPath}</Text>
            )}
            <Text>Remote commit: {report.skillpack.remoteCommit ?? '(not checked)'}</Text>
            {report.skillpack.updateAvailable === undefined ? null : (
              <Text>
                Remote update:{' '}
                <Text color={report.skillpack.updateAvailable ? 'yellow' : 'green'}>
                  {report.skillpack.updateAvailable ? 'available' : 'none'}
                </Text>
              </Text>
            )}
            {report.skillpack.updateMessage === undefined ? null : <Text dimColor>{report.skillpack.updateMessage}</Text>}
            <Text>
              Dirty:{' '}
              <Text color={report.skillpack.dirty ? 'yellow' : 'green'}>
                {report.skillpack.dirty === undefined ? 'unknown' : report.skillpack.dirty ? 'yes' : 'no'}
              </Text>
            </Text>
            <Text>
              Discovered skills: {report.skillpack.discoveredSkillCount} ({report.skillpack.discoveryWarningCount} warnings,{' '}
              {report.skillpack.discoveryErrorCount} errors)
            </Text>
          </>
        )}
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
