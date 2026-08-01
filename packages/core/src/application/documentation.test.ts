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

  it('uses only real CLI syntax in its command examples', async () => {
    const registeredCommands = new Set(commandCapabilities.map((command) => command.cli));
    const documents = await Promise.all(
      ['docs/agent-interface.md', 'docs/agent-protocol-v1.md', 'docs/semantic-registry.md'].map(
        async (relativePath) => readDoc(relativePath)
      )
    );
    const offenders: string[] = [];

    for (const document of documents) {
      for (const match of document.matchAll(/^\s*corvus-skills\s+([^\n|<]*)$/gm)) {
        const invocation = (match[1] ?? '').trim();
        const words = invocation.split(/\s+/).filter((word) => word !== '' && !word.startsWith('-'));
        const candidates = [words.slice(0, 2).join(' '), words[0] ?? ''];

        if (!candidates.some((candidate) => registeredCommands.has(candidate))) {
          offenders.push(invocation);
        }
      }
    }

    expect(offenders).toEqual([]);
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
