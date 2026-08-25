import React from 'react';
import {create} from 'react-test-renderer';
import {describe, expect, it} from 'vitest';
import {SemanticUpdateSummaryView} from './SemanticUpdatePreview.js';

describe('SemanticUpdateSummaryView', () => {
  it('renders version deltas, affected bundle reasons, and advisory major risk', () => {
    const text = collectText(create(
      <SemanticUpdateSummaryView
        skillDeltas={[{
          id: 'review-helper',
          change: 'changed',
          previousVersion: '1.4.0',
          nextVersion: '2.0.0',
          versionChange: 'major',
          breakingRisk: true
        }, {
          id: 'legacy-helper',
          change: 'changed',
          versionChange: 'unknown',
          breakingRisk: false
        }]}
        bundleDeltas={[{
          id: 'default',
          change: 'changed',
          previousVersion: '1.0.0',
          nextVersion: '1.1.0',
          versionChange: 'minor',
          breakingRisk: false
        }]}
        affectedBundles={[{
          bundleId: 'default',
          breakingRisk: true,
          reasons: [{
            kind: 'effective-skill-changed',
            entityId: 'review-helper',
            versionChange: 'major',
            breakingRisk: true,
            message: 'Selected bundle "default" has changed effective skill "review-helper" (1.4.0 -> 2.0.0, major).'
          }]
        }]}
      />
    ).toJSON());

    expect(text).toContain('MAJOR VERSION RISK');
    expect(text).toContain('review-helper: changed, 1.4.0 -> 2.0.0 [major, MAJOR RISK]');
    expect(text).toContain('legacy-helper: changed, unversioned/unknown [unknown]');
    expect(text).toContain('default: changed, 1.0.0 -> 1.1.0 [minor]');
    expect(text).toContain('default [MAJOR RISK]');
    expect(text).toContain('activation still requires explicit approval');
  });
});

function collectText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (typeof node === 'object' && 'children' in node) {
    return collectText((node as {children?: unknown}).children);
  }
  return '';
}
