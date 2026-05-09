import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {loadManifest} from '../manifest/manifestStore.js';
import type {LinkPlan} from './linkPlan.js';
import {applyLinkPlan} from './applyEngine.js';

let tempRoot: string;
let managerStateDir: string;
let skillpackRoot: string;
let sourcePath: string;
let targetRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'corvus-apply-test-'));
  managerStateDir = path.join(tempRoot, 'manager');
  skillpackRoot = path.join(tempRoot, 'skillpack');
  sourcePath = path.join(skillpackRoot, 'skills', 'review');
  targetRoot = path.join(tempRoot, 'agent-skills');

  await fs.mkdir(sourcePath, {recursive: true});
  await fs.writeFile(path.join(sourcePath, 'SKILL.md'), '# Review\n', 'utf8');
});

afterEach(async () => {
  await fs.rm(tempRoot, {recursive: true, force: true});
});

describe('applyLinkPlan', () => {
  it('creates a manager-owned link and records it in the manifest', async () => {
    const targetPath = path.join(targetRoot, 'review');

    const result = await applyLinkPlan({
      plan: createPlan({targetPath}),
      managerStateDir,
      skillpackCheckoutPath: skillpackRoot,
      now: new Date('2026-04-05T06:07:08.000Z')
    });

    expect(result.applied).toEqual([
      expect.objectContaining({
        status: 'applied',
        code: 'created-link'
      })
    ]);
    expect(await fs.readlink(targetPath)).toBe(sourcePath);

    const manifest = await loadManifest(path.join(managerStateDir, 'manifest.json'));
    expect(manifest.links[targetPath]).toMatchObject({
      agentId: 'codex',
      skillId: 'review',
      targetPath,
      sourcePath,
      linkType: process.platform === 'win32' ? 'junction' : 'symlink',
      createdAt: '2026-04-05T06:07:08.000Z',
      updatedAt: '2026-04-05T06:07:08.000Z'
    });
  });

  it('supports dry-run without writing links or manifest', async () => {
    const targetPath = path.join(targetRoot, 'review');

    const result = await applyLinkPlan({
      plan: createPlan({targetPath}),
      managerStateDir,
      skillpackCheckoutPath: skillpackRoot,
      dryRun: true
    });

    expect(result.planned).toEqual([
      expect.objectContaining({
        status: 'planned',
        code: 'create-link'
      })
    ]);
    await expect(fs.lstat(targetPath)).rejects.toMatchObject({code: 'ENOENT'});
    await expect(fs.lstat(path.join(managerStateDir, 'manifest.json'))).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('removes only manifest-owned links', async () => {
    const targetPath = path.join(targetRoot, 'review');

    await applyLinkPlan({
      plan: createPlan({targetPath}),
      managerStateDir,
      skillpackCheckoutPath: skillpackRoot,
      now: new Date('2026-04-05T06:07:08.000Z')
    });

    const result = await applyLinkPlan({
      plan: {
        operations: [
          {
            type: 'remove-link',
            agentId: 'codex',
            skillId: 'review',
            targetPath
          }
        ],
        conflicts: [],
        warnings: []
      },
      managerStateDir,
      skillpackCheckoutPath: skillpackRoot
    });

    expect(result.applied).toEqual([
      expect.objectContaining({
        code: 'removed-managed-link'
      })
    ]);
    await expect(fs.lstat(targetPath)).rejects.toMatchObject({code: 'ENOENT'});

    const manifest = await loadManifest(path.join(managerStateDir, 'manifest.json'));
    expect(manifest.links[targetPath]).toBeUndefined();
  });

  it('refuses to overwrite an unmanaged file', async () => {
    const targetPath = path.join(targetRoot, 'review');
    await fs.mkdir(targetRoot, {recursive: true});
    await fs.writeFile(targetPath, 'mine\n', 'utf8');

    const result = await applyLinkPlan({
      plan: createPlan({targetPath}),
      managerStateDir,
      skillpackCheckoutPath: skillpackRoot
    });

    expect(result.skipped).toEqual([
      expect.objectContaining({
        code: 'unmanaged-file-exists'
      })
    ]);
    expect(await fs.readFile(targetPath, 'utf8')).toBe('mine\n');
  });

  it('refuses to overwrite an unmanaged directory', async () => {
    const targetPath = path.join(targetRoot, 'review');
    await fs.mkdir(targetPath, {recursive: true});

    const result = await applyLinkPlan({
      plan: createPlan({targetPath}),
      managerStateDir,
      skillpackCheckoutPath: skillpackRoot
    });

    expect(result.skipped).toEqual([
      expect.objectContaining({
        code: 'unmanaged-directory-exists'
      })
    ]);
    expect((await fs.lstat(targetPath)).isDirectory()).toBe(true);
  });

  it('refuses to overwrite an unmanaged symlink', async () => {
    const targetPath = path.join(targetRoot, 'review');
    const otherSource = path.join(tempRoot, 'other-source');
    await fs.mkdir(targetRoot, {recursive: true});
    await fs.mkdir(otherSource, {recursive: true});
    await fs.symlink(otherSource, targetPath, 'dir');

    const result = await applyLinkPlan({
      plan: createPlan({targetPath}),
      managerStateDir,
      skillpackCheckoutPath: skillpackRoot
    });

    expect(result.skipped).toEqual([
      expect.objectContaining({
        code: 'unmanaged-symlink-exists'
      })
    ]);
    expect(path.resolve(targetRoot, await fs.readlink(targetPath))).toBe(otherSource);
  });

  it('refuses sources outside the configured skillpack checkout', async () => {
    const targetPath = path.join(targetRoot, 'review');
    const outsideSource = path.join(tempRoot, 'outside', 'review');
    await fs.mkdir(outsideSource, {recursive: true});

    const result = await applyLinkPlan({
      plan: createPlan({sourcePath: outsideSource, targetPath}),
      managerStateDir,
      skillpackCheckoutPath: skillpackRoot
    });

    expect(result.skipped).toEqual([
      expect.objectContaining({
        code: 'source-outside-skillpack'
      })
    ]);
    await expect(fs.lstat(targetPath)).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('refuses manifest mismatches', async () => {
    const targetPath = path.join(targetRoot, 'review');
    await applyLinkPlan({
      plan: createPlan({targetPath}),
      managerStateDir,
      skillpackCheckoutPath: skillpackRoot
    });

    const result = await applyLinkPlan({
      plan: createPlan({targetPath, skillId: 'different'}),
      managerStateDir,
      skillpackCheckoutPath: skillpackRoot
    });

    expect(result.skipped).toEqual([
      expect.objectContaining({
        code: 'manifest-mismatch'
      })
    ]);
  });

  it('replaces broken manager-owned links only with confirmation', async () => {
    const targetPath = path.join(targetRoot, 'review');
    const restoredSourcePath = path.join(skillpackRoot, 'skills', 'review-restored');

    await applyLinkPlan({
      plan: createPlan({targetPath}),
      managerStateDir,
      skillpackCheckoutPath: skillpackRoot
    });
    await fs.rm(sourcePath, {recursive: true, force: true});
    await fs.mkdir(restoredSourcePath, {recursive: true});
    await fs.writeFile(path.join(restoredSourcePath, 'SKILL.md'), '# Review restored\n', 'utf8');

    const unconfirmedResult = await applyLinkPlan({
      plan: createPlan({targetPath, sourcePath: restoredSourcePath}),
      managerStateDir,
      skillpackCheckoutPath: skillpackRoot
    });
    expect(unconfirmedResult.skipped).toEqual([
      expect.objectContaining({
        code: 'broken-managed-link-needs-confirmation'
      })
    ]);

    const confirmedResult = await applyLinkPlan({
      plan: createPlan({targetPath, sourcePath: restoredSourcePath}),
      managerStateDir,
      skillpackCheckoutPath: skillpackRoot,
      confirmReplaceBrokenManagedLinks: true
    });

    expect(confirmedResult.applied).toEqual([
      expect.objectContaining({
        code: 'replaced-broken-managed-link'
      })
    ]);
    expect(await fs.readlink(targetPath)).toBe(restoredSourcePath);
  });
});

function createPlan(options: {
  sourcePath?: string;
  targetPath: string;
  skillId?: string;
}): LinkPlan {
  const skillId = options.skillId ?? 'review';

  return {
    operations: [
      {
        type: 'create-link',
        agentId: 'codex',
        skillId,
        sourcePath: options.sourcePath ?? sourcePath,
        targetPath: options.targetPath
      }
    ],
    conflicts: [],
    warnings: []
  };
}
