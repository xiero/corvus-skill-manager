import {describe, expect, it} from 'vitest';
import {
  agentConfigChangeSchema,
  computePlanDigest,
  computeStateFingerprint,
  createPlanArtifact,
  parsePersistedPlan,
  planSchemaVersion
} from './planSchema.js';

describe('plan schema v2 root config changes', () => {
  it('keeps skill and bundle roots separate and canonical', () => {
    const change = agentConfigChangeSchema.parse({
      agentId: 'codex',
      enabledFrom: false,
      enabledTo: true,
      selectedSkillIdsFrom: ['team:z', 'team:a', 'team:z'],
      selectedSkillIdsTo: ['team:b', 'team:a'],
      selectedBundleIdsFrom: ['team:old', 'team:old'],
      selectedBundleIdsTo: ['team:z-flow', 'team:a-flow', 'team:z-flow']
    });

    expect(change.selectedSkillIdsFrom).toEqual(['team:a', 'team:z']);
    expect(change.selectedSkillIdsTo).toEqual(['team:a', 'team:b']);
    expect(change.selectedBundleIdsFrom).toEqual(['team:old']);
    expect(change.selectedBundleIdsTo).toEqual(['team:a-flow', 'team:z-flow']);
  });

  it('gives ordering-independent root changes identical digests after normalization', () => {
    const first = agentConfigChangeSchema.parse({
      agentId: 'codex',
      enabledFrom: true,
      enabledTo: true,
      selectedSkillIdsFrom: ['team:b', 'team:a'],
      selectedSkillIdsTo: ['team:d', 'team:c'],
      selectedBundleIdsFrom: ['team:y', 'team:x'],
      selectedBundleIdsTo: ['team:n', 'team:m']
    });
    const second = agentConfigChangeSchema.parse({
      ...first,
      selectedSkillIdsFrom: [...first.selectedSkillIdsFrom].reverse(),
      selectedSkillIdsTo: [...first.selectedSkillIdsTo].reverse(),
      selectedBundleIdsFrom: [...first.selectedBundleIdsFrom].reverse(),
      selectedBundleIdsTo: [...first.selectedBundleIdsTo].reverse()
    });

    expect(computePlanDigest('install', {configChanges: [first]})).toBe(
      computePlanDigest('install', {configChanges: [second]})
    );
  });

  it('creates schema v2 artifacts and rejects schema v1 artifacts', () => {
    const artifact = createPlanArtifact({
      kind: 'skillpack-remove',
      now: new Date('2026-08-24T20:00:00.000Z'),
      payload: {
        skillpackId: 'team',
        repositoryUrl: 'https://example.test/team.git',
        activePath: '/tmp/team/current',
        configPath: '/tmp/manager/config.json',
        managerStateDir: '/tmp/manager',
        stateFingerprint: computeStateFingerprint({skillpack: 'team'})
      }
    });

    expect(planSchemaVersion).toBe(2);
    expect(parsePersistedPlan(artifact).planSchemaVersion).toBe(2);
    expect(() => parsePersistedPlan({...artifact, planSchemaVersion: 1})).toThrow();
  });
});
