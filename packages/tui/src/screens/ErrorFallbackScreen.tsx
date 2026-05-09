import React from 'react';
import {Box, Text} from 'ink';

export interface ErrorFallbackScreenProps {
  error: Error;
}

export function ErrorFallbackScreen({error}: ErrorFallbackScreenProps): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="red">Corvus Skill Manager hit a TUI error</Text>
      <Text>{error.message}</Text>
      <Box flexDirection="column">
        <Text dimColor>No repair or filesystem apply action was attempted.</Text>
        <Text dimColor>Restart the TUI, then open Doctor for a read-only health check.</Text>
      </Box>
    </Box>
  );
}
