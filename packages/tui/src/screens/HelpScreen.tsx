import React from 'react';
import {Box, Text, useInput} from 'ink';
import {CommandBar} from './CommandBar.js';

export interface HelpScreenProps {
  onBack: () => void;
}

export function HelpScreen({onBack}: HelpScreenProps): React.ReactElement {
  useInput((input) => {
    if (input === 'q' || input === 'h') {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Help</Text>

      <Box flexDirection="column">
        <Text bold>Happy Path</Text>
        <Text>1. Start at Home, then open Guided Flow. The wizard inspects current state and recommends the next safe step.</Text>
        <Text>2. Skillpack: inspect first, then press a only for the safe setup/config action shown.</Text>
        <Text>3. Update: preview any remote change, then press a to activate a ready revision.</Text>
        <Text>4. Agents and Skills: enable supported agents, then select skills per agent.</Text>
        <Text>5. Plan: review the dry-run link plan. It should show create-link operations for selected skills.</Text>
        <Text>6. Apply: press a only after the final apply screen is shown.</Text>
      </Box>

      <Box flexDirection="column">
        <Text bold>Common Gotchas</Text>
        <Text color="yellow">No selected skills means no links are created.</Text>
        <Text>Saving config stores selections; it does not create filesystem links.</Text>
        <Text>The plan is dry-run until the Apply step is approved with a.</Text>
        <Text>Remote skillpack updates need preview and approval before current changes.</Text>
        <Text>A global manager install can be updated with npm install -g @corvus-tools/skill-manager@latest.</Text>
        <Text>Existing unmanaged files or directories at target paths become conflicts.</Text>
        <Text>Gemini uses Agent Skills links under its configured skills directory.</Text>
        <Text>Manual Setup Skillpack and Configure Agents remain available from Home for advanced changes.</Text>
      </Box>

      <Box flexDirection="column">
        <Text bold>Useful Checks</Text>
        <Text>Status shows configured state, selected skills, commits, remote update state, dirty state, and link count.</Text>
        <Text>Doctor explains missing config, registry/SKILL.md issues, broken links, and conflicts.</Text>
        <Text>The manager never repairs, pulls, resets, or edits the active skillpack checkout from these views.</Text>
      </Box>

      <CommandBar hints={[{key: 'h', label: 'Home'}, {key: 'q', label: 'Home'}]} />
    </Box>
  );
}
