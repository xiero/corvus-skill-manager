import React from 'react';
import {Box, Text} from 'ink';
import {CommandBar} from './CommandBar.js';

export interface HomeMenuItem {
  label: string;
  hint: string;
}

export type ConfigStatus = 'loading' | 'created' | 'exists' | 'error';

export interface HomeScreenProps {
  configPath: string;
  configStatus: ConfigStatus;
  menuItems: HomeMenuItem[];
  selectedIndex: number;
  errorMessage?: string;
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
  errorMessage
}: HomeScreenProps): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
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
