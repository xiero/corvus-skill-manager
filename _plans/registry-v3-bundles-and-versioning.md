Timestamp: 2026-08-24T18:37:06Z
Version: v1.0.0

# Implementation Plan: Registry v3 Bundles and Versioning — Phase 0

## Context

`CSM-BND-001` has frozen the Registry v3 bundle/versioning architecture contract. The remaining
Phase 0 task, `CSM-BND-002`, introduces a maintained SemVer implementation behind small pure core
helpers so later registry, dependency, bundle, and update tasks share one strict interpretation
of versions and ranges.

Source spec: `_specs/registry-v3-bundles-and-versioning.md`

## Open Question Status

- Answered: the source spec requires canonical SemVer 2.0.0 versions, standard exact/caret/tilde/
  comparator ranges, canonical prerelease/build forms, and major/minor/patch/same classification.
- Answered: standard node-semver prerelease range behavior applies; a prerelease must be opted into
  by a comparator on the same major/minor/patch tuple.
- Still blocked: none.

## Assumptions

- Use `semver` 7.8.5, the maintained parser used by npm, as a core runtime dependency.
- Use `@types/semver` 7.8.0 as a core development dependency because `semver` 7.8.5 does not ship
  TypeScript declarations.
- Strict version parsing rejects node-semver's backward-compatible cleanup forms such as a leading
  `v` or `=` by comparing the input with its complete canonical form, including build metadata.
- Range parsing rejects empty or untrimmed input, uses node-semver strict mode, and keeps the
  authored expression for actionable diagnostics.
- Change classification is direction-independent and maps prerelease-only/prepatch differences to
  `patch`, preminor to `minor`, and premajor to `major`; build metadata alone is `same` because it
  does not affect SemVer precedence.

## Critical Files

- `packages/core/package.json` — declares the SemVer runtime dependency and TypeScript definitions.
- `pnpm-lock.yaml` — locks the resolved dependency graph.
- `packages/core/src/versioning/semver.ts` — pure strict parsing, satisfaction, and change helpers.
- `packages/core/src/versioning/semver.test.ts` — valid/invalid, range, prerelease, and
  classification coverage.
- `packages/core/src/index.ts` — exposes the shared primitives through the curated core API.
- `_plans/registry-v3-bundles-and-versioning.md` — records the Phase 0 implementation sequence and
  verified library decision.

## Implementation Sequence

1. Add `semver` to core runtime dependencies and its required declarations to core dev
   dependencies, updating the pnpm lockfile through pnpm.
2. Add branded version/range string types and stable validation error classes in a dependency-
   independent core module API.
3. Implement canonical version parsing that accepts valid prerelease/build metadata but rejects
   cleanup/coercion forms, partial versions, whitespace, and malformed identifiers.
4. Implement strict non-empty range validation plus satisfaction using node-semver's default
   prerelease semantics.
5. Implement deterministic major/minor/patch/same change classification, including prerelease and
   build-metadata cases.
6. Export the helpers from the core barrel without integrating them into Registry v1/v2 parsing.
7. Add focused Vitest coverage, then run targeted and repository-wide verification.

## Data, API, or Contract Changes

- Adds a public core API for parsed `SemanticVersion`, `SemanticVersionRange`, strict parsing,
  range satisfaction, and four-way change classification.
- Adds stable `INVALID_SEMANTIC_VERSION` and `INVALID_SEMANTIC_VERSION_RANGE` validation errors.
- No Registry schema, discovery, config, plan artifact, TUI, or machine protocol behavior changes
  in this task.

## Testing Strategy

- Unit tests: canonical releases, prereleases, build metadata, invalid loose/partial/whitespace
  forms, exact/caret/tilde/bounded ranges, malformed/blank ranges, prerelease satisfaction, all
  change kinds, downgrades, and build-only changes.
- Component tests: not applicable; helpers are pure core functions.
- Integration tests: existing repository tests ensure adding the exported API changes no current
  registry or adapter behavior.
- E2E/smoke checks: typecheck and full Vitest suite.

## Verification Commands

```sh
pnpm vitest run packages/core/src/versioning/semver.test.ts
pnpm typecheck
pnpm test
```

## Documentation Updates

- Update this plan with the CSM-BND-002 implementation decision.
- Mark the verified CSM-BND-001 and CSM-BND-002 acceptance criteria complete in the ordered task
  list so Phase 1 dependency checks are auditable.
- No public contract update is required: the source spec already freezes canonical SemVer and
  node-semver-compatible range behavior, and Registry v3 is not enabled yet.

## Risks and Stop Conditions

- Stop if the selected library cannot express the frozen canonical version or range behavior
  without custom range parsing.
- Stop if adding the dependency changes Registry v1/v2 behavior or requires adapter-layer logic.
- Do not introduce version selection, network fetching, registry mutation, or multi-version
  resolution.

## Rollback Notes

Revert the Phase 0 implementation commit. Removing the helper module, exports, dependency entries,
and lockfile records restores the prior runtime because no persisted schema consumes them yet.

## Commit Message Draft

```text
✨ feat(core): add semantic version primitives
```
