import React from 'react';
import {Box, Text, useInput} from 'ink';

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
        <Text>1. Setup Skillpack: preview, then confirm the initial revision clone when active snapshot is missing.</Text>
        <Text>2. Configure Agents: enable one or more supported agents.</Text>
        <Text>3. Press Enter on an enabled agent, then Space on each skill you want linked.</Text>
        <Text>4. Press b to return to agents, then s to save the selected agents and skills.</Text>
        <Text>5. Review the apply plan. It should show create-link operations for selected skills.</Text>
        <Text>6. Press a, then y to apply only after the confirmation screen is shown.</Text>
      </Box>

      <Box flexDirection="column">
        <Text bold>Common Gotchas</Text>
        <Text color="yellow">No selected skills means no links are created.</Text>
        <Text>Saving config stores selections; it does not create filesystem links.</Text>
        <Text>The apply plan is dry-run until you confirm it with y.</Text>
        <Text>Remote skillpack updates need preview and approval before current changes.</Text>
        <Text>Existing unmanaged files or directories at target paths become conflicts.</Text>
        <Text>Gemini is visible for planning context, but deferred for the MVP.</Text>
      </Box>

      <Box flexDirection="column">
        <Text bold>Useful Checks</Text>
        <Text>Status shows configured state, selected skills, commits, remote update state, dirty state, and link count.</Text>
        <Text>Doctor explains missing config, registry/SKILL.md issues, broken links, and conflicts.</Text>
        <Text>The manager never repairs, pulls, resets, or edits the active skillpack checkout from these views.</Text>
      </Box>

      <Text dimColor>Press h or q for Home.</Text>
    </Box>
  );
}
