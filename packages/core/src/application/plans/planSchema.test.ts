import {describe, expect, it} from 'vitest';
import {
  agentConfigChangeSchema,
  computePlanDigest,
  computeStateFingerprint,
  createPlanArtifact,
  parsePersistedPlan,
  planSchemaVersion,
  resolvedSkillSelectionSchema,
  skillpackUpdatePlanPayloadSchema
} from './planSchema.js';

describe('plan schema v3 root and effective selections', () => {
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

  it('creates schema v3 artifacts and rejects schema v2 artifacts', () => {
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

    expect(planSchemaVersion).toBe(3);
    expect(parsePersistedPlan(artifact).planSchemaVersion).toBe(3);
    expect(() => parsePersistedPlan({...artifact, planSchemaVersion: 2})).toThrow();
  });

  it('accepts bundle-member provenance and retains multiple canonical origins', () => {
    expect(
      resolvedSkillSelectionSchema.parse({
        agentId: 'codex',
        skillId: 'team:review',
        reason: 'explicit',
        reasonKind: 'explicit',
        origins: [
          {kind: 'explicit', reason: 'explicit'},
          {kind: 'bundle-member', reason: 'bundle:team:workflow'}
        ]
      })
    ).toEqual({
      agentId: 'codex',
      skillId: 'team:review',
      reason: 'explicit',
      reasonKind: 'explicit',
      origins: [
        {kind: 'explicit', reason: 'explicit'},
        {kind: 'bundle-member', reason: 'bundle:team:workflow'}
      ]
    });
  });

  it('keeps Phase 8 semantic update fields additive for schema-v3 plan compatibility', () => {
    const base = {
      skillpackId: 'team',
      repositoryUrl: 'https://example.test/team.git',
      branch: 'main',
      activePath: '/tmp/team/current',
      activeCommitHash: 'a'.repeat(40),
      remoteCommitHash: 'b'.repeat(40),
      candidateRevisionPath: '/tmp/team/revisions/b/repo',
      addedSkillIds: [],
      removedSkillIds: [],
      changedSkillIds: ['review'],
      changedFiles: ['registry.json'],
      managerStateDir: '/tmp/manager',
      stateFingerprint: computeStateFingerprint({active: 'a', remote: 'b'})
    };

    expect(skillpackUpdatePlanPayloadSchema.parse(base)).toEqual(base);
    expect(skillpackUpdatePlanPayloadSchema.parse({
      ...base,
      skillDeltas: [{
        id: 'review',
        change: 'changed',
        previousVersion: '1.0.0',
        nextVersion: '2.0.0',
        versionChange: 'major',
        breakingRisk: true
      }],
      bundleDeltas: [],
      affectedBundles: [{
        bundleId: 'default',
        breakingRisk: true,
        reasons: [{
          kind: 'effective-skill-changed',
          entityId: 'review',
          versionChange: 'major',
          breakingRisk: true,
          message: 'Selected bundle has a major review update.'
        }]
      }]
    })).toMatchObject({
      skillDeltas: [expect.objectContaining({id: 'review', versionChange: 'major'})],
      affectedBundles: [expect.objectContaining({bundleId: 'default', breakingRisk: true})]
    });
  });
});
