import React from 'react';
import {Box, Text} from 'ink';
import type {
  AffectedBundleUpdate,
  RevisionEntityDelta
} from '@corvus-tools/skill-manager-core';

export function SemanticUpdateSummaryView({
  skillDeltas,
  bundleDeltas,
  affectedBundles
}: {
  skillDeltas: RevisionEntityDelta[];
  bundleDeltas: RevisionEntityDelta[];
  affectedBundles: AffectedBundleUpdate[];
}): React.ReactElement {
  const majorRisk =
    skillDeltas.some((delta) => delta.breakingRisk) ||
    bundleDeltas.some((delta) => delta.breakingRisk) ||
    affectedBundles.some((bundle) => bundle.breakingRisk);

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>Semantic Changes</Text>
        {majorRisk ? (
          <Text color="red">MAJOR VERSION RISK: review breaking changes before activation.</Text>
        ) : null}
        <DeltaList title="Skills" deltas={skillDeltas} />
        <DeltaList title="Bundles" deltas={bundleDeltas} />
      </Box>
      <Box flexDirection="column">
        <Text bold>Affected Selected Bundles</Text>
        {affectedBundles.length === 0 ? <Text dimColor>None.</Text> : null}
        {affectedBundles.map((bundle) => (
          <Box key={bundle.bundleId} flexDirection="column">
            <Text color={bundle.breakingRisk ? 'red' : 'yellow'}>
              {bundle.bundleId}{bundle.breakingRisk ? ' [MAJOR RISK]' : ''}
            </Text>
            {bundle.reasons.map((reason) => (
              <Text key={`${bundle.bundleId}-${reason.kind}-${reason.entityId}`}>
                - {reason.message}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
      <Text dimColor>Semantic risk is advisory; activation still requires explicit approval.</Text>
    </Box>
  );
}

function DeltaList({title, deltas}: {title: string; deltas: RevisionEntityDelta[]}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text>{title} ({deltas.length})</Text>
      {deltas.length === 0 ? <Text dimColor>None.</Text> : null}
      {deltas.map((delta) => delta.breakingRisk ? (
        <Text key={`${title}-${delta.id}`} color="red">- {formatDelta(delta)}</Text>
      ) : (
        <Text key={`${title}-${delta.id}`}>- {formatDelta(delta)}</Text>
      ))}
    </Box>
  );
}

function formatDelta(delta: RevisionEntityDelta): string {
  const version =
    delta.previousVersion !== undefined && delta.nextVersion !== undefined
      ? `${delta.previousVersion} -> ${delta.nextVersion}`
      : delta.previousVersion !== undefined
        ? `${delta.previousVersion} -> removed`
        : delta.nextVersion !== undefined
          ? `added at ${delta.nextVersion}`
          : 'unversioned/unknown';
  const risk = delta.breakingRisk ? ', MAJOR RISK' : '';
  return `${delta.id}: ${delta.change}, ${version} [${delta.versionChange}${risk}]`;
}
