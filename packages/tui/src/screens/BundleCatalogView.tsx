import React from 'react';
import {Box, Text} from 'ink';
import type {BundleCatalogEntry} from '@corvus-tools/skill-manager-core';

export type RootSelectionState = 'all' | 'some' | 'none';

export function BundleCatalogView({
  bundles,
  selectedIndex,
  selectionStates,
  dependenciesByBundle = {}
}: {
  bundles: BundleCatalogEntry[];
  selectedIndex: number;
  selectionStates: ReadonlyMap<string, RootSelectionState>;
  dependenciesByBundle?: Readonly<Record<string, string[]>>;
}): React.ReactElement {
  const selectedBundle = bundles[selectedIndex];

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>Bundles</Text>
        <Text dimColor>Maintained compositions; bundles have no link target or runtime of their own.</Text>
        {bundles.length === 0 ? <Text dimColor>No Registry v3 bundles discovered.</Text> : null}
        {bundles.map((bundle, index) => {
          const ref = bundle.ref ?? bundle.id;
          const selected = index === selectedIndex;
          const incompatible = bundle.compatibility?.some((entry) => !entry.compatible) ?? false;
          const state = selectionStates.get(ref) ?? 'none';
          const marker = incompatible
            ? state === 'all' ? '[!x]' : state === 'some' ? '[!~]' : '[!]'
            : state === 'all' ? '[x]' : state === 'some' ? '[~]' : '[ ]';
          const line = `${selected ? '>' : ' '} ${marker} ${ref}@${bundle.version} - ${bundle.title}`;

          return selected ? (
            <Text key={ref} color={incompatible ? 'red' : 'cyan'}>{line}</Text>
          ) : incompatible ? (
            <Text key={ref} color="red">{line}</Text>
          ) : (
            <Text key={ref}>{line}</Text>
          );
        })}
      </Box>
      {selectedBundle === undefined ? null : (
        <BundleDetailView
          bundle={selectedBundle}
          dependencyIds={dependenciesByBundle[selectedBundle.ref ?? selectedBundle.id] ?? []}
        />
      )}
    </Box>
  );
}

export function BundleDetailView({
  bundle,
  dependencyIds = []
}: {
  bundle: BundleCatalogEntry;
  dependencyIds?: string[];
}): React.ReactElement {
  const incompatible = bundle.compatibility?.filter((entry) => !entry.compatible) ?? [];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={incompatible.length > 0 ? 'red' : 'cyan'} paddingX={1}>
      <Text bold>Bundle Detail: {bundle.ref ?? bundle.id}@{bundle.version}</Text>
      <Text>{bundle.description}</Text>
      <Text>Direct members ({bundle.members.length})</Text>
      {bundle.members.map((member) => (
        <Text key={member.ref ?? member.id}>
          - {member.ref ?? member.id} {member.versionRange} (snapshot {member.actualVersion ?? 'unknown'})
        </Text>
      ))}
      <Text>Additional dependencies: {dependencyIds.length === 0 ? 'none' : dependencyIds.join(', ')}</Text>
      <Text>Compatible agents: {bundle.supportedAgents.length === 0 ? 'none' : bundle.supportedAgents.join(', ')}</Text>
      {incompatible.map((compatibility) => (
        <Box key={compatibility.agentId} flexDirection="column">
          <Text color="red">Incompatible with {compatibility.agentId}:</Text>
          {compatibility.issues.map((issue) => (
            <Text key={`${issue.code}-${issue.memberId}-${issue.skillId}`} color="red">
              - {issue.message}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}
