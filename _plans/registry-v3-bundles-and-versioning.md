Timestamp: 2026-08-24T22:55:00Z
Version: v1.5.0

# Implementation Plan: Registry v3 Bundles and Versioning — Phase 5

## Context

Phases 1–4 established Registry v3 discovery, Config v3 roots, and deterministic effective
resolution. Phase 5 implements `CSM-BND-022` through `CSM-BND-028`: a backward-readable install
request v2 with bundle roots, bundle-aware additive/replacement planning, rich persisted plans,
registry/root stale-state protection, confirmed Config v3 persistence, recomputation-based bundle
removal, and read-only verification of roots, effective skills, and managed links.

Source spec: `_specs/registry-v3-bundles-and-versioning.md`

## Open Question Status

- Answered: request v1 remains readable and normalizes into the current v2 form with no bundle
  roots; request v2 is the only newly emitted form.
- Answered: `selectedBundles` mirrors selected skill identity as strict `{id}` entries. Bundle
  provenance remains the stable resolver-owned `bundle:<qualified-ref>` string.
- Answered: replacement replaces both root collections. Additive requests add the supplied skill
  and bundle roots; `allCompatible` adds only skills and clears bundles only in replacement mode.
- Answered: persisted plans advance to schema v3. Plan schema v2 artifacts are rejected and must
  be regenerated because root/effective and fingerprint semantics change.
- Answered: plan payloads expose final root selections separately from effective selections and
  link operations; summaries use canonical unique reference arrays.
- Answered: root fingerprints recognize either the plan's before or after root state so confirmed
  apply remains idempotent and partial re-apply remains possible, while any third state is stale.
- Answered: the manifest remains unchanged and link-only. Verification derives explanations from
  the plan and reports actual manager-owned links without repairing.
- Still blocked: none.

## Assumptions

- Dedicated `--bundle` flags, bundle discovery commands, and complete capability advertising are
  Phase 6; Phase 5 makes request-document/application callers bundle-capable.
- A bundle-only explicit request is valid. A deliberately empty explicit v2 request may provide
  either empty `selectedSkills`, empty `selectedBundles`, or both.
- Registry fingerprints include selected bundle definitions and all previous/next effective skill
  metadata, not volatile timestamps or unrelated catalog entries.
- Apply persists root intent only after exact confirmation and link application using existing
  ownership safeguards; unexpected partial filesystem failure remains visible to verification.

## Critical Files

- `packages/core/src/application/install/installRequest.ts` — v1/v2 parsing and canonical v2
  normalization.
- `packages/core/src/application/install/installPlanner.ts` — requested bundle validation,
  additive/replacement root recomputation, and derived summaries.
- `packages/core/src/application/plans/planSchema.ts` — plan schema v3, normalized request v2,
  root selections, rich summary, and required provenance.
- `packages/core/src/application/useCases/installUseCases.ts` — registry/root fingerprints,
  confirmed Config v3 persistence, idempotence, and root/effective verification output.
- `packages/core/src/application/install.test.ts` and plan/request/golden tests — end-to-end
  request, plan, stale state, removal, apply, verification, and no-write coverage.
- Agent protocol/interface examples and architecture/task documentation.

## Implementation Sequence

1. Add strict install request v1/v2 schemas and normalize both to canonical v2 with sorted,
   deduplicated skill/bundle roots.
2. Extend planner selection resolution to validate qualified bundle requests and compute next
   skill and bundle root collections under additive and replacement semantics.
3. Feed those final roots through the Phase 4 resolver for previous/next effective sets, exposing
   bundle members and dependencies separately while preserving existing link safety.
4. Advance persisted plans to schema v3; add per-agent final roots, required effective origins,
   and summary arrays for bundles, bundle members, dependencies, and effective skills.
5. Fingerprint selected bundle definitions, relevant versioned skill metadata, and recognized
   before/after root state under named `registry` and `rootSelections` components.
6. Persist Config v3 roots only during confirmed apply, leave manifest schema unchanged, and prove
   plan-only/request parsing does not write user state beyond the authorized plan artifact.
