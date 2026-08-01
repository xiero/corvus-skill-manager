#!/usr/bin/env node
import {createRequire} from 'node:module';

/**
 * Dual-mode entrypoint.
 *
 * No arguments launches the existing Ink TUI exactly as before. Anything else — a subcommand or
 * `--help` — goes to the machine CLI, which never initializes Ink, never clears the terminal,
 * and never prompts. The TUI module is only ever imported dynamically, so a machine command
 * does not pull React or Ink into its runtime graph.
 */
const argv = process.argv.slice(2);

if (argv.length === 0) {
  const {launchTui} = await import('./tuiLauncher.js');
  await launchTui(import.meta.url);
} else {
  const {runCli} = await import('./cli/runCli.js');
  const {defaultCliIo, interruptedEnvelope, writeEnvelope} = await import('./cli/output.js');
  const wantsJson = argv.includes('--json');

  process.on('SIGINT', () => {
    const exitCode = writeEnvelope(defaultCliIo, interruptedEnvelope('capabilities'), {
      json: wantsJson,
      debug: false
    });

    process.exit(exitCode);
  });

  process.exitCode = await runCli(argv, {
    entryUrl: import.meta.url,
    version: readVersion()
  });
}

function readVersion(): string {
  try {
    const packageJson = createRequire(import.meta.url)('../package.json') as {version?: unknown};
    return typeof packageJson.version === 'string' ? packageJson.version : '';
  } catch {
    return '';
  }
}
