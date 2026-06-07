import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {type ManagerConfig, createDefaultManagerConfig} from '../config/configSchema.js';
import {saveConfig} from '../config/configStore.js';
import type {GitRunner} from '../git/gitRunner.js';
import {saveLock} from '../lock/lockStore.js';
import {saveManifest} from '../manifest/manifestStore.js';
import {defaultConfigPath, defaultManagerStateDir} from '../paths.js';
import {buildDoctorReport} from './doctorReport.js';
import {buildStatusReport} from './statusReport.js';

let tempHome: string;
let managerStateDir: string;
let configPath: string;
let skillpackRoot: string;

beforeEach(async () => {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'corvus-report-test-'));
  managerStateDir = defaultManagerStateDir(tempHome);
  configPath = defaultConfigPath(tempHome);
  skillpackRoot = path.join(tempHome, '.agents', 'skillpacks', 'corvus-skillpack', 'repo');
});

afterEach(async () => {
  await fs.rm(tempHome, {recursive: true, force: true});
});

describe('status and doctor reports', () => {
  it('builds status from config, lock, manifest, registry, and checkout state', async () => {
    const config = await writeHealthyFixture();
    await saveLock(
      {
        version: 1,
        updatedAt: '2026-05-01T00:00:00.000Z',
        skillpacks: {
          'corvus-skillpack': {
            id: 'corvus-skillpack',
            repositoryUrl: 'https://example.test/skills.git',
            branch: 'main',
            checkoutPath: skillpackRoot,
            commitHash: '1111111111111111111111111111111111111111',
            dirty: false,
            recordedAt: '2026-05-01T00:00:00.000Z'
          }
        }
      },
      {managerStateDir}
    );

    const report = await buildStatusReport({
      configPath,
      git: cleanGit('2222222222222222222222222222222222222222')
    });

    expect(report.configPath).toBe(configPath);
    expect(report.skillpack).toMatchObject({
      id: 'corvus-skillpack',
      repositoryUrl: config.skillpack?.repositoryUrl,
      branch: 'main',
      checkoutPath: skillpackRoot,
      recordedCommit: '1111111111111111111111111111111111111111',
      currentCommit: '2222222222222222222222222222222222222222',
      checkoutExists: true,
      checkoutReadable: true,
      dirty: false,
      discoveredSkillCount: 1
    });
    expect(report.agents.find((agent) => agent.id === 'codex')).toMatchObject({
      enabled: true,
      selectedSkillIds: ['review']
    });
    expect(report.managedLinkCount).toBe(0);
  });

  it('detects a healthy state without modifying files', async () => {
    await writeHealthyFixture();
    const beforeSnapshot = await snapshotTree(tempHome);

    const report = await buildDoctorReport({
      configPath,
      git: cleanGit('2222222222222222222222222222222222222222')
    });
    const afterSnapshot = await snapshotTree(tempHome);

    expect(report.healthy).toBe(true);
    expect(report.issues).toEqual([]);
    expect(afterSnapshot).toEqual(beforeSnapshot);
  });

  it('detects missing and invalid config files', async () => {
    const missingReport = await buildDoctorReport({configPath});

    expect(missingReport.healthy).toBe(false);
    expect(missingReport.issues).toEqual([
      expect.objectContaining({
        code: 'missing-config'
      })
    ]);

    await fs.mkdir(managerStateDir, {recursive: true});
    await fs.writeFile(configPath, '{"version":2}\n', 'utf8');

    const invalidReport = await buildDoctorReport({configPath});

    expect(invalidReport.healthy).toBe(false);
    expect(invalidReport.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-config'
      })
    ]);
  });

  it('detects missing registry in read-only fallback mode', async () => {
    const config = createConfig({
      agents: {
        codex: {
          enabled: true,
          targetPath: path.join(tempHome, 'agent-skills'),
          selectedSkillIds: ['review']
        }
      }
    });
    await saveConfig(config, {configPath});
    await writeSkill('skills/review', {name: 'review', description: 'Review code.'});

    const report = await buildDoctorReport({configPath, git: cleanGit()});

    expect(report.healthy).toBe(true);
    expect(report.issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'missing-registry'
      })
    ]);
  });

  it('detects stale and unsafe states without repairing them', async () => {
    const targetRoot = path.join(tempHome, 'agent-skills');
    const unmanagedTarget = path.join(targetRoot, 'review');
    const brokenTarget = path.join(targetRoot, 'broken');
    const missingSource = path.join(skillpackRoot, 'skills', 'broken');

    await writeRegistry({
      skills: [
        {
          id: 'review',
          path: 'skills/review',
          title: 'Review',
          description: 'Review code.',
          supportedAgents: ['codex']
        },
        {
          id: 'missing-doc',
          path: 'skills/missing-doc',
          title: 'Missing Doc',
          description: 'Missing skill file.',
          supportedAgents: ['codex']
        }
      ]
    });
    await writeSkill('skills/review', {name: 'review', description: 'Review code.'});
    await fs.mkdir(unmanagedTarget, {recursive: true});
    await fs.symlink(missingSource, brokenTarget, 'dir');

    await saveConfig(createConfig({
      agents: {
        codex: {
          enabled: true,
          targetPath: targetRoot,
          selectedSkillIds: ['review']
        },
        gemini: {
          enabled: true,
          selectedSkillIds: ['review']
        }
      }
    }), {configPath});
    await saveManifest(
      {
        version: 1,
        updatedAt: '2026-05-01T00:00:00.000Z',
        links: {
          [brokenTarget]: {
            agentId: 'codex',
            skillId: 'broken',
            targetPath: brokenTarget,
            sourcePath: missingSource,
            linkType: 'symlink',
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z'
          },
          [path.join(targetRoot, 'manifest-key')]: {
            agentId: 'codex',
            skillId: 'wrong',
            targetPath: path.join(targetRoot, 'manifest-target'),
            sourcePath: path.join(skillpackRoot, 'skills', 'review'),
            linkType: 'symlink',
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z'
          }
        }
      },
      {managerStateDir}
    );
    const beforeSnapshot = await snapshotTree(tempHome);

    const report = await buildDoctorReport({
      configPath,
      git: dirtyGit('3333333333333333333333333333333333333333')
    });
    const afterSnapshot = await snapshotTree(tempHome);
    const issueCodes = report.issues.map((issue) => issue.code);

    expect(report.healthy).toBe(false);
    expect(issueCodes).toEqual(expect.arrayContaining([
      'broken-managed-link',
      'dirty-checkout',
      'manifest-entry-with-wrong-target',
      'missing-skill-md',
      'missing-source-skill-path',
      'unmanaged-conflict-at-planned-target'
    ]));
    expect(issueCodes).not.toContain('unsupported-agent-enabled');
    expect(afterSnapshot).toEqual(beforeSnapshot);
  });
});

