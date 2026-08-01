import {promises as fs} from 'node:fs';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  type TestHome,
  createStubGit,
  createTestHome,
  listTree
} from '../../../../test/support/appHarness.js';
import {v2SkillpackFixture, writeSkillpack} from '../../../../test/support/skillpackFixtures.js';
import {aiQuickStartLine} from './createProgram.js';
import type {CliIo} from './output.js';
import {parseRequestDocument} from './requestInput.js';
import {runCli} from './runCli.js';

const homes: TestHome[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map(async (home) => home.cleanup()));
});

async function newHome(options: Parameters<typeof createTestHome>[0] = {}): Promise<TestHome> {
  const home = await createTestHome(options);
  homes.push(home);
  return home;
}

interface CapturedRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  json: unknown;
}

async function run(
  argv: string[],
  options: {home?: TestHome; stdin?: string; remoteCommitHash?: string; onClone?: (target: string) => Promise<void>} = {}
): Promise<CapturedRun> {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    writeOut: (chunk) => {
      stdout += chunk;
    },
    writeErr: (chunk) => {
      stderr += chunk;
    },
    readStdin: async () => options.stdin ?? ''
  };
  const stubGit = createStubGit({
    commitHash: options.home?.commitHash ?? 'a'.repeat(40),
    ...(options.remoteCommitHash === undefined ? {} : {remoteCommitHash: options.remoteCommitHash}),
    ...(options.onClone === undefined ? {} : {onClone: options.onClone})
  });
  const exitCode = await runCli(argv, {
    io,
    version: '9.9.9',
    applicationOptions: {
      ...(options.home === undefined ? {} : {homeDir: options.home.homeDir}),
      git: stubGit.runner,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      managerPackage: {packageName: '@corvus-tools/skill-manager', version: '9.9.9', installKind: 'development'}
    }
  });

  let json: unknown;

  if (argv.includes('--json')) {
    json = JSON.parse(stdout);
  }

  return {exitCode, stdout, stderr, json};
}

