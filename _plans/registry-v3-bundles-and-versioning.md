Timestamp: 2026-08-25T05:41:06Z
Version: v1.8.0

# Implementation Plan: Registry v3 Bundles and Versioning — Phase 8

## Context

Phases 1–7 established Registry v3 bundles through human and machine install workflows. Phase 8
implements `CSM-BND-035` through `CSM-BND-037`: deterministic semantic comparison of active and
candidate revisions, impact analysis for configured bundle roots, and equivalent structured
machine/TUI update previews without changing the existing activation gate.

Source spec: `_specs/registry-v3-bundles-and-versioning.md`

## Open Question Status

- Answered: one pure core comparison model owns skill and bundle deltas; git setup composes it
  with existing changed-file data, while adapters only render or serialize the result.
- Answered: each entity delta has `added`, `removed`, or `changed` status and a version-change
  classification of `major`, `minor`, `patch`, `same`, or `unknown`. Added/removed and legacy
  unversioned comparisons use `unknown` because no two declared versions exist to compare.
- Answered: a configured bundle is affected by its own version/metadata/membership delta or by a
  delta to a direct/transitive effective member. Major declared-version changes set a
  `breakingRisk` warning but never block or approve activation.
- Answered: update-plan payload fields are additive and optional in the persisted schema so
  existing schema-v3 plan artifacts retain their original digest representation; newly created
  plans always carry the semantic fields.
- Answered: both the Guided Flow and Manage Skillpacks previews render the same core-produced
  semantic summary that machine JSON exposes.
- Still blocked: none.

## Assumptions

- Semantic deltas are local IDs within the update plan's named skillpack; the surrounding
  `skillpackId` provides qualification context.
- Existing changed skill IDs and changed-file paths remain present for compatibility and audit.
- Bundle impact analysis accepts canonical selected bundle roots gathered from in-memory config;
  it does not read or write manager state itself.
- Registry v1/v2 and registryless snapshots remain comparable by identity/content, with absent
  versions explicitly reported as `unknown`.
- No new runtime dependency is required; the existing strict SemVer classifier is reused.

## Critical Files

- `packages/core/src/versioning/revisionComparison.ts` — pure deterministic entity delta and
  selected-bundle impact model.
- `packages/core/src/git/skillpackSetup.ts` — read both immutable snapshots and attach semantic
  comparison while preserving changed-file output.
- `packages/core/src/application/plans/planSchema.ts` and
  `packages/core/src/application/useCases/skillpackUseCases.ts` — structured additive update-plan
  fields and selected-root wiring.
- `packages/tui/src/screens/SkillpackSetupScreen.tsx` and
  `packages/tui/src/screens/WizardScreen.tsx` — shared-data human presentation only.
- Core comparison/application/plan tests, TUI render tests, and CLI machine-envelope tests.
- `architecture.md`, `docs/agent-native-architecture.md`, `docs/agent-interface.md`, and the
  ordered implementation checklist.

## Implementation Sequence

1. Define pure semantic update types and deterministic comparison for skills and bundles,
   including version classification and canonical signatures.
2. Derive selected-bundle impact reasons from active/candidate bundle composition and effective
   member changes, retaining direct bundle/member identities and breaking-risk flags.
3. Extend inactive revision preview output with semantic deltas and affected bundles while
   preserving added/removed/changed skill IDs and changed files.
4. Gather selected bundle roots from normalized manager config in the application use case and
   direct wizard flow, then include semantic data in newly persisted update plans.
5. Extend the update plan schema additively without rewriting old schema-v3 artifacts or changing
   confirmation/fingerprint behavior.
6. Render skill/bundle deltas, major-risk warnings, and affected bundles in both TUI update
   previews; machine JSON receives the same plan payload automatically.
7. Add focused unit/application/TUI/CLI coverage, update authoritative docs/checklists, then run
   the repository-wide verification gate.

## Data, API, or Contract Changes

- `SkillpackUpdatePreview` gains deterministic `skillDeltas`, `bundleDeltas`, and
  `affectedBundles` arrays.
- Newly created `SkillpackUpdatePlanPayload` values expose the same structured arrays. Their Zod
  fields are optional for backward readability of existing plan schema v3 artifacts.
- No config, manifest, lock, request, registry, envelope, or plan schema version changes.
- No update apply semantics change: candidate activation still requires a persisted plan, exact
  confirmation token, and fresh state fingerprint.

## Testing Strategy

- Pure comparison: added/removed, same/patch/minor/major, prerelease, legacy unknown, bundle
  membership/metadata changes, and deterministic reordered inputs.
- Impact analysis: unrelated changes, direct selected-bundle change, member/dependency change,
  removed member, and major breaking risk.
- Git/application: active/candidate immutable reads, preserved changed files, selected roots from
  normalized config, payload persistence, exact apply gate, and no active-link movement.
- TUI: both preview surfaces render versions, unknown legacy state, affected bundles, and major
  risk without enabling implicit apply.
- Machine: JSON update-preview exposes the same structured plan fields deterministically.

## Verification Commands

```sh
pnpm vitest run packages/core/src/versioning/revisionComparison.test.ts packages/core/src/git/skillpackSetup.test.ts
pnpm vitest run packages/core/src/application/skillpack.test.ts packages/core/src/application/plans/planSchema.test.ts
pnpm vitest run packages/tui/src/screens/SkillpackSetupScreen.test.tsx packages/tui/src/screens/WizardScreen.test.tsx
pnpm vitest run packages/cli/src/cli/runCli.test.ts packages/cli/src/cli/golden.test.ts
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## Documentation Updates

- Document semantic update comparison and adapter equivalence in `architecture.md` and
  `docs/agent-native-architecture.md`.
- Document machine update-preview fields and the non-approval meaning of breaking risk in
  `docs/agent-interface.md`.
- Mark `CSM-BND-035` through `CSM-BND-037` complete only after verification.
- Record verification results and safe deviations here before commit.

## Risks and Stop Conditions

- Stop if comparison requires mutating either active or candidate snapshot.
- Stop if a semantic classification would automatically reject, approve, or activate an update.
- Stop if adapter code would need to recompute versions, bundle membership, or impact reasons.
- Stop if compatibility requires changing an existing plan artifact's digest interpretation.
- Do not add Phase 9 version-discipline validation or Phase 10 fixture/docs completion work.

## Rollback Notes

Revert the Phase 8 commit. Existing update plans and activation behavior remain valid; update
previews return to changed-file/skill-ID summaries without any manager-state or skillpack data
migration.

## Verification Result

- Focused Phase 8 verification passed: 10 test files, 100 tests.
- Full regression suite passed: 48 test files, 451 tests.
- `pnpm typecheck` passed.
- `pnpm build` passed.
- `git diff --check` passed.
- Self-review refinement: dependency-graph membership changes now report explicit
  `effective-skill-added` / `effective-skill-removed` reasons even when the affected helper's
  registry entity is otherwise unchanged.
- No skillpack checkout, revision snapshot, or active `current` link was mutated.

## Commit Message Draft

```text
✨ feat(core): add semantic update intelligence
```
