import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {v3BundleSkillpackFixture, writeSkillpack} from '../../../../test/support/skillpackFixtures.js';
import type {SkillpackConfig} from '../config/configSchema.js';
import {discoverSkillsFromCheckout} from '../skills/skillDiscovery.js';
import {discoverSkillpacks, filterSkillpackDiscovery, qualifySkillpackDiscovery} from './catalogDiscovery.js';

describe('configured repository catalog discovery', () => {
  let root: string;
  let primary: SkillpackConfig;
  let secondary: SkillpackConfig;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'corvus-catalog-discovery-'));
    primary = config('corvus-skillpack', root);
    secondary = config('team-pack', root);
    await Promise.all([
      writeSkillpack(primary.checkoutPath, v3BundleSkillpackFixture),
      writeSkillpack(secondary.checkoutPath, v3BundleSkillpackFixture)
    ]);
  });

  afterEach(async () => {
    await fs.rm(root, {recursive: true, force: true});
  });

  test('combines both repositories while retaining namespaces for identical skill and bundle IDs', async () => {
    const result = await discoverSkillpacks([primary, secondary]);

    expect(result.errors).toEqual([]);
    expect(result.skills).toHaveLength(10);
    expect(result.bundles).toHaveLength(4);
    expect(result.skills.filter((skill) => skill.id === 'review-helper').map((skill) => skill.ref)).toEqual([
      'corvus-skillpack:review-helper',
      'team-pack:review-helper'
    ]);
    expect(result.bundles.filter((bundle) => bundle.id === 'default').map((bundle) => bundle.ref)).toEqual([
      'corvus-skillpack:default',
      'team-pack:default'
    ]);
    expect(result.skillpacks).toEqual([
      expect.objectContaining({id: primary.id, ready: true, skillCount: 5, bundleCount: 2, source: 'registry', registryVersion: 3}),
      expect.objectContaining({id: secondary.id, ready: true, skillCount: 5, bundleCount: 2, source: 'registry', registryVersion: 3})
    ]);
    for (const bundle of result.bundles) {
      expect(bundle.members.every((member) => member.ref === `${bundle.skillpackId}:${member.id}`)).toBe(true);
    }
  });

  test('reads only the selected secondary repository', async () => {
    const discover = vi.fn(discoverSkillsFromCheckout);
    const result = await discoverSkillpacks([secondary], discover);

    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith(secondary.checkoutPath);
    expect(result.skills).toHaveLength(5);
    expect(result.skills.every((skill) => skill.skillpackId === secondary.id)).toBe(true);
    expect(result.skillpackRoot).toBe(secondary.checkoutPath);
    expect(result.registryVersion).toBe(3);
  });

  test('qualifies relationships and bundle members once, without changing the checkout-local result', async () => {
    const local = await discoverSkillsFromCheckout(secondary.checkoutPath);
    const qualified = qualifySkillpackDiscovery(secondary.id, local);
    const result = await discoverSkillpacks([secondary], async () => qualified);

    expect(result.skills.find((skill) => skill.id === 'review-helper')).toMatchObject({
      requires: ['team-pack:git-basics'],
      recommends: ['team-pack:docs-helper']
    });
    expect(result.skills.find((skill) => skill.id === 'legacy-review')?.conflictsWith).toEqual(['team-pack:review-helper']);
    expect(result.bundles).toEqual(qualified.bundles);
    expect(local.skills.find((skill) => skill.id === 'review-helper')?.requires).toEqual(['git-basics']);
    expect(local.bundles[0]?.members.every((member) => member.ref === undefined)).toBe(true);
  });

  test('attributes duplicate errors and warnings to their repository, then filters them out with that repository', async () => {
    await fs.rm(primary.checkoutPath, {recursive: true});
    await writeSkillpack(primary.checkoutPath, {
      skills: ['first', 'nested/second'].map((relativePath) => ({
        relativePath,
        frontmatter: {name: 'commit-message', description: 'Writes commit messages.'},
        body: '# Commit messages'
      }))
    });
    const result = await discoverSkillpacks([primary, secondary]);

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'duplicate-skill-id',
      skillpackId: primary.id,
      message: expect.stringContaining(`Skillpack "${primary.id}"`)
    }));
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'missing-registry',
      skillpackId: primary.id,
      message: expect.stringContaining(`Skillpack "${primary.id}"`)
    }));
    expect(result.skillpacks?.find((item) => item.id === primary.id)).toMatchObject({errorCount: 1, warningCount: 1});

    const filtered = filterSkillpackDiscovery(result, [secondary.id]);
    expect(filtered.skills).toHaveLength(5);
    expect(filtered.bundles).toHaveLength(2);
    expect(filtered.errors).toEqual([]);
    expect(filtered.warnings).toEqual([]);
    expect(filtered.source).toBe('registry');
    expect(filtered.registryVersion).toBe(3);
    expect(filtered.registryCounts).toEqual({
      skillCount: 5, versionedSkillCount: 5, bundleCount: 2, validBundleMembershipCount: 4
    });
    expect(filtered.skillpacks?.map((item) => item.id)).toEqual([secondary.id]);
    expect(result.errors).toHaveLength(1);
    expect(result.skills).toHaveLength(6);
    expect(filterSkillpackDiscovery(result, [primary.id, secondary.id])).toEqual(result);
  });

  test('isolates a thrown checkout read and refreshes without retaining stale skills', async () => {
    const healthy = await discoverSkillpacks([primary, secondary]);
    expect(healthy.skills).toHaveLength(10);
    const result = await discoverSkillpacks([primary, secondary], async (checkoutPath) => {
      if (checkoutPath === primary.checkoutPath) throw new Error('Access denied');
      return discoverSkillsFromCheckout(checkoutPath);
    });

    expect(result.skills).toHaveLength(5);
    expect(result.skills.every((skill) => skill.skillpackId === secondary.id)).toBe(true);
    expect(result.errors).toEqual([expect.objectContaining({
      code: 'skillpack-discovery-failed', skillpackId: primary.id, message: expect.stringContaining('Access denied')
    })]);
    expect(result.skillpacks?.find((item) => item.id === primary.id)).toMatchObject({
      ready: false, skillCount: 0, errorCount: 1, message: 'Access denied'
    });
    expect(filterSkillpackDiscovery(result, [secondary.id]).errors).toEqual([]);
    expect(filterSkillpackDiscovery(result, [primary.id, secondary.id])).toEqual(result);
  });

  test('returns an empty catalog and performs no reads for an empty selection', async () => {
    const discover = vi.fn(discoverSkillsFromCheckout);
    const result = await discoverSkillpacks([], discover);

    expect(discover).not.toHaveBeenCalled();
    expect(result).toMatchObject({skills: [], bundles: [], warnings: [], errors: [], skillpacks: []});
    expect(filterSkillpackDiscovery(await discoverSkillpacks([primary, secondary]), [])).toEqual(result);
  });
});

function config(id: string, root: string): SkillpackConfig {
  return {id, repositoryUrl: `https://example.invalid/${id}.git`, branch: 'main', checkoutPath: path.join(root, id)};
}