const ansiPattern = /\[[0-9;]*[A-Za-z]/;

function expectCleanJsonOutput(result: CapturedRun): void {
  expect(ansiPattern.test(result.stdout)).toBe(false);
  expect(result.stdout.trimEnd().split('\n')).toHaveLength(1);
  expect(() => JSON.parse(result.stdout) as unknown).not.toThrow();
}

describe('routing', () => {
  it('prints help without initializing Ink and includes the AI quick-start line', async () => {
    const result = await run(['--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(aiQuickStartLine);
    expect(result.stdout).toContain('Run with no arguments to open the interactive TUI.');
    expect(ansiPattern.test(result.stdout)).toBe(false);
  });

  it('rejects an unknown command with a usage exit code', async () => {
    const result = await run(['not-a-command']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
  });

  it('reports the package version', async () => {
    const result = await run(['--version']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('9.9.9');
  });

  it('renders a human summary without --json', async () => {
    const home = await newHome();
    const result = await run(['status'], {home});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ok: status');
    expect(result.stdout).toContain('Add --json');
  });
});

describe('json mode', () => {
  it('emits exactly one clean JSON envelope on a fresh machine', async () => {
    const home = await newHome();
    const result = await run(['capabilities', '--json'], {home});

    expectCleanJsonOutput(result);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.json).toMatchObject({schemaVersion: 1, ok: true, command: 'capabilities', changed: false});
  });

  it('keeps debug diagnostics on stderr only', async () => {
    const home = await newHome();
    const result = await run(['status', '--json', '--debug'], {home});

    expectCleanJsonOutput(result);
    expect(result.stderr).toContain('[debug]');
  });

  it('registers every command advertised by capabilities', async () => {
    const home = await newHome();
    const capabilities = await run(['capabilities', '--json'], {home});
    const commands = (
      (capabilities.json as {data: {commands: Array<{cli: string; mode: string}>}}).data.commands
    );

    expect(commands.length).toBeGreaterThan(0);

    for (const command of commands) {
      const helpResult = await run([...command.cli.split(' '), '--help']);

      expect(helpResult.exitCode, `${command.cli} should be registered`).toBe(0);
      expect(helpResult.stdout).toContain('--json');
    }
  });
});

describe('read-only commands on a fresh machine', () => {
  it('reports missing config and skillpack without writing anything', async () => {
    const home = await newHome();
    const before = await listTree(home.homeDir);

    for (const argv of [['status'], ['doctor'], ['agents', 'list'], ['skillpack', 'status']]) {
      const result = await run([...argv, '--json'], {home});

      expectCleanJsonOutput(result);
      expect(result.exitCode).toBe(0);
    }

    expect(await listTree(home.homeDir)).toEqual(before);
  });

  it('exits 3 when the catalog is asked for before a skillpack exists', async () => {
    const home = await newHome();
    const result = await run(['skills', 'list', '--json'], {home});

    expectCleanJsonOutput(result);
    expect(result.exitCode).toBe(3);
    expect(result.json).toMatchObject({ok: false});
    expect((result.json as {errors: Array<{code: string}>}).errors[0]?.code).toBe('CONFIG_NOT_FOUND');
  });
});

describe('skillpack setup through the CLI', () => {
  it('plans and applies the default skillpack with stubbed git', async () => {
    const home = await newHome();
    const plan = await run(['skillpack', 'setup-plan', '--json'], {
      home,
      remoteCommitHash: 'b'.repeat(40),
      onClone: async (target) => writeSkillpack(target, v2SkillpackFixture)
    });

    expectCleanJsonOutput(plan);
    expect(plan.exitCode).toBe(0);

    const planId = (plan.json as {data: {planId: string}}).data.planId;
    const apply = await run(
      ['skillpack', 'setup-apply', '--plan-id', planId, '--confirm', planId, '--json'],
      {home, remoteCommitHash: 'b'.repeat(40), onClone: async (target) => writeSkillpack(target, v2SkillpackFixture)}
    );

    expectCleanJsonOutput(apply);
    expect(apply.exitCode).toBe(0);
    expect(apply.json).toMatchObject({ok: true, changed: true});

    const skills = await run(['skills', 'list', '--json'], {home});

    expect(skills.exitCode).toBe(0);
    expect((skills.json as {data: {skillCount: number}}).data.skillCount).toBe(8);
  });

  it('exits 4 when the confirmation token does not match', async () => {
    const home = await newHome();
    const plan = await run(['skillpack', 'setup-plan', '--json'], {home});
    const planId = (plan.json as {data: {planId: string}}).data.planId;
    const apply = await run(['skillpack', 'setup-apply', '--plan-id', planId, '--confirm', 'nope', '--json'], {home});

    expect(apply.exitCode).toBe(4);
    expect((apply.json as {errors: Array<{code: string}>}).errors[0]?.code).toBe('PLAN_CONFIRMATION_REQUIRED');
  });
});

describe('catalog commands', () => {
  it('searches, inspects, and installs using exact ids', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const search = await run(
      ['skills', 'search', '--query', 'embedded firmware c cpp cmake stm32', '--limit', '3', '--json'],
      {home}
    );

    expectCleanJsonOutput(search);
    expect(search.exitCode).toBe(0);

    const results = (search.json as {data: {results: Array<{id: string}>}}).data.results;

    expect(results[0]?.id).toBe('embedded-driver-development');

    const inspect = await run(['skills', 'inspect', results[0]?.id ?? '', '--json'], {home});

    expect(inspect.exitCode).toBe(0);
    expect((inspect.json as {data: {skills: Array<{content?: string}>}}).data.skills[0]?.content).toBeUndefined();

    const plan = await run(
      [
        'install',
        'plan',
        '--agent',
        'codex',
        '--skill',
        'embedded-driver-development',
        '--reason',
        'embedded-driver-development=Chosen from search results.',
        '--intent',
        'Install a balanced set for embedded development',
        '--selection-policy',
        'balanced',
        '--json'
      ],
      {home}
    );

    expectCleanJsonOutput(plan);
    expect(plan.exitCode).toBe(0);

    const planId = (plan.json as {data: {planId: string}}).data.planId;
    const apply = await run(['install', 'apply', '--plan-id', planId, '--confirm', planId, '--json'], {home});

    expect(apply.exitCode).toBe(0);
    expect(apply.json).toMatchObject({ok: true, changed: true});

    const verify = await run(['install', 'verify', '--plan-id', planId, '--json'], {home});

    expect(verify.exitCode).toBe(0);
    expect((verify.json as {data: {status: string}}).data.status).toBe('verified');

    const second = await run(['install', 'apply', '--plan-id', planId, '--confirm', planId, '--json'], {home});

    expect(second.exitCode).toBe(0);
    expect(second.json).toMatchObject({ok: true, changed: false});
  });

  it('validates the registry read-only', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const before = await listTree(home.homeDir);
    const result = await run(['skills', 'validate-registry', '--json'], {home});

    expectCleanJsonOutput(result);
    expect(result.exitCode).toBe(0);
    expect((result.json as {data: {valid: boolean}}).data.valid).toBe(true);
    expect(await listTree(home.homeDir)).toEqual(before);
  });

  it('returns SKILL.md content only when opted in', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const result = await run(['skills', 'inspect', 'git-commit', '--include-content', '--json'], {home});

    expect(result.exitCode).toBe(0);
    expect((result.json as {data: {skills: Array<{content?: string}>}}).data.skills[0]?.content).toContain(
      'git-commit'
    );
  });
});

describe('request documents', () => {
  it('accepts a request document from stdin', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const result = await run(['install', 'plan', '--request', '-', '--json'], {
      home,
      stdin: JSON.stringify({
        schemaVersion: 1,
        intent: 'Install only the essential skills for React and Node web development',
        selectionPolicy: 'minimal',
        targetAgents: ['codex'],
        selectedSkills: [
          {id: 'react-component-design', reason: 'React component work.'},
          {id: 'node-api-development', reason: 'Node API work.'}
        ]
      })
    });

    expectCleanJsonOutput(result);
    expect(result.exitCode).toBe(0);
    expect(
      (result.json as {data: {plan: {operations: Array<{skillId: string}>}}}).data.plan.operations.map(
        (operation) => operation.skillId
      )
    ).toEqual(['node-api-development', 'react-component-design']);
  });

  it('accepts a request document from a file', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const requestPath = path.join(home.homeDir, 'request.json');

    await fs.writeFile(
      requestPath,
      JSON.stringify({schemaVersion: 1, targetAgents: ['gemini'], allCompatible: true}),
      'utf8'
    );

    const result = await run(['install', 'plan', '--request', requestPath, '--json'], {home});

    expect(result.exitCode).toBe(0);
    expect((result.json as {data: {plan: {operations: unknown[]}}}).data.plan.operations).toHaveLength(3);
  });

  it('rejects empty, invalid, and multiple JSON documents', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});

    for (const stdin of ['', '   ', 'not json', '{"a":1}{"b":2}']) {
      const result = await run(['install', 'plan', '--request', '-', '--json'], {home, stdin});

      expectCleanJsonOutput(result);
      expect(result.exitCode).toBe(2);
      expect((result.json as {errors: Array<{code: string}>}).errors[0]?.code).toBe('INVALID_REQUEST');
    }
  });

  it('detects concatenated documents distinctly from malformed JSON', () => {
    expect(parseRequestDocument('{"a":1}{"b":2}', 'stdin')).toMatchObject({
      ok: false,
      message: expect.stringContaining('exactly one JSON document')
    });
    expect(parseRequestDocument('{"a":', 'stdin')).toMatchObject({
      ok: false,
      message: expect.stringContaining('not valid JSON')
    });
  });

  it('requires a selection or --all-compatible when no request document is given', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const result = await run(['install', 'plan', '--agent', 'codex', '--json'], {home});

    expect(result.exitCode).toBe(2);
    expect((result.json as {errors: Array<{message: string}>}).errors[0]?.message).toContain('--all-compatible');
  });

  it('rejects a malformed --reason pair', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const result = await run(
      ['install', 'plan', '--agent', 'codex', '--skill', 'git-commit', '--reason', 'oops', '--json'],
      {home}
    );

    expect(result.exitCode).toBe(2);
    expect((result.json as {errors: Array<{message: string}>}).errors[0]?.message).toContain('<key>=<value>');
  });
});

