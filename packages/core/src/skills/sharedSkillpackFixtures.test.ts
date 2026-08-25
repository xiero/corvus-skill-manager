import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  v1SkillpackFixture,
  v2SkillpackFixture,
  v3BundleSkillpackFixture,
  writeSkillpack
} from '../../../../test/support/skillpackFixtures.js';
import {discoverSkillsFromCheckout} from './skillDiscovery.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
});

describe('shared skillpack fixtures', () => {
  it.each([
    ['v1', v1SkillpackFixture, 1],
    ['v2', v2SkillpackFixture, 2],
    ['v3', v3BundleSkillpackFixture, 3]
  ] as const)('constructs a valid Registry %s checkout', async (_label, fixture, version) => {
    const discovery = await discoverFixture(fixture);

    expect(discovery.registryVersion).toBe(version);
    expect(discovery.skills.length).toBeGreaterThan(0);
    expect(discovery.errors).toEqual([]);
  });

  it('covers overlapping bundles, transitive dependencies, recommendations, and conflicts', async () => {
    const discovery = await discoverFixture(v3BundleSkillpackFixture);
    const defaultBundle = discovery.bundles.find((bundle) => bundle.id === 'default');
    const documentationBundle = discovery.bundles.find((bundle) => bundle.id === 'documentation');
    const review = discovery.skills.find((skill) => skill.id === 'review-helper');
    const legacyReview = discovery.skills.find((skill) => skill.id === 'legacy-review');

    expect(defaultBundle?.members.map((member) => member.id)).toEqual([
      'review-helper',
      'test-helper',
      'docs-helper'
    ]);
    expect(documentationBundle?.members.map((member) => member.id)).toEqual(['docs-helper']);
    expect(review).toMatchObject({requires: ['git-basics'], recommends: ['docs-helper']});
    expect(legacyReview?.conflictsWith).toEqual(['review-helper']);
  });
});

async function discoverFixture(fixture: Parameters<typeof writeSkillpack>[1]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corvus-shared-fixture-'));
  roots.push(root);
  await writeSkillpack(root, fixture);
  return discoverSkillsFromCheckout(root);
}
