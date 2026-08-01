import {promises as fs} from 'node:fs';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {machineEnvelopeSchema} from '@corvus-tools/skill-manager-core';
import {type TestHome, createStubGit, createTestHome} from '../../../../test/support/appHarness.js';
import {v2SkillpackFixture} from '../../../../test/support/skillpackFixtures.js';
import type {CliIo} from './output.js';
import {runCli} from './runCli.js';

const homes: TestHome[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map(async (home) => home.cleanup()));
});

async function newHome(options: Parameters<typeof createTestHome>[0] = {}): Promise<TestHome> {
  const home = await createTestHome({skillpack: v2SkillpackFixture, ...options});
  homes.push(home);
  return home;
}

async function runJson(argv: string[], home: TestHome): Promise<{exitCode: number; envelope: unknown}> {
  let stdout = '';
  const io: CliIo = {
    writeOut: (chunk) => {
      stdout += chunk;
    },
    writeErr: () => {},
    readStdin: async () => ''
  };
  const exitCode = await runCli([...argv, '--json'], {
    io,
    version: '0.0.0-test',
    applicationOptions: {
      homeDir: home.homeDir,
      git: createStubGit({commitHash: home.commitHash}).runner,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      managerPackage: {packageName: '@corvus-tools/skill-manager', version: '0.0.0-test', installKind: 'development'}
    }
  });

  return {exitCode, envelope: JSON.parse(stdout)};
}

/**
 * Replaces run-specific values with stable placeholders so golden output is comparable across
 * runs and machines: the temporary home, the commit hash, and plan digests.
 *
 * Plan ids and digests are hashes over absolute paths, so they legitimately differ between two
 * temporary homes. `packages/core/src/application/install.test.ts` covers digest determinism
 * for a fixed state; these fixtures cover payload shape.
 */
function normalize(value: unknown, home: TestHome): unknown {
  const serialized = JSON.stringify(value)
    .split(home.homeDir)
    .join('<HOME>')
    .split(home.commitHash)
    .join('<COMMIT>')
    .replace(/install-[a-f0-9]{32}/g, 'install-<DIGEST32>')
    .replace(/skillpack-setup-[a-f0-9]{32}/g, 'skillpack-setup-<DIGEST32>')
    .replace(/skillpack-update-[a-f0-9]{32}/g, 'skillpack-update-<DIGEST32>')
    .replace(/"(digest|value)":"[a-f0-9]{64}"/g, '"$1":"<SHA256>"')
    .replace(/"([a-zA-Z]+)":"[a-f0-9]{64}"(?=,|\})/g, (match, key: string) =>
      key === 'digest' || key === 'value' ? `"${key}":"<SHA256>"` : match
    );

  return JSON.parse(
    serialized.replace(/"components":\{[^}]*\}/g, '"components":{"<NORMALIZED>":"<SHA256>"}')
  );
}

describe('golden protocol fixtures', () => {
  it('agents list', async () => {
    const home = await newHome({agents: {codex: {enabled: true, selectedSkillIds: ['git-commit']}}});
    const {exitCode, envelope} = await runJson(['agents', 'list'], home);

    expect(exitCode).toBe(0);
    expect(machineEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(normalize(envelope, home)).toMatchSnapshot();
  });

  it('skillpack status', async () => {
    const home = await newHome();
    const {exitCode, envelope} = await runJson(['skillpack', 'status'], home);

    expect(exitCode).toBe(0);
    expect(normalize(envelope, home)).toMatchSnapshot();
  });

  it('skills search', async () => {
    const home = await newHome();
    const {exitCode, envelope} = await runJson(
      ['skills', 'search', '--query', 'embedded firmware cmake', '--limit', '3'],
      home
    );

    expect(exitCode).toBe(0);
    expect(normalize(envelope, home)).toMatchSnapshot();
  });

  it('skills validate-registry', async () => {
    const home = await newHome();
    const {exitCode, envelope} = await runJson(['skills', 'validate-registry'], home);

    expect(exitCode).toBe(0);
    expect(normalize(envelope, home)).toMatchSnapshot();
  });

  it('install plan with a dependency expansion', async () => {
    const home = await newHome();
    const {exitCode, envelope} = await runJson(
      ['install', 'plan', '--agent', 'codex', '--skill', 'embedded-driver-development'],
      home
    );

    expect(exitCode).toBe(0);
    // The plan id is a digest over normalized request and state, so it is stable for a fixed
    // fixture once temp paths are normalized out.
    expect(normalize(envelope, home)).toMatchSnapshot();
  });

  it('install plan blocked by an unmanaged target', async () => {
    const home = await newHome();
    const targetPath = path.join(home.homeDir, '.agents', 'skills', 'git-commit');

    await fs.mkdir(path.dirname(targetPath), {recursive: true});
    await fs.writeFile(targetPath, 'not ours\n', 'utf8');

    const {exitCode, envelope} = await runJson(
      ['install', 'plan', '--agent', 'codex', '--skill', 'git-commit'],
      home
    );

    expect(exitCode).toBe(3);
    expect(normalize(envelope, home)).toMatchSnapshot();
  });

  it('unsupported skill and agent pair', async () => {
    const home = await newHome();
    const {exitCode, envelope} = await runJson(
      ['install', 'plan', '--agent', 'gemini', '--skill', 'react-component-design'],
      home
    );

    expect(exitCode).toBe(3);
    expect(normalize(envelope, home)).toMatchSnapshot();
  });

  it('invalid request document', async () => {
    const home = await newHome();
    const requestPath = path.join(home.homeDir, 'bad.json');

    await fs.writeFile(requestPath, '{"schemaVersion": 1}', 'utf8');

    const {exitCode, envelope} = await runJson(['install', 'plan', '--request', requestPath], home);

    expect(exitCode).toBe(2);
    expect(normalize(envelope, home)).toMatchSnapshot();
  });
});

describe('envelope contract across every command', () => {
  it('always emits a schema-valid envelope with the documented shape', async () => {
    const home = await newHome();
    const argvs = [
      ['capabilities'],
      ['status'],
      ['doctor'],
      ['agents', 'list'],
      ['skillpack', 'status'],
      ['skillpack', 'update-check'],
      ['skills', 'list'],
      ['skills', 'search', '--query', 'git'],
      ['skills', 'inspect', 'git-commit'],
      ['skills', 'validate-registry']
    ];

    for (const argv of argvs) {
      const {exitCode, envelope} = await runJson(argv, home);
      const parsed = machineEnvelopeSchema.safeParse(envelope);

      expect(parsed.success, `${argv.join(' ')} should emit a valid envelope`).toBe(true);
      expect(exitCode).toBe(0);

      if (parsed.success) {
        expect(parsed.data.schemaVersion).toBe(1);
        expect(parsed.data.ok).toBe(true);
        expect(parsed.data.changed).toBe(false);
        expect(parsed.data.errors).toEqual([]);
      }
    }
  });

  it('produces byte-identical output for a repeated read-only command', async () => {
    const home = await newHome();
    const first = await runJson(['skills', 'search', '--query', 'embedded'], home);
    const second = await runJson(['skills', 'search', '--query', 'embedded'], home);

    expect(JSON.stringify(first.envelope)).toBe(JSON.stringify(second.envelope));
  });
});
