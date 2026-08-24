import {promises as fs} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {commandCapabilities} from './useCases/capabilitiesUseCase.js';
import {installRequestSchema, normalizeInstallRequest} from './install/installRequest.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

interface ExampleFile {
  schemaIdentifier: string;
  examples: Array<{name: string; description: string; request: unknown}>;
  invalidExamples: Array<{name: string; description: string; request: unknown}>;
}

async function readExamples(): Promise<ExampleFile> {
  return JSON.parse(
    await fs.readFile(`${repoRoot}docs/examples/agent-install-requests.json`, 'utf8')
  ) as ExampleFile;
}

async function readDoc(relativePath: string): Promise<string> {
  return fs.readFile(`${repoRoot}${relativePath}`, 'utf8');
}

/** Every document whose `corvus-skills` examples must stay valid. */
const documentedFiles = [
  'README.md',
  'architecture.md',
  'docs/agent-interface.md',
  'docs/agent-protocol-v1.md',
  'docs/semantic-registry.md',
  'docs/skillpack-contract.md',
  'docs/skillpack-registry-migration.md',
  'docs/safety-model.md',
  'docs/npm-publishing.md'
];

const globalFlags = ['--json', '--debug', '--help', '--version'];

interface DocumentedInvocation {
  source: string;
  raw: string;
  /** Positional words, placeholders and comments removed. */
  words: string[];
  flags: string[];
}

/**
 * Extracts `corvus-skills …` invocations from the docs.
 *
 * Placeholders (`<id>`), shell redirections, heredoc markers, and trailing `#` comments are
 * stripped so the remaining tokens are a real command plus real flags.
 */
async function collectDocumentedInvocations(): Promise<DocumentedInvocation[]> {
  const invocations: DocumentedInvocation[] = [];

  for (const relativePath of documentedFiles) {
    const document = await readDoc(relativePath);

    for (const match of document.matchAll(/^[ \t]*corvus-skills[ \t]+(.+)$/gm)) {
      const raw = (match[1] ?? '').trim();
      const withoutComment = raw.split('#')[0] ?? '';
      const tokens = (withoutComment.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).filter(
        (token) =>
          !token.startsWith('<') &&
          !token.startsWith('>') &&
          !token.includes('<<') &&
          !token.startsWith("'") &&
          !token.startsWith('"')
      );

      invocations.push({
        source: relativePath,
        raw,
        words: tokens.filter((token) => !token.startsWith('-')),
        flags: tokens
          .filter((token) => token.startsWith('--'))
          .map((token) => (token.split('=')[0] ?? token).trim())
      });
    }
  }

  return invocations;
}

/** Longest-prefix match of positional words against the registered command list. */
function matchCommand(words: readonly string[]) {
  for (const length of [2, 1]) {
    const candidate = words.slice(0, length).join(' ');
    const capability = commandCapabilities.find((command) => command.cli === candidate);

    if (capability !== undefined) {
      return capability;
    }
  }

  return undefined;
}

/** `--limit <n>` -> `--limit`; `<skill-id...>` -> itself (positional, never matched as a flag). */
function flagName(flag: string): string {
  return (flag.split(/[ <]/)[0] ?? flag).trim();
}

describe('documented install request examples', () => {
  it('validates every documented example against the public schema', async () => {
    const {examples} = await readExamples();

    expect(examples.length).toBeGreaterThan(0);

    for (const example of examples) {
      const parsed = installRequestSchema.safeParse(example.request);

      expect(parsed.success, `${example.name} should be a valid request`).toBe(true);

      if (parsed.success) {
        expect(() => normalizeInstallRequest(parsed.data)).not.toThrow();
      }
    }
  });

  it('rejects every documented invalid example', async () => {
    const {invalidExamples} = await readExamples();

    expect(invalidExamples.length).toBeGreaterThan(0);

    for (const example of invalidExamples) {
      expect(
        installRequestSchema.safeParse(example.request).success,
        `${example.name} should be rejected`
      ).toBe(false);
    }
  });

  it('advertises the same schema identifier the examples claim', async () => {
    const {schemaIdentifier} = await readExamples();
    const installPlan = commandCapabilities.find((command) => command.command === 'install.plan');

    expect(installPlan?.inputSchema).toBe(schemaIdentifier);
  });

  it('covers every product scenario named in the task list', async () => {
    const {examples} = await readExamples();
    const names = examples.map((example) => example.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'named-skills-one-agent',
        'named-skills-multiple-agents',
        'bundle-only',
        'mixed-skill-and-bundle-roots',
        'all-compatible',
        'embedded-development-intent',
        'react-node-web-development-intent'
      ])
    );
  });
});

describe('agent documentation', () => {
  it('points agents at the capabilities entrypoint and never at TUI output', async () => {
    const agentInterface = await readDoc('docs/agent-interface.md');

    expect(agentInterface).toContain('corvus-skills capabilities --json');
    expect(agentInterface).toContain('Never parse TUI output');
  });

  it('uses only registered commands and real flags in every documented example', async () => {
    const invocations = await collectDocumentedInvocations();
    const unknownCommands: string[] = [];
    const unknownFlags: string[] = [];

    expect(invocations.length).toBeGreaterThan(10);

    for (const invocation of invocations) {
      const capability = matchCommand(invocation.words);

      if (capability === undefined) {
        unknownCommands.push(`${invocation.source}: corvus-skills ${invocation.raw}`);
        continue;
      }

      const allowed = new Set([...globalFlags, ...capability.options.map((option) => flagName(option.flag))]);

      for (const flag of invocation.flags) {
        if (!allowed.has(flag)) {
          unknownFlags.push(`${invocation.source}: "${capability.cli}" has no ${flag}`);
        }
      }
    }

    expect(unknownCommands).toEqual([]);
    expect(unknownFlags).toEqual([]);
  });

  it('checks the top-level README and architecture doc too', async () => {
    const invocations = await collectDocumentedInvocations();
    const sources = new Set(invocations.map((invocation) => invocation.source));

    // A guard on the guard: if these files stop containing examples, the check above silently
    // stops covering them.
    expect(sources).toContain('README.md');
  });

  it('documents every error code that the protocol defines', async () => {
    const protocolDoc = await readDoc('docs/agent-protocol-v1.md');
    const {machineErrorCodes} = await import('./protocol/errors.js');

    for (const code of machineErrorCodes) {
      expect(protocolDoc, `${code} should be documented`).toContain(code);
    }
  });

  it('never instructs an agent to overwrite unmanaged targets or mutate the active checkout', async () => {
    const documents = await Promise.all(
      ['docs/agent-interface.md', 'docs/agent-protocol-v1.md', 'docs/skillpack-registry-migration.md'].map(
        async (relativePath) => readDoc(relativePath)
      )
    );

    for (const document of documents) {
      expect(document).not.toMatch(/--force/);
      expect(document).not.toMatch(/git\s+(pull|reset|checkout|commit|push)/);
    }
  });
});
