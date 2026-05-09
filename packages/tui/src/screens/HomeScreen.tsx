import React from 'react';
import {Box, Text} from 'ink';

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

const bannerLines = [
  {text: '   ______ ____  ____  _   _ _   _ ____', color: '#00d7ff'},
  {text: '  / ____/ __ \\|  _ \\| | | | | | / ___|', color: '#2f7dff'},
  {text: ' | |   | |  | | |_) | | | | | | \\___ \\', color: '#00f5ff'},
  {text: ' | |___| |__| |  _ <| |_| | |_| |___) |', color: '#8b5cf6'},
  {text: '  \\_____\\____/|_| \\_\\\\___/ \\___/|____/', color: '#00d7ff'},
  {text: '        S K I L L   M A N A G E R', color: '#14f1d9'}
] as const;

export function HomeScreen({
  configPath,
  configStatus,
  menuItems,
  selectedIndex,
  errorMessage
}: HomeScreenProps): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column" borderStyle="single" borderColor="#00d7ff" paddingX={1}>
        {bannerLines.map((line) => (
          <Text key={line.text} bold color={line.color}>
            {line.text}
          </Text>
        ))}
        <Text dimColor>Corvus Skill Manager</Text>
        <Text>TUI-first skill wiring for coding agents.</Text>
      </Box>

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

      <Text dimColor>Use up/down or j/k to move, enter to select, h for Home, q to exit.</Text>
    </Box>
  );
}
