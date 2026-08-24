Timestamp: 2026-08-24T19:18:04Z
Version: v1.2.0

# Implementation Plan: Registry v3 Bundles and Versioning — Phase 2

## Context

Registry v3 now parses and validates versioned skills, dependencies, and bundles. Phase 2
implements `CSM-BND-009` through `CSM-BND-012`: carry versions into discovery, expose bundles as
separate qualified catalog objects, derive explainable whole-bundle agent compatibility, and add
read-only bundle list/search/inspect methods to the shared application service.

Source spec: `_specs/registry-v3-bundles-and-versioning.md`

## Open Question Status

- Answered: `DiscoveredSkill.version` is optional; presence means an exact validated Registry v3
  version, and absence is the explicit legacy/registryless unversioned state.
- Answered: `SkillDiscoveryResult.bundles` is a separate always-present array. Bundles never enter
  the linkable `skills` array and carry no filesystem path.
- Answered: checkout-local bundle/member refs remain local until report aggregation assigns the
  owning skillpack and qualified `<skillpack-id>:<id>` refs, matching existing skill behavior.
- Answered: compatibility checks direct members and each transitive hard dependency, returns
  structured blocking reasons, and never drops an incompatible skill.
- Answered: application methods are added now, but machine CLI commands/capabilities remain Phase
  6 (`CSM-BND-029`/`030`) and TUI presentation remains Phase 7.
- Still blocked: none.

## Assumptions

- Registry v3 schema validation remains the authority for member existence and version ranges;
  discovery carries normalized constraints and actual versions without choosing alternatives.
- Bundle search is a separate deterministic lexical scorer over id/title/description/tags/
  keywords, so existing skill search response semantics do not change.
- Bundle list/search output uses the existing bounded query/limit contract and v3 bundle/member
  schema bounds to remain token-efficient.
- All supported agent adapters are evaluated for inspection; list/search agent filters retain the
  existing "compatible with every requested agent" meaning.

## Critical Files

- `packages/core/src/skills/skillDiscovery.ts` — discovered skill versions, bundle/member domain
  models, local discovery, and registryless empty bundles.
- `packages/core/src/reports/reportInternals.ts` — skillpack ownership and qualified bundle/member
  refs plus deterministic aggregation.
- `packages/core/src/skills/bundleCompatibility.ts` — pure transitive compatibility derivation.
- `packages/core/src/application/skills/bundleCatalog.ts` — bounded bundle summaries and lexical
  search.
- `packages/core/src/application/useCases/skillsUseCases.ts` — read-only bundle list/search/
  inspect orchestration.
- `packages/core/src/application/CorvusApplication.ts` and `createCorvusApplication.ts` — shared
  adapter-facing application methods.
- `test/support/skillpackFixtures.ts` — representative v3 bundle fixture without replacing legacy
  v2 coverage.
- `packages/core/src/index.ts` — curated discovery, compatibility, catalog, and use-case exports.

## Implementation Sequence

1. Add optional exact versions to discovered skills and expose them through skill summaries.
2. Define bundle/member discovery types and populate a separate deterministic `bundles` array for
   Registry v3; legacy and registryless discovery return `[]`.
3. Qualify bundle and member refs during per-skillpack report composition and stable-sort bundles
   across skillpacks so identical local bundle IDs cannot collide.
4. Implement pure breadth-first compatibility traversal over direct members and transitive hard
   dependencies with stable, deduplicated blocking reasons.
5. Add compact bundle catalog summaries, requested-agent compatibility, and independent lexical
   search over the approved metadata fields.
6. Add bundle list/search/inspect application methods with validation, stable limits, missing-id
   errors, actual member versions, all-agent compatibility, and no-write tests.
7. Add focused discovery, multi-skillpack, compatibility, catalog/application, legacy, and
   determinism tests; update relevant contract documentation and task checkboxes.
8. Run targeted tests, `pnpm typecheck`, `pnpm test`, diff review, and the approved commit.

## Data, API, or Contract Changes

- `DiscoveredSkill` and `SkillSummary` gain optional exact `version` fields for Registry v3.
- `SkillDiscoveryResult` gains a separate `bundles: DiscoveredBundle[]` collection.
- `DiscoveredBundle` carries local/qualified identity, exact version, normalized metadata, and
  members with requested ranges plus actual snapshot versions; it has no source/link path.
- `CorvusApplication` gains `listBundles`, `searchBundles`, and `inspectBundles` read-only methods.
- A stable `BUNDLE_NOT_FOUND` application error is added for inspection misses.
- No machine command, config schema, persisted plan, install request, TUI, or manifest contract
  changes in this phase.

## Testing Strategy

- Discovery tests: Registry v1/v2/registryless unversioned behavior, exact v3 skill versions,
  normalized bundle metadata/member versions, empty bundles, and no bundle path fields.
- Multi-skillpack tests: identical local bundle IDs receive distinct qualified refs and members
  remain within their owning pack.
- Compatibility unit tests: fully compatible, direct-member incompatible, transitive-dependency
  incompatible, missing targets, deterministic ordering, and no partial-success behavior.
- Catalog/application tests: stable list/search/inspect output, metadata ranking, requested-agent
  filtering, actual versions, incompatibility reasons, bounded limits, missing IDs, repeated-call
  determinism, and before/after directory-tree equality.
- Regression tests: existing skill search remains unchanged; full monorepo typecheck and Vitest.

## Verification Commands

```sh
pnpm vitest run packages/core/src/skills/skillDiscovery.test.ts packages/core/src/skills/skillRelationships.test.ts
pnpm vitest run packages/core/src/skills/bundleCompatibility.test.ts
pnpm vitest run packages/core/src/application/application.test.ts packages/core/src/application/multiSkillpack.test.ts
pnpm typecheck
pnpm test
```

## Documentation Updates

- Update `docs/semantic-registry.md` with the distinct bundle discovery/search/compatibility model.
- Mark `CSM-BND-009` through `CSM-BND-012` complete in the ordered task document after verification.
- Refresh this plan with any safe implementation deviation and final verification state.

## Risks and Stop Conditions

- Stop if bundle read models require persisting config roots or changing install semantics; those
  belong to later phases.
- Stop if compatibility would need version selection, network access, or cross-skillpack members.
- Do not expose machine CLI commands or TUI UI in this phase.
- Do not mutate a skillpack checkout, registry, skill file, manager state, or link target from any
  new read-only method.

## Rollback Notes

Revert the Phase 2 commit. Registry v3 structural validation remains intact, and no persisted
state or machine protocol version is changed by this phase.

## Commit Message Draft

```text
✨ feat(core): add bundle discovery and catalog
```
