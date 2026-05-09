import React from 'react';
import {create} from 'react-test-renderer';
import {describe, expect, it} from 'vitest';
import {HelpScreen} from './HelpScreen.js';

describe('HelpScreen', () => {
  it('renders the configuration and apply workflow guidance', () => {
    const tree = create(<HelpScreen onBack={() => {}} />).toJSON();
    const text = collectText(tree);

    expect(text).toContain('Setup Skillpack');
    expect(text).toContain('Configure Agents');
    expect(text).toContain('No selected skills means no links are created.');
    expect(text).toContain('Saving config stores selections');
    expect(text).toContain('Doctor explains');
  });
});

function collectText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(collectText).join('');
  }

  if (typeof node === 'object' && 'children' in node) {
    const children = (node as {children?: unknown}).children;
    return collectText(children);
  }

  return '';
}
