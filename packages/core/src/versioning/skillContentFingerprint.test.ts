import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {discoverSkillsFromCheckout} from '../skills/skillDiscovery.js';
import {type SkillpackFixture, v3BundleSkillpackFixture, writeSkillpack} from '../../../../test/support/skillpackFixtures.js';
import {findChangedSkillContentIds} from './skillContentFingerprint.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
});

describe('findChangedSkillContentIds', () => {
  it('detects nested file and symlink-target changes without following links', async () => {
    const currentRoot = await writeFixture(v3BundleSkillpackFixture);
    const candidateRoot = await writeFixture(v3BundleSkillpackFixture);
    const currentSkill = path.join(currentRoot, 'skills', 'review-helper');
    const candidateSkill = path.join(candidateRoot, 'skills', 'review-helper');
    await fs.mkdir(path.join(currentSkill, 'scripts'), {recursive: true});
    await fs.mkdir(path.join(candidateSkill, 'scripts'), {recursive: true});
    await fs.writeFile(path.join(currentSkill, 'scripts', 'check.ts'), 'export const value = 1;\n');
    await fs.writeFile(path.join(candidateSkill, 'scripts', 'check.ts'), 'export const value = 2;\n');
    await fs.symlink('scripts/check.ts', path.join(currentSkill, 'current-check'));
    await fs.symlink('SKILL.md', path.join(candidateSkill, 'current-check'));
    const [current, candidate] = await Promise.all([
      discoverSkillsFromCheckout(currentRoot),
      discoverSkillsFromCheckout(candidateRoot)
    ]);

    expect(await findChangedSkillContentIds({
      currentSkills: current.skills,
      candidateSkills: candidate.skills
    })).toEqual(['review-helper']);
  });

  it('returns a deterministic empty result for byte-identical skill directories', async () => {
    const currentRoot = await writeFixture(v3BundleSkillpackFixture);
    const candidateRoot = await writeFixture(v3BundleSkillpackFixture);
    const [current, candidate] = await Promise.all([
      discoverSkillsFromCheckout(currentRoot),
      discoverSkillsFromCheckout(candidateRoot)
    ]);

    expect(await findChangedSkillContentIds({
      currentSkills: [...current.skills].reverse(),
      candidateSkills: candidate.skills
    })).toEqual([]);
  });
});

async function writeFixture(fixture: SkillpackFixture): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corvus-version-content-'));
  roots.push(root);
  await writeSkillpack(root, fixture);
  return root;
}
