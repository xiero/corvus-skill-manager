import {describe, expect, it} from 'vitest';
import {getAgentAdapter, getAgentAdapters} from './adapters.js';

describe('agent adapters', () => {
  it('lists supported MVP agents and deferred Gemini', () => {
    expect(getAgentAdapters()).toEqual([
      expect.objectContaining({id: 'codex', supportStatus: 'supported', defaultTargetPath: '~/.agents/skills'}),
      expect.objectContaining({id: 'claude', supportStatus: 'supported', defaultTargetPath: '~/.claude/skills'}),
      expect.objectContaining({id: 'copilot', supportStatus: 'supported', defaultTargetPath: '~/.copilot/skills'}),
      expect.objectContaining({id: 'opencode', supportStatus: 'supported', defaultTargetPath: '~/.config/opencode/skills'}),
      expect.objectContaining({id: 'pi', supportStatus: 'supported', defaultTargetPath: '~/.pi/agent/skills'}),
      expect.objectContaining({id: 'custom', supportStatus: 'custom'}),
      expect.objectContaining({id: 'gemini', supportStatus: 'deferred'})
    ]);
  });

  it('returns an adapter by id', () => {
    expect(getAgentAdapter('gemini')).toEqual(
      expect.objectContaining({
        displayName: 'Gemini CLI',
        warnings: expect.arrayContaining(['No .toml wrappers are generated in this MVP.'])
      })
    );
  });
});
