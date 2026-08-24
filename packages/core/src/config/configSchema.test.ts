import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {ZodError} from 'zod';
import {defaultSkillpackId} from '../skillpackDefaults.js';
import {
  createDefaultManagerConfig,
  parseBundleReference,
  parseManagerConfig,
  qualifyBundleId,
  resolveBundleReference
} from './configSchema.js';

const timestamp = '2026-08-24T20:00:00.000Z';
const managerStateDir = '/tmp/corvus-config-schema/.agents/corvus-skill-manager';

describe('Manager Config v3 schema', () => {
  it('stores explicit skill and bundle roots independently in canonical order', () => {
    const base = createDefaultManagerConfig({managerStateDir, homeDir: '/tmp/corvus-config-schema'});
    const parsed = parseManagerConfig({
      ...base,
      agents: {
        codex: {
          enabled: true,
          selectedSkillIds: ['team:z-skill', 'team:a-skill', 'team:z-skill'],
          selectedBundleIds: ['team:z-bundle', 'team:a-bundle', 'team:z-bundle']
        }
      }
    });

    expect(parsed.version).toBe(3);
    expect(parsed.agents?.codex).toEqual({
      enabled: true,
      selectedSkillIds: ['team:a-skill', 'team:z-skill'],
      selectedBundleIds: ['team:a-bundle', 'team:z-bundle']
    });
  });

  it.each([
    {field: 'selectedSkillIds', value: ['local-only']},
    {field: 'selectedBundleIds', value: ['local-only']},
    {field: 'selectedBundleIds', value: ['team:bundle:extra']},
    {field: 'selectedBundleIds', value: ['team:bad/path']}
  ])('rejects invalid v3 qualified refs in $field', ({field, value}) => {
    const base = createDefaultManagerConfig({managerStateDir, homeDir: '/tmp/corvus-config-schema'});

    expect(() =>
      parseManagerConfig({
        ...base,
        agents: {codex: {enabled: true, selectedSkillIds: [], selectedBundleIds: [], [field]: value}}
      })
    ).toThrow(ZodError);
  });

  it('keeps the v3 schema strict', () => {
    const base = createDefaultManagerConfig({managerStateDir, homeDir: '/tmp/corvus-config-schema'});

    expect(() => parseManagerConfig({...base, unexpected: true})).toThrow(ZodError);
    expect(() =>
      parseManagerConfig({
        ...base,
        agents: {
          codex: {enabled: true, selectedSkillIds: [], selectedBundleIds: [], effectiveSkillIds: []}
        }
      })
    ).toThrow(ZodError);
  });
});

describe('legacy config normalization', () => {
  it('normalizes v1 local skill selections to v3 roots in the legacy pack', () => {
    const parsed = parseManagerConfig({
      version: 1,
      managerStateDir,
      createdAt: timestamp,
      updatedAt: timestamp,
      skillpack: {
        id: 'legacy-team',
        repositoryUrl: 'https://example.test/legacy-team.git',
        branch: 'main',
        checkoutPath: '/tmp/legacy-team/current'
      },
      agents: {
        codex: {enabled: true, selectedSkillIds: ['review', 'review', 'test']}
      }
    });

    expect(parsed.version).toBe(3);
    expect(parsed.agents?.codex).toEqual({
      enabled: true,
      selectedSkillIds: ['legacy-team:review', 'legacy-team:test'],
      selectedBundleIds: []
    });
    expect(parsed.skillpacks[defaultSkillpackId]).toBeDefined();
    expect(parsed.skillpacks['legacy-team']).toBeDefined();
  });

  it('normalizes v2 selections once and is idempotent as v3', () => {
    const v2 = {
      version: 2,
      managerStateDir,
      createdAt: timestamp,
      updatedAt: timestamp,
      skillpacks: {
        team: {
          id: 'team',
          repositoryUrl: 'https://example.test/team.git',
          branch: 'main',
          checkoutPath: path.join('/tmp', 'team', 'current')
        }
      },
      agents: {
        codex: {enabled: true, selectedSkillIds: ['team:review', 'local-helper']}
      }
    } as const;

    const first = parseManagerConfig(v2);
    const second = parseManagerConfig(JSON.parse(JSON.stringify(first)));

    expect(first.agents?.codex).toEqual({
      enabled: true,
      selectedSkillIds: ['corvus-skillpack:local-helper', 'team:review'],
      selectedBundleIds: []
    });
    expect(second).toEqual(first);
  });

  it('provides symmetric bundle reference helpers', () => {
    expect(qualifyBundleId('team', 'review-flow')).toBe('team:review-flow');
    expect(resolveBundleReference('review-flow', 'team')).toBe('team:review-flow');
    expect(parseBundleReference('team:review-flow')).toEqual({
      skillpackId: 'team',
      bundleId: 'review-flow'
    });
    expect(parseBundleReference('team:review-flow:extra')).toBeUndefined();
  });
});
