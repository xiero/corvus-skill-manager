Timestamp: 2026-08-24T17:49:36Z
Version: v1.0.0

# Implementation Plan: Freeze the Registry v3 Bundles and Versioning Contract

## Context

`CSM-BND-001` freezes the architecture language and normative examples that all later Registry
v3, bundle, versioning, selection, adapter, and update-intelligence tasks will implement. This
task is deliberately documentation-only so later runtime changes can reference one agreed
contract instead of reopening design decisions.

Source spec: `_specs/registry-v3-bundles-and-versioning.md`

## Open Question Status

- Answered: terminology, MVP boundaries, SemVer/commit-lock roles, v1/v2 migration, root/effective
  selection, manifest ownership, and shared TUI/machine safety semantics are frozen by the source
  task and repository invariants.
- Still blocked: none.

## Assumptions

- The untracked `docs/CORVUS_BUNDLES_VERSIONING_IMPLEMENTATION_TASKS.md` supplied as the requested
  source is user-owned input: read it, preserve its bytes, and exclude it from the commit.
- No runtime schema or behavior changes belong to `CSM-BND-001`.
- The contract may name future schema fields and observable semantics without implementing them.
- Registry v3 keeps version constraints on hard `requires` references and bundle members;
  `recommends` and `conflictsWith` preserve their v2 local-ID behavior.

## Critical Files

- `docs/CORVUS_BUNDLES_VERSIONING_IMPLEMENTATION_TASKS.md` — read-only, dependency-ordered source
  task list supplied for this work.
- `_specs/registry-v3-bundles-and-versioning.md` — authoritative implementation-facing contract
  with normative Registry and Config examples.
- `_plans/registry-v3-bundles-and-versioning.md` — SpecUnleashed execution record for the first
  task.
- `architecture.md` — concise architecture-level terminology, boundaries, and link to the full
  contract.

## Implementation Sequence

1. Review `AGENTS.md`, `CLAUDE.md`, architecture/agent-native/skillpack/semantic docs, and current
   registry/config/install/plan schemas and tests.
2. Write the feature spec using the repository's authoritative safety invariants and frozen task
   decisions.
3. Include normative Registry v1/v2/v3 and Manager Config v2/v3 examples in the spec.
4. Add an architecture section that establishes the contract as the source of truth and repeats
   the critical boundaries readers must not violate.
5. Review the documentation diff for contradictions, accidental runtime scope, machine-local
   secrets, and mutable-skillpack implications.
6. Run the existing full typecheck and test suite, then commit only task-scoped files.

## Data, API, or Contract Changes

Documentation contract only. The spec defines future Registry v3, Config v3, bundle, SemVer,
root/effective selection, plan provenance, and migration semantics. No runtime parser, persisted
file, API, protocol, or dependency changes occur in this task.

## Testing Strategy

- Unit tests: no new unit tests; no runtime code changes.
- Component tests: not applicable.
- Integration tests: run the existing repository suite to establish the unchanged baseline.
- E2E/smoke checks: static review of examples and links plus the repository typecheck/test gates.

## Verification Commands

```sh
pnpm typecheck
pnpm test
```

## Documentation Updates

- Add `_specs/registry-v3-bundles-and-versioning.md`.
- Add this matching `_plans/registry-v3-bundles-and-versioning.md` workflow plan.
- Update `architecture.md` with the Registry v3 bundle/selection contract summary.
- Leave the supplied untracked ordered task list unchanged and outside the commit.

## Risks and Stop Conditions

- Stop if an architecture choice conflicts with `AGENTS.md` write, adapter, TUI-first, or
  immutable skillpack rules.
- Stop if the contract requires an unresolved security, destructive migration, public protocol,
  or external-service decision.
- Do not modify runtime code, dependencies, active skillpack checkouts, or files outside the
  repository for this task.

## Rollback Notes

Revert the documentation commit. No runtime state, migration, dependency, manager metadata, or
skillpack snapshot is changed by this task.

## Commit Message Draft

```text
📝 docs: freeze registry v3 bundle architecture contract
```
