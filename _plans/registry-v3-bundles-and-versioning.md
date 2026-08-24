Timestamp: 2026-08-24T21:10:00Z
Version: v1.4.0

# Implementation Plan: Registry v3 Bundles and Versioning — Phase 4

## Context

Phases 1–3 established versioned Registry v3 discovery, bundle catalog/compatibility data, and
Config v3 root selection storage. Phase 4 implements `CSM-BND-017` through `CSM-BND-021`: pure
bundle expansion, multi-origin provenance, composed effective selection resolution, post-expansion
agent compatibility, and conflict/recommendation handling over the final effective set.

Source spec: `_specs/registry-v3-bundles-and-versioning.md`

## Open Question Status

- Answered: bundle roots are qualified references and resolve only against the discovered bundle
  with that exact identity.
- Answered: bundle members remain local to their owning skillpack; cross-skillpack or missing
  members are blocking structured resolution errors.
- Answered: effective skills are canonical and unique, while every distinct root/dependency
  origin is retained in deterministic order.
- Answered: dependencies retain immediate `dependency-of:<qualified-skill-ref>` provenance and
  separately carry their originating bundle roots through traversal for actionable diagnostics.
- Answered: compatibility and conflicts are evaluated only after complete expansion; a failure
  blocks the entire agent plan and never installs a compatible subset.
- Answered: recommendations are collected from effective skills and are never selected.
- Answered: Phase 4 makes existing Config v3 bundle roots effective. Adding/removing bundle roots
  through the request, CLI, or TUI remains Phase 5/7 work.
- Still blocked: none.

## Critical Files

- `packages/core/src/skills/bundleResolver.ts` — qualified bundle lookup, authored-order direct
  expansion, multi-bundle provenance, and structured errors.
- `packages/core/src/skills/effectiveSelectionResolver.ts` — root skills plus bundle members,
  transitive hard dependencies, bundle-origin propagation, and canonical effective results.
- `packages/core/src/skills/selectionModel.ts` and `skillRelationships.ts` — shared provenance
  kinds and existing relationship primitives.
- `packages/core/src/application/install/installPlanner.ts` — use the composed resolver for
  previous/next state; validate support, conflicts, and recommendations on the effective set.
- `packages/core/src/application/plans/planSchema.ts` — permit `bundle-member` primary reasons
  and a deterministic origins collection without changing install request semantics.
- Focused tests beside the resolver modules and in `packages/core/src/application/install.test.ts`.

## Implementation Sequence

1. Add a pure bundle resolver with exact qualified lookup, local-member validation, authored-order
   expansion, overlap deduplication, and retained `bundle-member` origins.
2. Align resolved-selection provenance types and plan validation with the shared provenance model,
   retaining a deterministic primary reason plus all origins.
3. Add the composed effective resolver for explicit/all-compatible roots, bundle members, and
   breadth-first hard dependencies; propagate bundle roots across transitive paths.
4. Replace planner-local dependency-only expansion with the composed resolver for both previous
   and next Config v3 selections.
5. Validate every effective skill for the target agent and include bundle refs and blocking skills
   in failures; keep bundle selection atomic.
6. Run symmetric conflicts and recommendations over the final effective set and include available
   provenance in conflict details.
7. Export the new pure APIs, update architecture/task documentation, verify, self-review, and
   create the approved local commit.

## Data, API, or Contract Changes

- Core gains pure `expandBundleSelection` and `resolveEffectiveSelection` APIs.
- `SkillSelectionReasonKind` includes `bundle-member`.
- Resolved plan selections retain the deterministic primary `reason`/`reasonKind` fields and add
  an optional canonical `origins` collection; old schema-v2 plan documents remain parseable.
- The install request remains schema v1 and has no bundle mutation field in this phase.
- Manager Config stays v3; existing `selectedBundleIds` now contribute effective links.
- Registry, manifest, lock, and machine envelope versions do not change.

## Testing Strategy

- Bundle resolver: exact members/authored order, duplicate roots, overlapping bundles with multiple
  origins, unknown bundle, missing member, and skillpack-boundary rejection.
- Effective resolver: mixed roots, shared dependencies, cycles, deterministic output, missing
  dependencies, separate bundle-member/dependency summaries, and bundle-origin propagation.
- Planner: preserved Config v3 bundle roots produce links; unsupported direct/transitive bundle
  skills block atomically with bundle details; bundle-vs-bundle and bundle-vs-explicit conflicts
  block; effective recommendations remain unselected.
- Plan schema: `bundle-member` and multi-origin selections parse deterministically while existing
  explicit/dependency selections remain valid.

## Verification Commands

```sh
pnpm vitest run packages/core/src/skills/bundleResolver.test.ts packages/core/src/skills/effectiveSelectionResolver.test.ts
pnpm vitest run packages/core/src/skills/skillRelationships.test.ts packages/core/src/application/plans/planSchema.test.ts
pnpm vitest run packages/core/src/application/install.test.ts
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## Documentation Updates

- Update `architecture.md` and `docs/agent-native-architecture.md` with the composed effective
  resolver and the post-expansion validation boundary.
- Mark `CSM-BND-017` through `CSM-BND-021` complete only after full verification.
- Record verification results and any deviation here before commit.

## Risks and Stop Conditions

- Stop if bundle resolution would require mutating or repairing an active skillpack checkout.
- Stop if preserving old plan artifacts requires assigning them new mutation semantics; schema-v2
  compatibility is limited to an additive optional provenance field.
- Do not add install request bundle fields, CLI commands, or TUI selection in this phase.
- Do not mutate manager state or agent targets while developing or testing outside isolated test
  homes and existing confirmed plan/apply tests.

## Rollback Notes

Revert the Phase 4 commit. Config v3 bundle roots remain stored but again become inert in the
Phase 3 planner. No manager state, user links, or skillpack checkout is migrated by this code-only
change.

## Verification Result

- Focused bundle resolver, effective resolver, selection, relationship, plan-schema, planner, and
  golden protocol suites passed.
- `pnpm typecheck` passed.
- `pnpm test` passed: 43 files, 405 tests.
- `pnpm build` passed.
- `git diff --check` passed.
- Deviation: install request schema v1 remains intentionally bundle-read-only; Phase 4 activates
  bundle roots already persisted in Config v3, while bundle mutation stays in Phase 5.

## Commit Message Draft

```text
✨ feat(core): resolve bundle selections
```