describe('plan lifecycle failures', () => {
  async function planFor(home: TestHome, skillId: string): Promise<{planId: string; planPath: string}> {
    const plan = await run(['install', 'plan', '--agent', 'codex', '--skill', skillId, '--json'], {home});

    expect(plan.exitCode).toBe(0);

    const data = (plan.json as {data: {planId: string; planPath: string}}).data;

    return {planId: data.planId, planPath: data.planPath};
  }

  it('rejects a plan made against stale state', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const first = await planFor(home, 'git-commit');
    const second = await planFor(home, 'test-driven-development');

    const applySecond = await run(
      ['install', 'apply', '--plan-id', second.planId, '--confirm', second.planId, '--json'],
      {home}
    );

    expect(applySecond.exitCode).toBe(0);

    const applyFirst = await run(
      ['install', 'apply', '--plan-id', first.planId, '--confirm', first.planId, '--json'],
      {home}
    );

    expect(applyFirst.exitCode).toBe(4);
    expect((applyFirst.json as {errors: Array<{code: string}>}).errors[0]?.code).toBe('STALE_PLAN');
  });

  it('rejects a tampered plan file', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const {planId, planPath} = await planFor(home, 'git-commit');
    const stored = JSON.parse(await fs.readFile(planPath, 'utf8')) as {
      payload: {operations: Array<{targetPath: string}>};
    };
    const operation = stored.payload.operations[0];

    if (operation !== undefined) {
      operation.targetPath = path.join(home.homeDir, 'elsewhere', 'git-commit');
    }

    await fs.writeFile(planPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

    const result = await run(['install', 'apply', '--plan-id', planId, '--confirm', planId, '--json'], {home});

    expect(result.exitCode).toBe(4);
    expect((result.json as {errors: Array<{code: string}>}).errors[0]?.code).toBe('PLAN_DIGEST_MISMATCH');
    await expect(fs.lstat(path.join(home.homeDir, 'elsewhere', 'git-commit'))).rejects.toThrow();
  });

  it('reports drift from verify after a link is repointed', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const {planId} = await planFor(home, 'git-commit');

    await run(['install', 'apply', '--plan-id', planId, '--confirm', planId, '--json'], {home});

    const verified = await run(['install', 'verify', '--plan-id', planId, '--json'], {home});

    expect((verified.json as {data: {status: string}}).data.status).toBe('verified');

    const targetPath = path.join(home.homeDir, '.agents', 'skills', 'git-commit');
    const elsewhere = path.join(home.homeDir, 'elsewhere');

    await fs.mkdir(elsewhere, {recursive: true});
    await fs.unlink(targetPath);
    await fs.symlink(elsewhere, targetPath, 'dir');

    const drifted = await run(['install', 'verify', '--plan-id', planId, '--json'], {home});

    expect(drifted.exitCode).toBe(0);
    expect((drifted.json as {data: {status: string}}).data.status).toBe('drift-detected');
  });
});