7. Cover bundle removal by replacing roots and recomputing effective links, including overlaps,
   shared dependencies, and explicit roots that retain former bundle members.
8. Extend read-only install verification with per-agent root/effective/managed state and stale
   manager-owned link reporting.
9. Update authoritative documentation and golden artifacts, run focused/full verification,
   self-review, and create the approved local commit.

## Data, API, or Contract Changes

- Install request schema advances from v1 to v2; v1 remains accepted and normalizes to v2.
- Request v2 adds `selectedBundles`; `allCompatible` remains bundle-free.
- Persisted plan schema advances from v2 to v3 and rejects older artifacts.
- Install plan payload adds `rootSelections`; effective selections require canonical `origins`.
- Install summary adds `bundlesSelected`, `bundleMembersAdded`, and `effectiveSkills` arrays.
- Fingerprints add `registry` and `rootSelections` components and cover semantic versions,
  relationships, bundle definitions, and selected roots.
- Install verification adds per-agent selection state; manifest and machine envelope versions do
  not change.

## Testing Strategy

- Request contract: v1 compatibility, v2 skill-only/bundle-only/mixed forms, explicit/all conflict,
  duplicates, reordered roots, and byte-identical normalization.
- Planning/apply: additive and replacement bundle roots, bundle-only/mixed links, root-only config,
  legacy Config v1/v2 upgrade only after apply, and plan-time no-write assertions.
- Plan contracts: schema v3 rejection of v2, roots/effective separation, summary fields,
  digest sensitivity, tamper detection, and deterministic ordering.
- Fingerprints: bundle version/membership changes and third-state root changes report exact named
  stale components; timestamp-only config changes do not.
- Removal: overlapping bundles retain shared members/dependencies; explicit roots retain former
  members; final-root removal removes only manifest-owned links.
- Verification: bundle-derived missing links, root/effective explanations, stale managed links,
  and byte-for-byte no-write behavior.

## Verification Commands

```sh
pnpm vitest run packages/core/src/application/install.test.ts packages/core/src/application/plans/planSchema.test.ts
pnpm vitest run packages/core/src/application/protocol/protocol.test.ts packages/cli/src/cli/golden.test.ts
pnpm vitest run packages/tui/src/application/equivalence.test.ts
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## Documentation Updates

- Update `architecture.md`, `docs/agent-native-architecture.md`, `docs/agent-protocol-v1.md`,
  `docs/agent-interface.md`, and request examples for request v2/plan v3/root-effective semantics.
- Mark `CSM-BND-022` through `CSM-BND-028` complete only after verification.
- Record verification results and any safe deviation here before commit.

## Risks and Stop Conditions

- Stop if compatibility would assign new bundle meaning to a request v1 or plan v2 artifact.
- Stop if stale-state protection breaks idempotent apply or partial re-apply.
- Stop if bundle removal could remove an unmanaged link or a link still implied by another root.
- Do not add Phase 6 bundle discovery commands/dedicated CLI flags or Phase 7 TUI selection UI.
- Do not mutate any active skillpack checkout, existing revision snapshot, or non-test manager state.

## Rollback Notes

Revert the Phase 5 commit. Request v2 and plan v3 artifacts then require regeneration with a newer
binary; already persisted Config v3 roots and manifest-owned links remain valid data. No automatic
downgrade or manager-authored skillpack rewrite is allowed.

## Verification Result

- `pnpm typecheck` — passed.
- `pnpm test` — passed: 44 test files, 418 tests.
- `pnpm build` — passed.
- `git diff --check` — passed.
- Safe compatibility deviation: normalized request v1 carries an internal `preserve` bundle mode
  so replacement requests created before bundles existed cannot silently erase Config v3 bundle
  roots. Newly emitted request v2 uses explicit bundle-root semantics.
- Phase 6 bundle discovery commands and dedicated CLI flags remain intentionally out of scope.

## Commit Message Draft

```text
✨ feat(core): add bundle-aware install plans
```
