Timestamp: 2026-08-25T04:56:16Z
Version: v1.6.0

# Implementation Plan: Registry v3 Bundles and Versioning — Phase 6

## Context

Phases 1–5 established Registry v3 bundle discovery, Config v3 roots, deterministic effective
resolution, and bundle-aware plan/apply/verify behavior. Phase 6 implements `CSM-BND-029` and
`CSM-BND-030`: complete machine capability advertisement, deterministic bundle list/search/inspect
commands, a dedicated bundle-selection flag for install planning, and bundle-specific protocol
errors while keeping the CLI transport-only.

Source spec: `_specs/registry-v3-bundles-and-versioning.md`

## Open Question Status

- Answered: machine envelope schema v1 remains current because commands and error codes are
  additive; install request v2 and persisted plan v3 already carry bundle semantics.
- Answered: bundle discovery uses a top-level `bundles` command family to preserve the normative
  distinction between bundles and linkable skills.
- Answered: `install plan --bundle <id>` is repeatable and may be combined with `--skill`; both
  normalize through the existing request-v2 builder used by request documents.
- Answered: `--all-compatible` remains exclusive with both explicit skill and bundle flags.
- Answered: machine errors distinguish an unknown bundle, an agent-incompatible bundle, an
  invalid/missing bundle member, and a version mismatch; structured details retain exact refs.
- Still blocked: none.

## Assumptions

- Bundle list/search filters accept repeated `--agent`, mirroring the skill catalog while
  evaluating whole-bundle compatibility.
- Bundle list accepts the same bounded optional `--limit` as bundle search because the shared
  use case already implements it.
- Bundle inspect accepts one or more exact qualified or default-pack bundle refs and has no
  content flag because bundles have metadata but no `SKILL.md`.
- Invalid Registry v3 relationship findings remain visible through validation; bundle resolver
  failures are mapped to stable protocol errors when they block an install plan.
- Phase 7 remains responsible for the TUI bundle-selection experience.

## Critical Files

- `packages/core/src/application/protocol/envelope.ts` — add bundle command identities.
- `packages/core/src/application/protocol/errors.ts` — add stable bundle compatibility/member/
  version error codes and categories.
- `packages/core/src/application/useCases/capabilitiesUseCase.ts` — advertise discovery commands,
  bundle install flags, request schema features, error semantics, and bundle search limits.
- `packages/core/src/application/install/installPlanner.ts` — map bundle-caused incompatibility
  and resolver mismatches to bundle-specific errors.
- `packages/cli/src/cli/createProgram.ts` and `executeCommand.ts` — parse and route bundle commands
  and the repeatable `--bundle` transport flag only.
- Core protocol/application and CLI integration/golden/help tests.
- `architecture.md`, agent interface/protocol docs, examples, and the task checklist.

## Implementation Sequence

1. Add bundle command identities and stable bundle error codes to the protocol contract.
2. Extend capabilities with `bundles list`, `bundles search`, and `bundles inspect`, including
   filters, limits, install `--bundle`, schema feature metadata, and bundle-oriented next actions.
3. Register the bundle CLI command family and route inputs directly to existing application use
   cases, preserving exact qualified refs and canonical JSON envelopes.
4. Extend install flag transport so mixed `--skill`/`--bundle` selections normalize to request v2;
   reject empty explicit flags and `--all-compatible` combinations through the shared schema.
5. Map incompatible bundle-derived selections and resolver member/version failures to stable,
   structured machine errors without duplicating resolution in the adapter.
6. Add protocol, capabilities, CLI integration, golden, help, exit-code, deterministic output,
   and read-only no-write coverage, including plan/apply/verify from a bundle flag.
7. Update authoritative machine-interface documentation, validated examples, and mark
   `CSM-BND-029`/`CSM-BND-030` complete after verification.

## Data, API, or Contract Changes

- Machine command identities add `bundles.list`, `bundles.search`, and `bundles.inspect`.
- Stable error taxonomy adds bundle-incompatible, bundle-member-mismatch, and version-mismatch
  codes; `BUNDLE_NOT_FOUND` remains the unknown-reference code.
- Capabilities advertise bundle discovery, request-v2 bundle roots, bundle/member/version
  semantics, and the repeatable `install plan --bundle <id>` option.
- CLI install flags emit request v2 `selectedBundles` alongside `selectedSkills`.
- Machine envelope remains schema v1; install request remains v2; persisted plan remains v3.

## Testing Strategy

- Protocol: command schema includes all bundle commands; every new error has one stable category
  and exit code; envelope serialization remains canonical.
- Capabilities: a fresh-machine response teaches bundle discovery and install planning without
  reading external docs or mutating manager state.
- Discovery CLI: v3 fixture list/search/inspect shapes, qualified refs, agent filtering, limits,
  unknown refs/agents, deterministic repeat output, and exact one-document stdout.
- Install CLI: bundle-only and mixed flags, unknown and incompatible bundles, explicit/all
  exclusivity, persisted plan, exact confirmation, apply, and verify.
- Regression: every advertised command is registered and every existing skill-only/request-file
  flow remains unchanged.

## Verification Commands

```sh
pnpm vitest run packages/core/src/application/protocol/protocol.test.ts packages/core/src/application/application.test.ts packages/core/src/application/install.test.ts
pnpm vitest run packages/cli/src/cli/runCli.test.ts packages/cli/src/cli/golden.test.ts packages/cli/src/cli/help.test.ts
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## Documentation Updates

- Update `architecture.md`, `docs/agent-native-architecture.md`, `docs/agent-protocol-v1.md`,
  `docs/agent-interface.md`, and `docs/examples/agent-install-requests.json` for the live bundle
  machine commands and flag workflow.
- Mark `CSM-BND-029` and `CSM-BND-030` complete only after all checks pass.
- Record verification results and any safe deviation here before commit.

## Risks and Stop Conditions

- Stop if adding a flag would bypass request-v2 parsing, persisted plan creation, exact
  confirmation, or state-fingerprint revalidation.
- Stop if bundle discovery requires adapter-owned filtering, scoring, compatibility, or
  resolution logic.
- Stop if an error-code change would reinterpret an existing persisted artifact rather than add
  a clearer response for current behavior.
- Do not add Phase 7 TUI selection UI or Phase 8 semantic update comparison.
- Do not mutate any active skillpack checkout, existing revision snapshot, or non-test manager
  state.

## Rollback Notes

Revert the Phase 6 commit. Existing request-v2 documents and plan-v3 artifacts remain valid;
agents would temporarily need request documents for bundle roots because the dedicated commands
and flag would no longer be registered. No manager or skillpack data migration is required.

## Verification Result

- `pnpm vitest run packages/core/src/application/protocol/protocol.test.ts packages/core/src/application/application.test.ts packages/core/src/application/install.test.ts packages/cli/src/cli/runCli.test.ts packages/cli/src/cli/golden.test.ts packages/cli/src/cli/help.test.ts` — passed.
- `pnpm typecheck` — passed.
- `pnpm test` — passed: 44 test files, 424 tests.
- `pnpm build` — passed.
- `git diff --check` — passed.
- Safe plan refinement: selected bundle relationship errors are mapped before link planning so
  member and version mismatch codes are not merely advertised; they are emitted with structured
  Registry v3 details when the selected bundle is invalid.

## Commit Message Draft

```text
✨ feat(cli): expose bundle machine workflows
```