describe('exit-code contract', () => {
  it('maps conflicts, confirmation problems, and invalid input to their categories', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});
    const unmanagedTarget = path.join(home.homeDir, '.agents', 'skills', 'git-commit');

    await fs.mkdir(path.dirname(unmanagedTarget), {recursive: true});
    await fs.writeFile(unmanagedTarget, 'not ours\n', 'utf8');

    const conflict = await run(
      ['install', 'plan', '--agent', 'codex', '--skill', 'git-commit', '--json'],
      {home}
    );

    expect(conflict.exitCode).toBe(3);
    expect((conflict.json as {errors: Array<{code: string}>}).errors[0]?.code).toBe('UNMANAGED_TARGET_EXISTS');

    const missingPlan = `install-${'0'.repeat(32)}`;
    const staleApply = await run(
      ['install', 'apply', '--plan-id', missingPlan, '--confirm', missingPlan, '--json'],
      {home}
    );

    expect(staleApply.exitCode).toBe(4);

    const badSearch = await run(['skills', 'search', '--query', 'x', '--limit', '9999', '--json'], {home});

    expect(badSearch.exitCode).toBe(2);
  });

  it('never prompts and never writes ANSI in JSON mode', async () => {
    const home = await newHome({skillpack: v2SkillpackFixture});

    for (const argv of [
      ['capabilities'],
      ['status'],
      ['doctor'],
      ['agents', 'list'],
      ['skillpack', 'status'],
      ['skillpack', 'update-check'],
      ['skills', 'list'],
      ['skills', 'validate-registry']
    ]) {
      const result = await run([...argv, '--json'], {home});

      expectCleanJsonOutput(result);
      expect(result.exitCode).toBe(0);
      expect(result.json).toMatchObject({schemaVersion: 1});
    }
  });
});
