# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This is a pnpm workspace monorepo. Run all commands from the repo root.

- `pnpm install` — install workspace deps
- `pnpm dev` — boot the Ink TUI from source (`tsx` runs `packages/cli/src/index.ts`)
- `pnpm build` — TypeScript project-references build (`tsc -b`)
- `pnpm typecheck` — `tsc -b --pretty false`
- `pnpm test` — run all tests (`vitest run`)
- Single test file: `pnpm vitest run packages/core/src/links/linkPlan.test.ts`
- Single test by name: `pnpm vitest run -t "partial name"`

There is no linter; verification for implementation work is `pnpm typecheck` and `pnpm test`.
CI runs the same install → build → typecheck → test path.

Run the built binary locally: `pnpm --filter @corvus-tools/skill-manager exec corvus-skills`
Machine mode: `pnpm --filter @corvus-tools/skill-manager exec corvus-skills capabilities --json`

## Architecture

TUI-first TypeScript app with two adapters over one shared application layer. Three workspace
packages with a strict dependency direction (cli → tui → core):

- `packages/core` (`@corvus-tools/skill-manager-core`) — all business logic: config/lock/
  manifest schemas + stores, git inspection/setup, skill discovery, link planning + apply,
  status/doctor reports, path safety, self-update check. Must stay pure and testable
  without Ink; filesystem side effects are isolated in small modules with explicit inputs.
  Public API is the curated `packages/core/src/index.ts` barrel.
  - `packages/core/src/application/` — the shared application layer: the versioned machine
    protocol (`protocol/`), persisted plan artifacts (`plans/`), the install request contract
    and planner (`install/`), the catalog/search scorer (`skills/`), and the high-level use
    cases (`useCases/`) exposed through `CorvusApplication` / `createCorvusApplication`.
    Contains no command-line parsing and returns protocol result types, never rendered strings.
- `packages/tui` (`@corvus-tools/skill-manager-tui`) — Ink UI: navigation, the Guided Flow
  wizard (default entry), previews, confirmations. Receives a `CorvusApplication` through
  `CorvusApplicationContext` and calls use cases rather than orchestrating core primitives.
  Triggers write-capable operations only after rendering a preview and getting explicit user
  confirmation. Maps protocol error codes to human sentences; never renders raw JSON.
- `packages/cli` (`@corvus-tools/skill-manager`) — the `corvus-skills` bin. Dual-mode: no
  arguments launches the TUI (Ink is imported dynamically, so machine commands never load it);
  a subcommand or `--help` runs the machine JSON CLI. May own transport concerns only (argv
  parsing, request-document reading, protocol serialization, exit-code mapping) and must NOT
  grow business logic.

Tests are colocated as `*.test.ts(x)` next to the code under test. Shared test fixtures and
harnesses live in `test/support/` at the repo root.

## Core domain flow

1. Config/lock/manifest live under `~/.agents/corvus-skill-manager`.
2. Skillpack uses an immutable revision-snapshot model:
   `~/.agents/skillpacks/<id>/revisions/<commit>/repo` with a manager-owned
   `current -> revisions/<active-commit>/repo` link. Initial clone is allowed only when
   `current` is absent.
3. Remote update detection is read-only (`git ls-remote`); activating a new revision
   requires preview + explicit approval in the TUI.
4. Selections are draft TUI state until saved. `generateLinkPlan` (core) produces a
   deterministic dry-run plan (create/remove ops, conflicts, warnings); `applyLinkPlan`
   runs only after final confirmation.

## Safety invariants (do not break)

These hold identically for the TUI and the machine CLI. There is no force flag or bypass.

- Only ever write: manager metadata under `~/.agents/corvus-skill-manager` (including
  `plans/`), immutable skillpack revision snapshots + the manager-owned `current` link, and
  confirmed manager-owned symlinks/junctions inside configured agent target dirs.
- Never overwrite or modify unmanaged files, dirs, or symlinks; skip unsafe targets.
- Never pull/reset/repair/format/commit/push/edit the active skillpack checkout.
- Never write to a skillpack's `registry.json` or skill files.
- Disable/remove may remove only manifest-owned links.
- Do not add write behavior to read-only views or read-only machine commands (Status, Doctor,
  `agents list`, `skillpack status`, `skillpack update-check`, `skills *`, `install verify`,
  discovery, Help) — including creating a default config as a side effect.
- Every write-capable machine command is plan-then-apply: a persisted digest-identified plan
  plus an exact `--confirm` token, revalidated against a state fingerprint immediately before
  mutating. `--json` is never implicit authorization; machine mode never prompts.
- In JSON mode, stdout carries exactly one JSON document with no ANSI; diagnostics go to stderr.
- Keep path handling explicit; reject traversal and unmanaged-overwrite cases
  (`assertPathInside` / `isPathInside` in `packages/core/src/paths.ts`). Plan ids must match the
  manager's `<kind>-<digest>` shape before being used as a path.
- Do not add Express or a backend. Gemini CLI uses Agent Skills directory links; do not
  generate `.toml` command wrappers.
- Do not embed an LLM or make an invisible semantic choice; do not add an MCP adapter.

## Publishing

Three public packages published in dependency order: core → tui → cli, after a clean
build/typecheck/test. See `docs/npm-publishing.md`.

## Reference docs

`architecture.md`, `docs/agent-native-architecture.md`, `docs/agent-interface.md`,
`docs/agent-protocol-v1.md`, `docs/semantic-registry.md`, `docs/safety-model.md`,
`docs/skillpack-contract.md`, `docs/skillpack-registry-migration.md`,
`docs/managed-manifest.md`, `docs/npm-publishing.md`.
