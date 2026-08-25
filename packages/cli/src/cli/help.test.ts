import {describe, expect, it} from 'vitest';
import {commandCapabilities} from '@corvus-tools/skill-manager-core';
import {aiQuickStartLine} from './createProgram.js';
import type {CliIo} from './output.js';
import {runCli} from './runCli.js';

async function help(argv: string[]): Promise<string> {
  let stdout = '';
  const io: CliIo = {
    writeOut: (chunk) => {
      stdout += chunk;
    },
    writeErr: () => {},
    readStdin: async () => ''
  };

  await runCli(argv, {io, version: '0.0.0-test'});

  return stdout;
}

describe('help output', () => {
  it('matches the expected top-level shape', async () => {
    expect(await help(['--help'])).toMatchInlineSnapshot(`
      "Usage: corvus-skills [options] [command]

      Corvus Skill Manager — wire local skillpacks into supported coding agents.

      For coding agents: corvus-skills capabilities --json

      Run with no arguments to open the interactive TUI.

      Options:
        -v, --version           Print the manager version.
        -h, --help              Show help.

      Commands:
        capabilities [options]  Describe this binary for a coding agent.
        status [options]        Report config, skillpack, agent, and managed-link
                                state.
        doctor [options]        Report health issues with stable codes. Never repairs
                                anything.
        agents                  Agent adapter commands.
        skillpack               Skillpack snapshot commands.
        skills                  Skill catalog commands.
        bundles                 Bundle catalog commands.
        install                 Installation commands.
        help [command]          display help for command
      "
    `);
  });

  it('puts the AI quick-start line near the top, above the option list', async () => {
    const output = await help(['--help']);

    expect(output.indexOf(aiQuickStartLine)).toBeGreaterThan(-1);
    expect(output.indexOf(aiQuickStartLine)).toBeLessThan(output.indexOf('Options:'));
  });

  it('documents --json and --debug on every leaf command', async () => {
    for (const command of commandCapabilities) {
      const output = await help([...command.cli.split(' '), '--help']);

      expect(output, `${command.cli} should document --json`).toContain('--json');
      expect(output, `${command.cli} should document --debug`).toContain('--debug');
    }
  });

  it('marks the confirmation flags required on every write command', async () => {
    for (const command of commandCapabilities.filter((entry) => entry.mode === 'write')) {
      const requiresPlanRef = command.options.some((option) => option.flag.startsWith('--confirm'));

      if (!requiresPlanRef) {
        continue;
      }

      const output = await help([...command.cli.split(' '), '--help']);

      expect(output, `${command.cli} should document --confirm`).toContain('--confirm <id>');
      expect(output).toContain('Must repeat the exact plan id.');
    }
  });
});
