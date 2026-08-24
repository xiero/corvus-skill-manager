Timestamp: 2026-08-24T19:11:54Z
Version: v1.1.0

# Implementation Plan: Registry v3 Bundles and Versioning — Phase 1

## Context

Phase 0 froze the contract and added strict shared SemVer helpers. Phase 1 implements
`CSM-BND-003` through `CSM-BND-008`: Registry v3 parsing, versioned hard dependencies,
first-class bundle metadata, same-snapshot constraint validation, explicit MVP boundaries, and
read-only maintainer diagnostics.

Source spec: `_specs/registry-v3-bundles-and-versioning.md`

## Open Question Status

- Answered: Registry v3 requires an explicit `bundles` array; `[]` represents zero bundles.
- Answered: v3 `requires` and bundle members use strict `{id, version}` objects; v1/v2 continue to
  use local ID strings.
- Answered: Phase 1 normalizes v3 hard dependencies to the existing runtime ID representation.
  Carrying skill versions and defining qualified `DiscoveredBundle` objects remain Phase 2 tasks.
- Answered: cross-reference validation checks only the one version in the active immutable
  snapshot and never resolves, downloads, or selects another version.
- Still blocked: none.

## Critical Files

- `packages/core/src/registry/registrySchema.ts` — version/range schemas, Registry v3 skills,
  bundles, strict version dispatch, and legacy compatibility.
- `packages/core/src/skills/skillDiscovery.ts` — version-aware entry parsing, structured v3
  diagnostics, registry counts, and dependency normalization.
- `packages/core/src/skills/skillRelationships.ts` — deterministic same-snapshot dependency and
  bundle-member validation.
- `packages/core/src/application/useCases/skillsUseCases.ts` — read-only validation report counts.
- `packages/core/src/reports/reportInternals.ts` — aggregate count preservation.
- `packages/core/src/index.ts` — curated public v3 schema exports.
- `docs/skillpack-contract.md` — public v3 authoring and boundary contract.

## Implementation Sequence

1. Add strict Zod primitives backed by the Phase 0 SemVer helpers.
2. Add Registry v3 skill entries with mandatory versions and versioned `requires` references.
3. Add strict bundle/member schemas with canonical versions, bounded catalog metadata, duplicate
   member rejection, and no filesystem fields.
4. Dispatch discovery parsing by registry version while preserving v1/v2 behavior and normalize
   hard dependencies to local runtime IDs.
5. Validate hard-dependency and bundle-member existence/ranges against the same v3 snapshot;
   reject duplicate bundle IDs and nested bundle references deterministically.
6. Extend `validate-registry` output with stable issue codes/details and counts for versioned
   skills, bundles, and valid bundle memberships.
7. Document the v3 contract and mark verified Phase 1 acceptance criteria complete.
8. Run focused tests, repository typecheck, and the full test suite before committing.

## Data, API, or Contract Changes

- Supported registry versions become `[1, 2, 3]`; the current registry version becomes `3`.
- Registry v3 skills require canonical `version` and object-valued hard dependencies.
- Registry v3 requires a top-level `bundles` array containing strict, versioned bundle metadata.
- Discovery issues may include `bundleId`, `memberId`, `versionRange`, and `actualVersion`.
- Discovery carries declared-skill and registry validation counts but does not yet expose versioned skill or qualified
  bundle catalog objects; those remain `CSM-BND-009` and `CSM-BND-010`.
- `validate-registry` adds `versionedSkillCount`, `bundleCount`, and
  `validBundleMembershipCount`; existing v1/v2 fields and behavior remain intact.

## Testing Strategy

- Schema tests: v1/v2 compatibility; canonical/missing skill versions; exact/caret/tilde/bounded
  dependency ranges; strict bundle fields; empty/duplicate/malformed members; invalid IDs,
  versions, qualified IDs, and unknown fields.
- Domain tests: satisfying/mismatching ranges, unknown members, nested members, duplicate bundle
  IDs, deterministic ordering, and downstream hard-dependency normalization.
- Application tests: exact v3 error codes and mismatch detail fields, count reporting, legacy zero
  counts, and before/after filesystem equality for read-only validation.
- Regression tests: full monorepo typecheck and Vitest suite, including machine golden fixtures.

## Verification Commands

```sh
pnpm vitest run packages/core/src/registry/registrySchema.test.ts
pnpm vitest run packages/core/src/skills/skillRelationships.test.ts packages/core/src/skills/skillDiscovery.test.ts
pnpm vitest run packages/core/src/application/application.test.ts
pnpm typecheck
pnpm test
```

## Documentation Updates

- `docs/skillpack-contract.md` documents Registry v3 versions, dependency/member ranges, bundle
  fields, read-only validation, and the same-pack/non-nested MVP boundary.
- `docs/CORVUS_BUNDLES_VERSIONING_IMPLEMENTATION_TASKS.md` records verified completion of
  `CSM-BND-003` through `CSM-BND-008`.

## Risks and Stop Conditions

- Stop if v1/v2 fixtures stop parsing or their relationship behavior changes.
- Stop if bundle validation requires writing to a skillpack or resolving another revision.
- Do not introduce Phase 2 discovery catalog objects, selection expansion, config migration,
  install-planning, TUI, or machine bundle commands in this phase.
- Do not add multi-version resolution, network fetching, nested bundles, or cross-skillpack
  bundle members.

## Rollback Notes

Revert the Phase 1 implementation commit. Registry v1/v2 remain independently represented by
their explicit schemas, and no persisted manager-state format changes in this phase.

## Commit Message Draft

```text
✨ feat(core): add registry v3 bundle validation
```
