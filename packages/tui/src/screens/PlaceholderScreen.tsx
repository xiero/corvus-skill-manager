import React from 'react';
import {Box, Text} from 'ink';

export interface PlaceholderScreenProps {
  title: string;
  body: string;
}

export function PlaceholderScreen({title, body}: PlaceholderScreenProps): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{title}</Text>
      <Text>{body}</Text>
      <Text dimColor>Press h to return Home, q to exit.</Text>
    </Box>
  );
}
