import {describe, expect, it} from 'vitest';
import {canonicalJsonStringify} from '../protocol/canonicalJson.js';
import {
  installRequestFromFlags,
  normalizeInstallRequest,
  parseInstallRequest
} from './installRequest.js';

describe('install request v2', () => {
  it('keeps request v1 readable while preserving configured bundle roots', () => {
    const normalized = normalizeInstallRequest(
      parseInstallRequest({
        schemaVersion: 1,
        targetAgents: ['codex'],
        selectedSkills: [{id: 'git-commit'}]
      })
    );

    expect(normalized).toMatchObject({
      schemaVersion: 2,
      selectedSkills: [{id: 'git-commit'}],
      selectedBundles: [],
      bundleSelectionMode: 'preserve',
      allCompatible: false
    });
  });

  it('represents skills-only, bundles-only, and mixed explicit roots', () => {
    const requests = [
      {selectedSkills: [{id: 'team:review'}]},
      {selectedBundles: [{id: 'team:workflow'}]},
      {
        selectedSkills: [{id: 'team:review'}],
        selectedBundles: [{id: 'team:workflow'}]
      }
    ];

    for (const roots of requests) {
      expect(
        parseInstallRequest({schemaVersion: 2, targetAgents: ['codex'], ...roots})
      ).toMatchObject(roots);
    }
  });

  it('normalizes duplicate and reordered skill/bundle roots byte-identically', () => {
    const first = normalizeInstallRequest(
      parseInstallRequest({
        schemaVersion: 2,
        targetAgents: ['codex', 'claude'],
        selectedSkills: [
          {id: 'team:z'},
          {id: 'team:a', reason: 'first'},
          {id: 'team:a', reason: 'ignored'}
        ],
        selectedBundles: [{id: 'team:z-flow'}, {id: 'team:a-flow'}, {id: 'team:z-flow'}]
      })
    );
    const second = normalizeInstallRequest(
      parseInstallRequest({
        schemaVersion: 2,
        targetAgents: ['claude', 'codex', 'claude'],
        selectedSkills: [{id: 'team:a', reason: 'first'}, {id: 'team:z'}],
        selectedBundles: [{id: 'team:a-flow'}, {id: 'team:z-flow'}]
      })
    );

    expect(canonicalJsonStringify(first)).toBe(canonicalJsonStringify(second));
  });

  it('keeps allCompatible mutually exclusive and bundle-free', () => {
    expect(() =>
      parseInstallRequest({
        schemaVersion: 2,
        targetAgents: ['codex'],
        selectedBundles: [{id: 'team:workflow'}],
        allCompatible: true
      })
    ).toThrow();

    expect(
      normalizeInstallRequest(
        parseInstallRequest({schemaVersion: 2, targetAgents: ['codex'], allCompatible: true})
      )
    ).not.toHaveProperty('selectedBundles');
  });

  it('emits current v2 requests from flag transport', () => {
    expect(
      installRequestFromFlags({agents: ['codex'], skills: ['team:review']})
    ).toMatchObject({schemaVersion: 2, selectedBundles: []});
  });
});
