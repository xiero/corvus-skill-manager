Timestamp: 2026-08-24T20:05:00Z
Version: v1.3.0

# Implementation Plan: Registry v3 Bundles and Versioning — Phase 3

## Context

Registry v3 discovery is complete. Phase 3 implements `CSM-BND-013` through `CSM-BND-016`:
persist explicit skill and bundle roots independently in Manager Config v3, normalize legacy
configs to that model without read-side writes, make persisted install plans describe root changes
separately from derived link operations, and introduce the adapter-neutral root/effective selection
read model used by later resolver, status, verification, and TUI phases.

Source spec: `_specs/registry-v3-bundles-and-versioning.md`

## Open Question Status

- Answered: normalized in-memory manager config is always v3; v1/v2 are persisted input formats
  only and every legacy selected skill becomes a qualified explicit skill root.
- Answered: `selectedSkillIds` and `selectedBundleIds` are canonical qualified-ref arrays,
  deduplicated and sorted during normalization; invalid v3 local or multi-colon refs are rejected.
- Answered: read-only config loading normalizes only in memory. `saveConfig`, which is reachable
  only from confirmed write workflows, persists the normalized v3 shape.
- Answered: install plan artifacts advance to schema v2 and carry before/after root-skill and
  root-bundle arrays. Old plan artifacts are rejected and must be regenerated rather than being
  assigned new semantics after a config contract change.
- Answered: the existing v1 install request has no bundle field, so Phase 3 preserves existing
  bundle roots. Bundle mutation enters through the versioned install contract in Phase 5.
- Answered: effective selection entries are unique by qualified skill ref and retain a canonical,
  deduplicated collection of provenance records.
- Still blocked: none.

## Assumptions

- Persisted plan artifacts are short-lived review artifacts. Rejecting plan-schema v1 after the
  schema bump is safer than applying a pre-v3 plan under root-only selection semantics.
- The manifest remains unchanged and continues to record only owned filesystem links.
- TUI screens do not expose bundle selection in this phase, but any config write they perform
  must preserve existing bundle roots until Phase 7 adds the bundle UI.
- Status and verification integration with fully derived effective selections remains in the
  later resolver/install phases; this phase establishes the shared pure read model.

## Critical Files

- `packages/core/src/config/configSchema.ts` — persisted v1/v2/v3 schemas, strict v3 qualified
  roots, canonical in-memory migration, and v3 defaults.
- `packages/core/src/config/configStore.ts` — v3-only persistence after explicit writes.
- `packages/core/src/config/configSchema.test.ts` and `configStore.test.ts` — strict schema,
  migration, idempotence, persistence, and no-write coverage.
- `packages/core/src/application/plans/planSchema.ts` — plan schema v2 and root skill/bundle
  config-change fields.
- `packages/core/src/application/install/installPlanner.ts` and
  `application/useCases/installUseCases.ts` — canonical root-change construction, preservation,
  stale checks, apply persistence, and verification.
- `packages/core/src/skills/selectionModel.ts` — pure root/effective/provenance read model.
- `packages/core/src/skills/selectionModel.test.ts` — deduplication and multi-provenance tests.
- `packages/core/src/application/useCases/skillpackUseCases.ts` and affected TUI config writers —
  v3 writes that preserve bundle roots.
- `packages/core/src/index.ts` — curated config and selection-model exports.

## Implementation Sequence

1. Split persisted config validation by version and add strict Manager Config v3 agent roots.
2. Normalize v1/v2/v3 into one canonical v3 in-memory shape, qualifying legacy skill roots and
   initializing legacy bundle roots to empty without filesystem effects.
3. Persist only Config v3 from write-capable paths; update config writers to preserve bundle
   roots even before bundle selection UI exists.
4. Advance persisted plans to schema v2 and add canonical root skill/bundle before/after fields
   to each agent config change, while keeping link operations separate.
5. Thread bundle-root preservation through current individual-skill planning, apply,
   idempotence, stale-state, and verification code.
6. Add the pure selection read model with canonical roots, unique effective skills, and
   multi-provenance retention.
7. Add focused schema/store/plan/selection tests plus read-only status/doctor byte-equality
   coverage for legacy configs.
8. Update architecture/task documentation, run targeted tests, `pnpm typecheck`, `pnpm test`,
   review the diff, and create the approved local commit.

## Data, API, or Contract Changes

- Manager Config v3 is the only normalized/output config version.
- Every normalized agent config has root-only `selectedSkillIds` plus `selectedBundleIds`.
- Config v1/v2 remain readable and normalize to v3 in memory without persistence.
- Persisted plan artifacts advance from schema v1 to schema v2.
- `AgentConfigChange` gains `selectedBundleIdsFrom` and `selectedBundleIdsTo`; skill fields now
  explicitly mean root skills.
- Core exports a shared `SelectionReadModel` and canonical constructor for root/effective state.
- Manifest, lock, machine protocol, install request, and registry contracts do not change here.

## Testing Strategy

- Config schema: valid mixed roots, strict unknown fields, qualified ref enforcement, invalid
  bundle refs, duplicate normalization, and deterministic ordering.
- Migration: v1 local roots qualify to their legacy pack, v2 roots keep current qualification
  rules, v3 is idempotent, and legacy bundle roots initialize empty.
- Read-only safety: loading/status/doctor over v1/v2 changes no filesystem bytes.
- Plan schema/digest: root skill and bundle changes are separate, ordering-independent inputs
  produce identical plans, and plan-schema v1 artifacts are rejected.
- Install regression: individual-skill requests preserve bundle roots through plan/apply and
  include canonical bundle before/after fields.
- Selection model: duplicate roots/effective inputs collapse while distinct provenance paths
  remain stable and deterministic.

## Verification Commands

```sh
pnpm vitest run packages/core/src/config/configSchema.test.ts packages/core/src/config/configStore.test.ts
pnpm vitest run packages/core/src/skills/selectionModel.test.ts
pnpm vitest run packages/core/src/application/install.test.ts packages/core/src/application/protocol/protocol.test.ts
pnpm vitest run packages/core/src/reports/statusDoctor.test.ts
pnpm typecheck
pnpm test
```

## Documentation Updates

- Update `architecture.md` and `docs/agent-native-architecture.md` with Config v3 root storage
  and the root/effective read-model boundary.
- Mark `CSM-BND-013` through `CSM-BND-016` complete after verification.
- Record any safe implementation deviation and final verification state in this plan.

## Risks and Stop Conditions

- Stop if Config v3 migration would require writing from a read-only command.
- Stop if existing bundle roots cannot be preserved through a current TUI/config write without
  adding Phase 7 selection behavior.
- Do not implement bundle expansion, bundle install requests, machine commands, or TUI bundle
  selection in this phase.
- Do not mutate any skillpack checkout, registry, skill file, manifest contract, or link target
  outside an explicitly confirmed existing plan/apply workflow.

## Rollback Notes

Revert the Phase 3 commit. Config files already persisted as v3 would then require a newer binary
to read, so rollback is code-only before exercising a write workflow against user state. No
automatic downgrade or manager-authored config rewrite is allowed.

## Verification Result

- Focused Config v3, plan schema, selection model, install, report, application, protocol, and
  TUI suites passed.
- `pnpm typecheck` passed.
- `pnpm test` passed: 41 files, 394 tests.
- `pnpm build` passed.
- `git diff --check` passed.
- Deviation: none. Bundle expansion and bundle mutation remain deferred to their roadmap phases.

## Commit Message Draft

```text
✨ feat(core): add config v3 root selections
```
