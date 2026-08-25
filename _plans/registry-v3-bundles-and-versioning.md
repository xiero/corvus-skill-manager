Timestamp: 2026-08-25T06:07:02Z
Version: v1.9.0

# Implementation Plan: Registry v3 Bundles and Versioning — Phase 9

## Context

Phases 1–8 established Registry v3, bundle-aware selection, and semantic update intelligence.
Phase 9 implements maintainer tooling tasks `CSM-BND-038` and `CSM-BND-039`: a read-only,
CI-suitable version-discipline check between two local Registry v3 revisions, plus representative
shared v1/v2/v3 fixtures that exercise the complete bundle relationship model.

Source spec: `_specs/registry-v3-bundles-and-versioning.md`

## Open Question Status

- Answered: expose a dedicated machine command, `skills check-version-discipline`, because this
  is maintainer/CI tooling rather than an end-user mutation workflow.
- Answered: require explicit `--base <path>` and `--candidate <path>` checkout roots. The check
  reads those roots directly and does not require or create manager config.
- Answered: default CI severity is `error`; `--severity warning` returns the same structured
  findings as warnings with a successful exit for advisory adoption.
- Answered: a violation means an existing skill's complete directory content or normalized
  registry metadata changed while SemVer precedence stayed the same, or an existing bundle's
  metadata/membership changed while SemVer precedence stayed the same.
- Answered: added/removed entities are reported as deltas but do not require a bump check, and
  Corvus never recommends patch/minor/major.
- Still blocked: none.

## Assumptions

- Both inputs must be valid Registry v3 checkout roots. Legacy v1/v2 fixtures remain supported by
  normal discovery, but version discipline cannot be proven when declared versions are absent.
- Build-metadata-only version changes have identical SemVer precedence and therefore do not
  satisfy the bump check.
- Skill content includes every regular file and symlink entry below the registered skill
  directory, compared deterministically without following symlinks.
- The existing Phase 8 semantic comparison remains the single owner of entity signature and
  version-change classification.
- No runtime dependency, plan artifact, state fingerprint, or protocol-envelope version change
  is required.

## Critical Files

- `packages/core/src/versioning/revisionComparison.ts` — expose version-discipline findings from
  the existing deterministic semantic delta model.
- `packages/core/src/application/useCases/skillsUseCases.ts` — read and validate both revisions,
  fingerprint skill directory content, and produce the read-only application result.
- `packages/core/src/application/CorvusApplication.ts` and
  `packages/core/src/application/createCorvusApplication.ts` — shared use-case surface.
- `packages/core/src/application/protocol/envelope.ts` and
  `packages/core/src/application/useCases/capabilitiesUseCase.ts` — public machine command and
  capability declaration.
- `packages/cli/src/cli/createProgram.ts` and `packages/cli/src/cli/executeCommand.ts` — flags and
  serialization only.
- `test/support/skillpackFixtures.ts` — deterministic v1/v2/v3 fixtures with overlapping bundles,
  transitive dependency, recommendation, conflict, and reusable candidate variants.
- Focused core/application/CLI/golden/multi-skillpack tests and maintainer documentation.

## Implementation Sequence

1. Extend the pure revision comparison model with structured version-discipline issue/report
   types derived only from changed existing skill/bundle deltas whose version classification is
   `same`.
2. Add deterministic read-only skill-directory fingerprints so non-registry files participate in
   the check without following symlinks or mutating either checkout.
3. Implement the shared application use case with explicit base/candidate paths, Registry v3
   validity preconditions, configurable warning/error severity, stable structured findings, and
   no manager-context loading.
4. Register `skills.check-version-discipline` in the protocol, application, capabilities, and CLI
   transport with required base/candidate flags and optional severity.
5. Add a shared Registry v1 fixture; deepen the v3 fixture to cover overlapping bundle members,
   a transitive dependency, a recommendation, and a non-selected conflict while retaining v2.
