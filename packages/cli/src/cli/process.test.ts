import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';

const cliEntry = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const cliSourceDir = fileURLToPath(new URL('../', import.meta.url));

const temporaryHomes: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryHomes.splice(0).map(async (homeDir) => fs.rm(homeDir, {recursive: true, force: true}))
  );
});

async function temporaryHome(): Promise<string> {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'corvus-cli-process-'));
  temporaryHomes.push(homeDir);
  return homeDir;
}

interface SpawnResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs the real binary entrypoint in a child process with an isolated HOME. */
async function spawnCli(
  args: string[],
  options: {homeDir: string; timeoutMs?: number}
): Promise<SpawnResult> {
  const stdoutPath = path.join(options.homeDir, '.corvus-test-stdout');
  const stderrPath = path.join(options.homeDir, '.corvus-test-stderr');
  const stdoutFile = await fs.open(stdoutPath, 'w');
  const stderrFile = await fs.open(stderrPath, 'w');

  return new Promise<SpawnResult>((resolve) => {
    const child = spawn(
      process.execPath,
      [cliEntry, ...args],
      {
        cwd: repoRoot,
        env: {...process.env, HOME: options.homeDir, USERPROFILE: options.homeDir, NO_COLOR: '1'},
        // File-backed capture is stable in restricted environments where nested child-process
        // pipes may be unavailable. It still exercises the real stdout/stderr file descriptors.
        stdio: ['ignore', stdoutFile.fd, stderrFile.fd]
      }
    );

    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs ?? 30_000);

    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      await stdoutFile.close();
      await stderrFile.close();
      const [stdout, stderr] = await Promise.all([
        fs.readFile(stdoutPath, 'utf8'),
        fs.readFile(stderrPath, 'utf8')
      ]);
      resolve({code, signal, stdout, stderr, timedOut});
    });
  });
}

describe('binary routing', () => {
  it('launches the Ink TUI when invoked with no arguments', async () => {
    const homeDir = await temporaryHome();
    const result = await spawnCli([], {homeDir, timeoutMs: 15_000});

    // The TUI keeps running until the user quits, so the smoke test kills it after it renders.
    expect(result.stdout).toContain('S K I L L   M A N A G E R');
  });

  it('prints help without clearing the terminal or rendering the TUI', async () => {
    const homeDir = await temporaryHome();
    const result = await spawnCli(['--help'], {homeDir});

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('For coding agents: corvus-skills capabilities --json');
    expect(result.stdout).not.toContain('S K I L L   M A N A G E R');
    expect(result.stdout).not.toContain('[2J');
  });

  it('emits exactly one JSON document and exits promptly for a machine command', async () => {
    const homeDir = await temporaryHome();
    const result = await spawnCli(['capabilities', '--json'], {homeDir});

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('[2J');
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1);
    expect(() => JSON.parse(result.stdout) as unknown).not.toThrow();
  });

  it('exits with the documented category for a read-only command on a fresh machine', async () => {
    const homeDir = await temporaryHome();
    const result = await spawnCli(['skills', 'list', '--json'], {homeDir});

    expect(result.code).toBe(3);
    expect((JSON.parse(result.stdout) as {ok: boolean}).ok).toBe(false);
  });

  it('does not prompt when stdin is closed', async () => {
    const homeDir = await temporaryHome();
    const result = await spawnCli(['status', '--json'], {homeDir});

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
  });
});

describe('machine command module graph', () => {
  it('keeps Ink, React, and the TUI out of every statically imported CLI module', async () => {
    const offenders: string[] = [];

    async function visit(directory: string): Promise<void> {
      for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          await visit(entryPath);
          continue;
        }

        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
          continue;
        }

        // The TUI launcher is the one module allowed to reach Ink, and it is only ever
        // imported dynamically, from the no-argument branch of the entrypoint.
        if (entryPath === path.join(cliSourceDir, 'tuiLauncher.ts')) {
          continue;
        }

        const source = await fs.readFile(entryPath, 'utf8');
        const staticImports = [...source.matchAll(/^\s*import\s[^\n]*?from\s+'([^']+)'/gm)].map(
          (match) => match[1]
        );

        for (const specifier of staticImports) {
          if (specifier === 'ink' || specifier === 'react' || specifier === '@corvus-tools/skill-manager-tui') {
            offenders.push(`${path.relative(repoRoot, entryPath)} -> ${specifier}`);
          }
        }
      }
    }

    await visit(cliSourceDir);

    expect(offenders).toEqual([]);
  });
});
