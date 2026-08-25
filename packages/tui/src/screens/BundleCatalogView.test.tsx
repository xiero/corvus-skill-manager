import React from 'react';
import {create} from 'react-test-renderer';
import {describe, expect, it} from 'vitest';
import type {BundleCatalogEntry} from '@corvus-tools/skill-manager-core';
import {BundleCatalogView} from './BundleCatalogView.js';

describe('BundleCatalogView', () => {
  it('renders bundle-first catalog metadata and the selected detail', () => {
    const text = collectText(create(
      <BundleCatalogView
        bundles={[bundle()]}
        selectedIndex={0}
        selectionStates={new Map([['corvus:review-flow', 'all']])}
        dependenciesByBundle={{'corvus:review-flow': ['corvus:git-basics']}}
      />
    ).toJSON());

    expect(text).toContain('Bundles');
    expect(text).toContain('[x] corvus:review-flow@2.1.0 - Review Flow');
    expect(text).toContain('Bundle Detail: corvus:review-flow@2.1.0');
    expect(text).toContain('corvus:review-helper ^1.0.0 (snapshot 1.2.0)');
    expect(text).toContain('Additional dependencies: corvus:git-basics');
    expect(text).toContain('Compatible agents: claude, codex');
  });

  it('keeps incompatible bundles visible with actionable reasons', () => {
    const incompatible: BundleCatalogEntry = {
      ...bundle(),
      supportedAgents: ['codex'],
      compatibility: [{
        agentId: 'claude',
        compatible: false,
        issues: [{
          code: 'bundle-member-unsupported',
          agentId: 'claude',
          bundleId: 'corvus:review-flow',
          memberId: 'corvus:review-helper',
          skillId: 'corvus:review-helper',
          message: 'Review Helper does not support Claude Code.'
        }]
      }]
    };
    const text = collectText(create(
      <BundleCatalogView
        bundles={[incompatible]}
        selectedIndex={0}
        selectionStates={new Map([['corvus:review-flow', 'none']])}
      />
    ).toJSON());

    expect(text).toContain('[!] corvus:review-flow@2.1.0');
    expect(text).toContain('Incompatible with claude');
    expect(text).toContain('Review Helper does not support Claude Code.');
  });

  it('renders partial selection across enabled agents', () => {
    const text = collectText(create(
      <BundleCatalogView
        bundles={[bundle()]}
        selectedIndex={0}
        selectionStates={new Map([['corvus:review-flow', 'some']])}
      />
    ).toJSON());

    expect(text).toContain('[~] corvus:review-flow@2.1.0');
  });
});

function bundle(): BundleCatalogEntry {
  return {
    id: 'review-flow',
    skillpackId: 'corvus',
    ref: 'corvus:review-flow',
    version: '2.1.0',
    title: 'Review Flow',
    description: 'A maintained review workflow.',
    tags: ['review'],
    keywords: ['review'],
    members: [{
      id: 'review-helper',
      ref: 'corvus:review-helper',
      versionRange: '^1.0.0',
      actualVersion: '1.2.0'
    }],
    supportedAgents: ['claude', 'codex']
  };
}

function collectText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (typeof node === 'object' && 'children' in node) {
    return collectText((node as {children?: unknown}).children);
  }
  return '';
}
