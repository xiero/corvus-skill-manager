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
          {label: 'Guided Flow', hint: '(recommended wizard)'},
          {label: 'Setup Skillpack', hint: '(manual/advanced)'},
          {label: 'Configure Agents', hint: '(manual plan/apply)'},
          {label: 'Status', hint: '(read-only report)'},
          {label: 'Doctor', hint: '(read-only checks)'},
          {label: 'Help', hint: '(workflow guide)'},
          {label: 'Exit', hint: ''}
        ]}
      />
    ).toJSON();

    const text = collectText(tree);

    expect(text).toContain('/tmp/home/.agents/corvus-skill-manager/config.json');
    expect(text).toContain('Config status: created');
    expect(text).toContain('Guided Flow');
    expect(text).toContain('Setup Skillpack');
    expect(text).toContain('Configure Agents');
    expect(text).toContain('Status');
    expect(text).toContain('Doctor');
    expect(text).toContain('Help');
    expect(text).toContain('Exit');
    expect(text).toContain('keys');
    expect(text).toContain('up/down');
    expect(text).toContain('│');
  });

  it('renders a global manager update command when a newer npm release exists', () => {
    const tree = create(
      <HomeScreen
        configPath="/tmp/home/.agents/corvus-skill-manager/config.json"
        configStatus="exists"
        selectedIndex={0}
        menuItems={[{label: 'Guided Flow', hint: '(recommended wizard)'}]}
        managerUpdate={{
          packageName: '@corvus-tools/skill-manager',
          currentVersion: '0.3.0',
          installKind: 'global',
          status: 'update-available',
          updateAvailable: true,
          latestVersion: '0.4.0',
          updateCommand: 'npm install -g @corvus-tools/skill-manager@latest',
          checkedAt: '2026-05-20T10:00:00.000Z',
          fromCache: false,
          message: 'A newer Corvus Skill Manager release is available: 0.3.0 -> 0.4.0.'
        }}
      />
    ).toJSON();

    const text = collectText(tree);

    expect(text).toContain('Corvus Skill Manager update available');
    expect(text).toContain('Current: v0.3.0');
    expect(text).toContain('Latest: v0.4.0');
    expect(text).toContain('Update command:');
    expect(text).toContain('npm install -g @corvus-tools/skill-manager@latest');
  });

  it('renders soft update check failures without blocking the menu', () => {
    const tree = create(
      <HomeScreen
        configPath="/tmp/home/.agents/corvus-skill-manager/config.json"
        configStatus="exists"
        selectedIndex={0}
        menuItems={[{label: 'Guided Flow', hint: '(recommended wizard)'}]}
        managerUpdate={{
          packageName: '@corvus-tools/skill-manager',
          currentVersion: '0.3.0',
          installKind: 'global',
          status: 'check-failed',
          updateAvailable: false,
          fromCache: false,
          message: 'Manager update check failed: network unavailable.'
        }}
      />
    ).toJSON();

    const text = collectText(tree);

    expect(text).toContain('Manager update check failed: network unavailable.');
    expect(text).toContain('Guided Flow');
  });

  it('does not render a banner for up-to-date or unsupported installs', () => {
    const tree = create(
      <HomeScreen
        configPath="/tmp/home/.agents/corvus-skill-manager/config.json"
        configStatus="exists"
        selectedIndex={0}
        menuItems={[{label: 'Guided Flow', hint: '(recommended wizard)'}]}
        managerUpdate={{
          packageName: '@corvus-tools/skill-manager',
          currentVersion: '0.3.0',
          installKind: 'global',
          status: 'up-to-date',
          updateAvailable: false,
          latestVersion: '0.3.0',
          checkedAt: '2026-05-20T10:00:00.000Z',
          fromCache: false,
          message: 'Corvus Skill Manager 0.3.0 is up to date.'
        }}
      />
    ).toJSON();

    const text = collectText(tree);

    expect(text).not.toContain('Manager update available');
    expect(text).toContain('Guided Flow');
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
