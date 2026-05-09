import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {
  type DoctorIssue,
  type DoctorReport,
  buildDoctorReport
} from '@corvus/skill-manager-core';

type DoctorScreenState =
  | {status: 'loading'}
  | {status: 'loaded'; report: DoctorReport}
  | {status: 'error'; message: string};

export interface DoctorScreenProps {
  configPath: string;
  onBack: () => void;
}

export function DoctorScreen({configPath, onBack}: DoctorScreenProps): React.ReactElement {
  const [state, setState] = useState<DoctorScreenState>({status: 'loading'});

  useEffect(() => {
    let active = true;
    setState({status: 'loading'});

    buildDoctorReport({configPath})
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
      <Text bold>Doctor</Text>
      <DoctorBody state={state} />
      <Text dimColor>Press h or q for Home.</Text>
    </Box>
  );
}

function DoctorBody({state}: {state: DoctorScreenState}): React.ReactElement {
  if (state.status === 'loading') {
    return <Text>Checking config, lock, manifest, registry, and links without modifying anything...</Text>;
  }

  if (state.status === 'error') {
    return <Text color="red">{state.message}</Text>;
  }

  return <DoctorReportView report={state.report} />;
}

export function DoctorReportView({report}: {report: DoctorReport}): React.ReactElement {
  const errors = report.issues.filter((issue) => issue.severity === 'error');
  const warnings = report.issues.filter((issue) => issue.severity === 'warning');
  const infos = report.issues.filter((issue) => issue.severity === 'info');

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text>
          Health:{' '}
          <Text color={report.healthy ? 'green' : 'red'}>
            {report.healthy ? 'healthy' : 'needs attention'}
          </Text>
        </Text>
        <Text>Config: {report.configPath}</Text>
      </Box>

      <IssueGroup title="Errors" color="red" issues={errors} />
      <IssueGroup title="Warnings" color="yellow" issues={warnings} />
      <IssueGroup title="Info" color="cyan" issues={infos} />
    </Box>
  );
}

function IssueGroup({
  title,
  color,
  issues
}: {
  title: string;
  color: 'red' | 'yellow' | 'cyan';
  issues: DoctorIssue[];
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>{title} ({issues.length})</Text>
      {issues.length === 0 ? <Text dimColor>None.</Text> : null}
      {issues.map((issue, index) => (
        <Box key={`${issue.code}-${issue.path ?? ''}-${index}`} flexDirection="column">
          <Text color={color}>
            {issue.code}: {issue.message}
          </Text>
          <Text dimColor>Action: {issue.action}</Text>
        </Box>
      ))}
    </Box>
  );
}
