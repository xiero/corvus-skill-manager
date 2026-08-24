import {describe, expect, it} from 'vitest';
import {createSelectionReadModel} from './selectionModel.js';

describe('selection read model', () => {
  it('canonicalizes root skills and bundles independently', () => {
    const model = createSelectionReadModel({
      rootSkillRefs: ['team:z', 'team:a', 'team:z'],
      rootBundleRefs: ['team:z-flow', 'team:a-flow', 'team:z-flow'],
      effectiveSkills: []
    });

    expect(model.roots).toEqual({
      skillRefs: ['team:a', 'team:z'],
      bundleRefs: ['team:a-flow', 'team:z-flow']
    });
  });

  it('deduplicates effective skills while retaining multiple provenance paths', () => {
    const model = createSelectionReadModel({
      rootSkillRefs: ['team:review'],
      rootBundleRefs: ['team:review-flow', 'team:quality-flow'],
      effectiveSkills: [
        {
          skillRef: 'team:review',
          provenance: [
            {kind: 'bundle-member', reason: 'bundle:team:review-flow'},
            {kind: 'explicit', reason: 'explicit'}
          ]
        },
        {
          skillRef: 'team:test',
          provenance: [{kind: 'bundle-member', reason: 'bundle:team:quality-flow'}]
        },
        {
          skillRef: 'team:review',
          provenance: [
            {kind: 'bundle-member', reason: 'bundle:team:quality-flow'},
            {kind: 'bundle-member', reason: 'bundle:team:review-flow'}
          ]
        }
      ]
    });

    expect(model.effectiveSkills).toEqual([
      {
        skillRef: 'team:review',
        provenance: [
          {kind: 'explicit', reason: 'explicit'},
          {kind: 'bundle-member', reason: 'bundle:team:quality-flow'},
          {kind: 'bundle-member', reason: 'bundle:team:review-flow'}
        ]
      },
      {
        skillRef: 'team:test',
        provenance: [{kind: 'bundle-member', reason: 'bundle:team:quality-flow'}]
      }
    ]);
  });

  it('is byte-for-byte deterministic across equivalent input ordering', () => {
    const input = {
      rootSkillRefs: ['team:b', 'team:a'],
      rootBundleRefs: ['team:flow'],
      effectiveSkills: [
        {skillRef: 'team:b', provenance: [{kind: 'dependency-of' as const, reason: 'dependency-of:team:a'}]},
        {skillRef: 'team:a', provenance: [{kind: 'explicit' as const, reason: 'explicit'}]}
      ]
    };
    const first = createSelectionReadModel(input);
    const second = createSelectionReadModel({
      rootSkillRefs: [...input.rootSkillRefs].reverse(),
      rootBundleRefs: input.rootBundleRefs,
      effectiveSkills: [...input.effectiveSkills].reverse()
    });

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
