import {describe, expect, it, vi} from 'vitest';
import {clearTerminal, type TerminalOutput} from './terminal.js';

describe('clearTerminal', () => {
  it('clears the screen and scrollback for TTY output', () => {
    const write = vi.fn();
    const output: TerminalOutput = {
      isTTY: true,
      write
    };

    clearTerminal(output);

    expect(write).toHaveBeenCalledWith('\u001B[2J\u001B[3J\u001B[H');
  });

  it('does not write control sequences for non-TTY output', () => {
    const write = vi.fn();
    const output: TerminalOutput = {
      isTTY: false,
      write
    };

    clearTerminal(output);

    expect(write).not.toHaveBeenCalled();
  });
});
