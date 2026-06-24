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

## Architecture

TUI-first TypeScript app. Three workspace packages with a strict dependency direction
(cli → tui → core):

- `packages/core` (`@corvus-tools/skill-manager-core`) — all business logic: config/lock/
  manifest schemas + stores, git inspection/setup, skill discovery, link planning + apply,
  status/doctor reports, path safety, self-update check. Must stay pure and testable
  without Ink; filesystem side effects are isolated in small modules with explicit inputs.
  Public API is the curated `packages/core/src/index.ts` barrel.
- `packages/tui` (`@corvus-tools/skill-manager-tui`) — Ink UI: navigation, the Guided Flow
  wizard (default entry), previews, confirmations. Calls write-capable core APIs only after
  rendering a preview and getting explicit user confirmation.
- `packages/cli` (`@corvus-tools/skill-manager`) — the thin `corvus-skills` bin; just boots
  the TUI. Must NOT grow independent business logic or a CLI-only workflow (no
  `update`/`install`/`apply` subcommands).

Tests are colocated as `*.test.ts(x)` next to the code under test.

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

- Only ever write: manager metadata under `~/.agents/corvus-skill-manager`, immutable
  skillpack revision snapshots + the manager-owned `current` link, and confirmed
  manager-owned symlinks/junctions inside configured agent target dirs.
- Never overwrite or modify unmanaged files, dirs, or symlinks; skip unsafe targets.
- Never pull/reset/repair/format/commit/push/edit the active skillpack checkout.
- Disable/remove may remove only manifest-owned links.
- Do not add write behavior to read-only views (Status, Doctor, discovery, Help).
- Keep path handling explicit; reject traversal and unmanaged-overwrite cases
  (`assertPathInside` / `isPathInside` in `packages/core/src/paths.ts`).
- Do not add Express or a backend. Gemini CLI uses Agent Skills directory links; do not
  generate `.toml` command wrappers.

## Publishing

Three public packages published in dependency order: core → tui → cli, after a clean
build/typecheck/test. See `docs/npm-publishing.md`.

## Reference docs

`architecture.md`, `docs/safety-model.md`, `docs/skillpack-contract.md`,
`docs/managed-manifest.md`, `docs/npm-publishing.md`.
