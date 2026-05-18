import React from 'react';
import {Box, Text} from 'ink';
import {CommandBar} from './CommandBar.js';

export interface PlaceholderScreenProps {
  title: string;
  body: string;
}

export function PlaceholderScreen({title, body}: PlaceholderScreenProps): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{title}</Text>
      <Text>{body}</Text>
      <CommandBar hints={[{key: 'h', label: 'Home'}, {key: 'q', label: 'exit'}]} />
    </Box>
  );
}
