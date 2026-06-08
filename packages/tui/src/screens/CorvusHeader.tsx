import React from 'react';
import {Box, Text} from 'ink';

const bannerLines = [
  {text: '  ██████╗ ██████╗ ██████╗ ██╗   ██╗██╗   ██╗███████╗', color: '#00d7ff'},
  {text: ' ██╔════╝██╔═══██╗██╔══██╗██║   ██║██║   ██║██╔════╝', color: '#2f7dff'},
  {text: ' ██║     ██║   ██║██████╔╝██║   ██║██║   ██║███████╗', color: '#00f5ff'},
  {text: ' ██║     ██║   ██║██╔══██╗╚██╗ ██╔╝██║   ██║╚════██║', color: '#8b5cf6'},
  {text: ' ╚██████╗╚██████╔╝██║  ██║ ╚████╔╝ ╚██████╔╝███████║', color: '#00d7ff'},
  {text: '  ╚═════╝ ╚═════╝ ╚═╝  ╚═╝  ╚═══╝   ╚═════╝ ╚══════╝', color: '#14f1d9'},
  {text: '  ░░░░░░  ░░░░░░░  ░░   ░░   ░░░     ░░░░░   ░░░░░░░ ', color: '#2f7dff'},
  {text: '        S K I L L   M A N A G E R', color: '#14f1d9'}
] as const;

export interface CorvusHeaderProps {
  version?: string;
}

export function CorvusHeader({version}: CorvusHeaderProps = {}): React.ReactElement {
  const versionLabel = version === undefined ? undefined : (
    version.startsWith('v') ? version : `v${version}`
  );

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#00d7ff" paddingX={1}>
      {bannerLines.map((line) => (
        <Text key={line.text} bold color={line.color}>
          {line.text}
        </Text>
      ))}
      <Text dimColor>
        Corvus Skill Manager{versionLabel === undefined ? '' : ` ${versionLabel}`}
      </Text>
      <Text>TUI-first skill wiring for coding agents.</Text>
    </Box>
  );
}
