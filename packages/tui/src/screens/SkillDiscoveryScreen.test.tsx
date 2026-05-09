import React from 'react';
import {create} from 'react-test-renderer';
import {describe, expect, it} from 'vitest';
import {DiscoveryResultView} from './SkillDiscoveryScreen.js';

describe('DiscoveryResultView', () => {
  it('renders valid skills, warnings, and errors', () => {
    const tree = create(
      <DiscoveryResultView
        result={{
          skillpackRoot: '/tmp/skillpack',
          registryPath: '/tmp/skillpack/registry.json',
          skills: [
            {
              id: 'review-helper',
              title: 'Review Helper',
              description: 'Helps with reviews.',
              supportedAgents: ['codex'],
              tags: ['review'],
              relativePath: 'skills/review-helper',
              absolutePath: '/tmp/skillpack/skills/review-helper',
              skillFilePath: '/tmp/skillpack/skills/review-helper/SKILL.md',
              frontmatter: {
                name: 'review-helper',
                description: 'Review pull requests.'
              },
              riskWarnings: []
            }
          ],
          warnings: [
            {
              severity: 'warning',
              code: 'scripts-directory',
              message: 'Skill contains a scripts/ directory.',
              skillId: 'review-helper'
            }
          ],
          errors: [
            {
              severity: 'error',
              code: 'missing-skill-file',
              message: 'Skill "broken" is missing SKILL.md.',
              skillId: 'broken'
            }
          ]
        }}
      />
    ).toJSON();

    const text = collectText(tree);

    expect(text).toContain('review-helper');
    expect(text).toContain('Review Helper');
    expect(text).toContain('Warnings (1)');
    expect(text).toContain('Skill contains a scripts/ directory.');
    expect(text).toContain('Errors (1)');
    expect(text).toContain('missing SKILL.md');
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
