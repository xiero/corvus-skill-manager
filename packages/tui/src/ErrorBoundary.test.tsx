import React from 'react';
import {create} from 'react-test-renderer';
import {describe, expect, it, vi} from 'vitest';
import {ErrorBoundary} from './ErrorBoundary.js';

function BrokenComponent(): React.ReactElement {
  throw new Error('render exploded');
}

describe('ErrorBoundary', () => {
  it('renders a safe fallback when a TUI child throws', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const tree = create(
        <ErrorBoundary>
          <BrokenComponent />
        </ErrorBoundary>
      ).toJSON();
      const text = collectText(tree);

      expect(text).toContain('██████╗');
      expect(text).toContain('S K I L L   M A N A G E R');
      expect(text).toContain('Corvus Skill Manager hit a TUI error');
      expect(text).toContain('render exploded');
      expect(text).toContain('No repair or filesystem apply action was attempted.');
    } finally {
      stderrSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
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
