import React from 'react';
import {Box, Text} from 'ink';

export interface CommandHint {
  key: string;
  label: string;
  tone?: 'apply';
}

export function CommandBar({hints}: {hints: CommandHint[]}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="black" backgroundColor="#00d7ff"> keys </Text>
        {' '}
        {hints.map((hint, index) => (
          <React.Fragment key={`${hint.key}-${hint.label}`}>
            {index === 0 ? null : <Text color="#2f7dff"> │ </Text>}
            <Text color="black" backgroundColor={hint.tone === 'apply' ? '#14f1d9' : '#00f5ff'}>
              {' '}
              {hint.key}
              {' '}
            </Text>
            {hint.tone === 'apply' ? (
              <Text color="#14f1d9"> {hint.label}</Text>
            ) : (
              <Text> {hint.label}</Text>
            )}
          </React.Fragment>
        ))}
      </Text>
    </Box>
  );
}
