import React from 'react';
import {create} from 'react-test-renderer';
import {describe, expect, it} from 'vitest';
import {HomeScreen} from './HomeScreen.js';

describe('HomeScreen', () => {
  it('renders the product name, config state, and primary menu entries', () => {
    const tree = create(
      <HomeScreen
        configPath="/tmp/home/.agents/corvus-skill-manager/config.json"
        configStatus="created"
        selectedIndex={0}
        menuItems={[
          {label: 'Setup Skillpack', hint: ''},
          {label: 'Configure Agents', hint: '(plan links)'},
          {label: 'Status', hint: '(read-only report)'},
          {label: 'Doctor', hint: '(read-only checks)'},
          {label: 'Help', hint: '(workflow guide)'},
          {label: 'Exit', hint: ''}
        ]}
      />
    ).toJSON();

    const text = collectText(tree);

    expect(text).toContain('Corvus Skill Manager');
    expect(text).toContain('/tmp/home/.agents/corvus-skill-manager/config.json');
    expect(text).toContain('Config status: created');
    expect(text).toContain('Setup Skillpack');
    expect(text).toContain('Configure Agents');
    expect(text).toContain('Status');
    expect(text).toContain('Doctor');
    expect(text).toContain('Help');
    expect(text).toContain('Exit');
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