function createConfig(options: {
  agents?: ManagerConfig['agents'];
} = {}): ManagerConfig {
  return {
    ...createDefaultManagerConfig({
      managerStateDir,
      now: new Date('2026-05-01T00:00:00.000Z')
    }),
    skillpack: {
      id: 'corvus-skillpack',
      repositoryUrl: 'https://example.test/skills.git',
      branch: 'main',
      checkoutPath: skillpackRoot
    },
    ...(options.agents === undefined ? {} : {agents: options.agents})
  };
}

async function writeHealthyFixture(): Promise<ManagerConfig> {
  const config = createConfig({
    agents: {
      codex: {
        enabled: true,
        targetPath: path.join(tempHome, 'agent-skills'),
        selectedSkillIds: ['review']
      }
    }
  });

  await saveConfig(config, {configPath});
  await writeRegistry({
    skills: [
      {
        id: 'review',
        path: 'skills/review',
        title: 'Review',
        description: 'Review code.',
        supportedAgents: ['codex']
      }
    ]
  });
  await writeSkill('skills/review', {name: 'review', description: 'Review code.'});

  return config;
}

async function writeRegistry(registry: unknown): Promise<void> {
  await fs.mkdir(skillpackRoot, {recursive: true});
  await fs.writeFile(path.join(skillpackRoot, 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

async function writeSkill(
  relativePath: string,
  frontmatter: {
    name: string;
    description: string;
  }
): Promise<void> {
  const skillPath = path.join(skillpackRoot, relativePath);
  await fs.mkdir(skillPath, {recursive: true});
  await fs.writeFile(
    path.join(skillPath, 'SKILL.md'),
    `---\nname: ${JSON.stringify(frontmatter.name)}\ndescription: ${JSON.stringify(frontmatter.description)}\n---\n\n# ${frontmatter.name}\n`,
    'utf8'
  );
}

function cleanGit(commitHash = '1111111111111111111111111111111111111111'): GitRunner {
  return async (args) => {
    if (args.join(' ') === 'rev-parse --is-inside-work-tree') {
      return {stdout: 'true\n', stderr: ''};
    }

    if (args.join(' ') === 'rev-parse HEAD') {
      return {stdout: `${commitHash}\n`, stderr: ''};
    }

    if (args.includes('status')) {
      return {stdout: '', stderr: ''};
    }

    throw new Error(`Unexpected git command: ${args.join(' ')}`);
  };
}

function dirtyGit(commitHash: string): GitRunner {
  return async (args) => {
    if (args.join(' ') === 'rev-parse --is-inside-work-tree') {
      return {stdout: 'true\n', stderr: ''};
    }

    if (args.join(' ') === 'rev-parse HEAD') {
      return {stdout: `${commitHash}\n`, stderr: ''};
    }

    if (args.includes('status')) {
      return {stdout: '?? LOCAL_ONLY.md\n', stderr: ''};
    }

    throw new Error(`Unexpected git command: ${args.join(' ')}`);
  };
}

async function snapshotTree(rootPath: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};

  async function visit(currentPath: string): Promise<void> {
    const stat = await fs.lstat(currentPath);
    const relativePath = path.relative(rootPath, currentPath) || '.';

    if (stat.isSymbolicLink()) {
      entries[relativePath] = `link:${await fs.readlink(currentPath)}`;
      return;
    }

    if (stat.isDirectory()) {
      entries[relativePath] = 'dir';
      const childNames = (await fs.readdir(currentPath)).sort((left, right) => left.localeCompare(right));

      for (const childName of childNames) {
        await visit(path.join(currentPath, childName));
      }

      return;
    }

    entries[relativePath] = `file:${await fs.readFile(currentPath, 'utf8')}`;
  }

  await visit(rootPath);
  return entries;
}
