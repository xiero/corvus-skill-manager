import React from 'react';
import {Box, Text} from 'ink';
import type {ManagerPackageRuntime, ManagerSelfUpdateInspection} from '@corvus-tools/skill-manager-core';
import {CommandBar} from './CommandBar.js';

export interface HomeMenuItem {
  label: string;
  hint: string;
}

export type ConfigStatus = 'loading' | 'created' | 'exists' | 'error';

export type HomeManagerUpdateState =
  | (Pick<ManagerPackageRuntime, 'packageName' | 'currentVersion'> & {status: 'checking'})
  | ManagerSelfUpdateInspection;

export interface HomeScreenProps {
  configPath: string;
  configStatus: ConfigStatus;
  menuItems: HomeMenuItem[];
  selectedIndex: number;
  errorMessage?: string;
  managerUpdate?: HomeManagerUpdateState;
}

const statusText: Record<ConfigStatus, string> = {
  loading: 'checking',
  created: 'created',
  exists: 'exists',
  error: 'error'
};

export function HomeScreen({
  configPath,
  configStatus,
  menuItems,
  selectedIndex,
  errorMessage,
  managerUpdate
}: HomeScreenProps): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      {managerUpdate === undefined ? null : <ManagerUpdateNotice managerUpdate={managerUpdate} />}

      <Box flexDirection="column">
        <Text>
          Config path: <Text color="cyan">{configPath}</Text>
        </Text>
        <Text>
          Config status: <Text color={configStatus === 'error' ? 'red' : 'green'}>{statusText[configStatus]}</Text>
        </Text>
        {errorMessage === undefined ? null : <Text color="red">{errorMessage}</Text>}
      </Box>

      <Box flexDirection="column">
        {menuItems.map((item, index) => {
          const menuText = (
            <>
              {index === selectedIndex ? '>' : ' '} {item.label} <Text dimColor>{item.hint}</Text>
            </>
          );

          return index === selectedIndex ? (
            <Text key={item.label} color="cyan">
              {menuText}
            </Text>
          ) : (
            <Text key={item.label}>{menuText}</Text>
          );
        })}
      </Box>

      <CommandBar
        hints={[
          {key: 'up/down', label: 'move'},
          {key: 'j/k', label: 'move'},
          {key: 'enter', label: 'select'},
          {key: 'h', label: 'Home'},
          {key: 'q', label: 'exit'}
        ]}
      />
    </Box>
  );
}

function ManagerUpdateNotice({
  managerUpdate
}: {
  managerUpdate: HomeManagerUpdateState;
}): React.ReactElement | null {
  if (managerUpdate.status === 'checking') {
    return <Text dimColor>Manager update: checking npm release for {managerUpdate.packageName}...</Text>;
  }

  if (managerUpdate.status === 'update-available') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text color="yellow">
          Manager update available: {managerUpdate.currentVersion} {'->'} {managerUpdate.latestVersion}
        </Text>
        <Text>Run: <Text color="cyan">{managerUpdate.updateCommand}</Text></Text>
      </Box>
    );
  }

  if (managerUpdate.status === 'check-failed') {
    return <Text dimColor>{managerUpdate.message}</Text>;
  }

  return null;
}
