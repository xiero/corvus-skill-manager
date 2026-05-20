export interface TerminalOutput {
  isTTY?: boolean;
  write: (chunk: string) => unknown;
}

const clearTerminalSequence = '\u001B[2J\u001B[3J\u001B[H';

export function clearTerminal(output: TerminalOutput = process.stdout): void {
  if (output.isTTY !== true) {
    return;
  }

  output.write(clearTerminalSequence);
}