6. Add pure comparison, application no-write, CLI envelope/exit-code, capability/golden, fixture,
   and multi-skillpack qualification tests.
7. Document the maintainer command and recommended CI policy, mark `CSM-BND-038` and
   `CSM-BND-039` complete after verification, and run the full repository gate.

## Data, API, or Contract Changes

- Machine protocol v1 adds command `skills.check-version-discipline` with CLI spelling
  `skills check-version-discipline`.
- Required inputs are `--base <path>` and `--candidate <path>`; optional
  `--severity <error|warning>` defaults to `error`.
- Output reports `valid`, input paths/registry versions, semantic skill/bundle deltas, and
  deterministic issues with entity kind/id/version. Error severity returns a `VERSION_MISMATCH`
  failure envelope carrying the same report; warning severity returns a success envelope with
  warnings.
- No write-capable contract, persisted plan, config, lock, manifest, or registry schema changes.

## Testing Strategy

- Pure comparison: unchanged content/version passes, changed skill or bundle with unchanged
  version is detected, any precedence-changing version passes, build-metadata-only changes fail,
  and results are deterministic.
- Content fingerprinting: nested regular-file changes are detected; symlinks are compared by
  target and never followed.
- Application: valid Registry v3 pair, invalid/legacy input rejection, warning/error severity,
  unchanged filesystem tree, and no manager-state creation.
- Machine: schema-valid canonical JSON, required flags, configurable exit behavior, capability
  advertisement, and golden output.
- Fixtures: shared v1/v2/v3 construction, overlapping v3 members, transitive dependency,
  recommendation/conflict, and duplicate local IDs qualified across skillpacks.

## Verification Commands

```sh
pnpm vitest run packages/core/src/versioning/revisionComparison.test.ts
pnpm vitest run packages/core/src/application/application.test.ts packages/core/src/application/multiSkillpack.test.ts
pnpm vitest run packages/cli/src/cli/runCli.test.ts packages/cli/src/cli/golden.test.ts packages/cli/src/cli/help.test.ts
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## Documentation Updates

- Add focused version-discipline authoring/CI guidance to `docs/semantic-registry.md`.
- Document the read-only machine command in `docs/agent-interface.md` and
  `docs/agent-protocol-v1.md` without completing the broader Phase 10 public-doc task.
- Mark `CSM-BND-038` and `CSM-BND-039` complete only after all acceptance checks pass.
- Record exact verification results and any safe deviation here before commit.

## Risks and Stop Conditions

- Stop if comparison would need to write, format, repair, clone, or otherwise mutate either
  supplied checkout.
- Stop if the checker would infer or recommend a patch/minor/major bump.
- Stop if CLI transport would need to own directory traversal, version classification, or policy.
- Stop if adding the read-only command would require a plan/confirmation flow or protocol
  envelope version change.
- Do not begin `CSM-BND-040` through `CSM-BND-042` broad documentation/release work.

## Rollback Notes

Revert the Phase 9 commit. The new read-only command disappears and tests return to the earlier
fixtures; no manager state, skillpack checkout, persisted plan, or migration needs rollback.

## Verification Result

- Focused core verification passed: 7 test files, 110 tests.
- Focused CLI verification passed: 3 test files, 47 tests.
- Full regression suite passed: 50 test files, 464 tests.
- `pnpm typecheck` passed.
- `pnpm build` passed.
- `git diff --check` passed.
- Safe refinement from self-review: version text changes are separated from content changes, so
  build-metadata-only changes pass when content is identical but do not satisfy the bump check
  when skill or bundle content actually changed.
- Fixture expectation updates were limited to the new representative member, recommendation,
  conflict, and duplicate-ID coverage required by `CSM-BND-039`.
- No manager state or skillpack checkout/revision snapshot was mutated; all filesystem behavior
  tests used temporary fixtures.

## Commit Message Draft

```text
✨ feat(core): add version discipline checks
```
