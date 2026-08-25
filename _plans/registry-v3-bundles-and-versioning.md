Timestamp: 2026-08-25T06:33:15Z
Version: v1.10.0

# Implementation Plan: Registry v3 Bundles and Versioning — Phase 10

## Context

Phases 1–9 implemented the frozen Registry v3 contract, bundle discovery and selection,
bundle-aware plan/apply/verify, TUI and machine workflows, semantic update intelligence, and
maintainer version-discipline tooling. Phase 10 closes tasks `CSM-BND-040` through
`CSM-BND-042`: align every public contract, prove the final safety/determinism matrix, record the
implementation mirror, and prepare the coherent `0.5.0` package release.

Source spec: `_specs/registry-v3-bundles-and-versioning.md`

## Open Question Status

- Answered: this is Phase 10. The task list's repeated `# 9` heading is a numbering typo because
  maintainer tooling already occupied Phase 9.
- Answered: Registry v3 is the current authoring contract. Registry v1/v2 remain supported legacy
  inputs and must not be described as removed or rewritten.
- Answered: the publishable core, TUI, and CLI packages advance together from `0.4.0` to `0.5.0`.
  The root workspace package remains private at `0.2.0`, matching the established release policy.
- Answered: existing focused tests already cover read-only behavior, stale bundle semantics,
  unmanaged targets, manifest ownership, config/registry compatibility, and platform link
  decisions. This phase adds the missing bundle-specific confirmation/tamper and reordered-root
  digest regression.
- Still blocked: none.

## Assumptions

- Registry, config, install request, persisted plan, and machine envelope versions remain
  independent: Registry v3, Config v3, request v2, plan v3, and envelope v1.
- Package `0.5.0` is a feature release, not a declaration that Registry v1/v2 inputs are breaking.
- Release preparation does not publish, tag, or push and does not mutate any skillpack checkout.
- A final no-commit working tree is acceptable: it started clean and will contain only the
  reviewed Phase 10 changes.

## Critical Files

- `README.md`, `architecture.md`, `docs/skillpack-contract.md`, and
  `docs/semantic-registry.md` — public product, architecture, and Registry v3 contracts.
- `docs/agent-interface.md`, `docs/agent-protocol-v1.md`, and
  `docs/examples/agent-install-requests.json` — coding-agent bundle workflow and versioned
  protocol examples.
- `docs/skillpack-registry-migration.md` — v1/v2-to-v3 migration, SemVer, bundle, validation, and
  version-discipline guidance.
- `CHANGELOG.md` and `docs/npm-publishing.md` — release summary and coherent package policy.
- `packages/core/src/application/documentation.test.ts` and focused safety tests — executable
  documentation and final regression matrix.
- `_specs/registry-v3-bundles-and-versioning.md` and
  `docs/CORVUS_BUNDLES_VERSIONING_IMPLEMENTATION_TASKS.md` — final implementation mirror.
- `packages/{core,tui,cli}/package.json` — coherent public package release version.

## Implementation Sequence

1. Replace stale v2-only top-level language with Registry v3 plus explicit legacy compatibility,
   and expose bundle discovery/install/removal and the root/effective selection model.
2. Expand the migration guide from v1-to-v2-only into a complete v1/v2-to-v3 maintainer path,
   including canonical SemVer, versioned dependency/member ranges, immutable commit locking,
   bundle boundaries, validation, and version-discipline CI.
3. Add documentation contract assertions for current schema-version boundaries, bundle commands,
   immutable skillpacks, and the no-workflow-execution boundary.
4. Convert the confirmation/tamper regressions to bundle plans and add a deterministic mixed-root
   plan-id/digest test across reordered skills, bundles, and agents.
5. Run focused documentation/application tests, then the full typecheck, test, and build gates.
6. After those gates pass, bump all three public packages to `0.5.0`, update release notes and the
   implementation mirror, then rerun the full gates.
7. Mark `CSM-BND-040` through `CSM-BND-042` and the Phase 10 acceptance criteria complete only
   after verification; leave the result unstaged and commit-ready.

## Data, API, or Contract Changes

- No new runtime API or protocol behavior is introduced in Phase 10.
- Public docs explicitly identify Registry v3, Config v3, install request v2, persisted plan v3,
  and machine envelope v1 as separate current contracts.
- Public package versions become `0.5.0` together; workspace dependencies remain `workspace:^`.
- Registry v1/v2 and Config v1/v2 reads remain backward compatible and side-effect free.

## Testing Strategy

- Documentation: every documented `corvus-skills` command/flag remains registered; request
  examples parse; every protocol error is documented; current schema boundaries and safety
  statements are asserted.
- Confirmation: a bundle plan cannot apply without the exact token and a tampered bundle plan
  fails digest validation.
- Determinism: equivalent mixed skill/bundle roots and agent order produce identical normalized
  requests, plan payloads, digests, and plan IDs.
- Existing matrix: read-only tree snapshots, stale bundle fingerprints, unmanaged conflicts,
  manager-owned removal, v1/v2 config migration, v1/v2/v3 fixtures, POSIX symlinks, and injected
  Windows junction choices remain green.
- Full repository: `pnpm typecheck`, `pnpm test`, `pnpm build`, and `git diff --check`.

## Verification Commands

```sh
pnpm vitest run packages/core/src/application/documentation.test.ts
pnpm vitest run packages/core/src/application/install.test.ts packages/core/src/links/applyEngine.test.ts packages/core/src/links/platformLinks.test.ts
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## Documentation Updates

- Present Registry v3 bundles and versions in README and architecture without hiding legacy
  support.
- Keep the complete Registry v3 JSON example and add direct migration links in the skillpack
  contract and semantic-registry guide.
- Preserve the implemented bundle install examples and schema-version distinctions in the agent
  interface/protocol docs.
- Record the whole feature series under a new Registry v3 changelog section and note the
  backward-compatible input migrations plus new request/plan schema versions.
- Add final implementation status, decisions, deviations, verification, and package version to
  the frozen feature spec.

## Risks and Stop Conditions

- Stop if docs imply SemVer replaces the immutable Git commit/revision lock.
- Stop if any example suggests bundles execute workflows, nested/cross-pack membership works, or
  recommendations install automatically.
- Stop if release work requires publishing, tagging, pushing, or touching an active skillpack.
- Stop if a regression reveals adapter-owned resolution logic, a no-confirmation mutation path,
  or an unmanaged-target overwrite.

## Rollback Notes

Revert the Phase 10 documentation/test/version commit. No data migration or skillpack rollback is
required because this phase adds no runtime mutation and performs no publish/tag/push action.

## Verification Result

- Focused Phase 10 verification passed: 4 files, 74 tests (documentation, install application,
  apply engine, and platform link decisions).
- Documentation contract verification passed: 10 tests, including every documented command/flag,
  error-code coverage, schema boundaries, immutable snapshots, and non-executable bundles.
- The full release gate passed both before and after the public package bump: 50 files, 466 tests.
- `pnpm typecheck` passed before and after the version bump.
- `pnpm build` passed before and after the version bump.
- `pnpm --filter @corvus-tools/skill-manager pack --dry-run` passed for `0.5.0`; the package
  contains runtime declarations/maps/JavaScript plus its README and manifest, with no compiled
  test artifacts and no tarball left in the working tree.
- Public package versions are coherent at `0.5.0`; the established private root version remains
  `0.2.0`.
- `git diff --check` passed after the final implementation/task mirror update.
- No manager state or active/existing skillpack checkout/revision was mutated. All filesystem
  tests used temporary harness fixtures; no publish, tag, push, stage, or commit occurred.

## Commit Message Draft

```text
📝 docs: finalize registry v3 release readiness
```
