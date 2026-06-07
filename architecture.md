# Corvus Skill Manager Architecture

Corvus Skill Manager is a TUI-first TypeScript application. The CLI package is intentionally thin: it starts the Ink TUI and does not provide a separate CLI workflow for setup, install, update, or apply.

## Layers

1. **CLI package (`packages/cli`)**
   - Owns the runnable `corvus-skills` binary.
   - Boots the Ink TUI.
   - Must not grow independent business logic or a CLI-only MVP path.

2. **TUI package (`packages/tui`)**
   - Owns user navigation, guided flow orchestration, previews, and confirmations.
   - Starts in the Guided Flow wizard by default.
   - Keeps Home, Status, Doctor, Help, and manual advanced setup/configuration screens available.
   - May call write-capable core APIs only after rendering the relevant preview and receiving explicit user confirmation.

3. **Core package (`packages/core`)**
   - Owns pure planning logic, schema validation, path safety, git inspection/setup helpers, discovery, manifest handling, lock handling, and link application.
   - Should remain testable without Ink.
   - Filesystem side effects must stay isolated in small modules with explicit inputs and deterministic outcomes.

## State And Writes

All mutable manager metadata lives under:

```text
~/.agents/corvus-skill-manager
```

The manager may write only:

- its own config, lock, manifest, cache, and log files under `~/.agents/corvus-skill-manager`
- immutable skillpack revision snapshots and the manager-owned `current` link under `~/.agents/skillpacks/<skillpack-id>`
- confirmed manager-owned symlinks or junctions inside configured agent target directories

The manager must not overwrite unmanaged files or directories. Disable and remove operations may remove only manifest-owned links.

## Skillpack Revision Model

The required local layout is:

```text
~/.agents/skillpacks/<skillpack-id>/
  revisions/
    <commit>/
      repo/
  current -> revisions/<active-commit>/repo
```

Initial clone is allowed only when the active `current` path does not exist. Existing active checkouts and existing revisions are inspected and reported; they are not repaired, updated, formatted, reset, re-cloned over, committed, pulled, or pushed.

Remote change detection is read-only and compares the active commit with `git ls-remote`. Approved updates create or reuse an immutable revision snapshot under `revisions/<commit>/repo`, then switch the manager-owned `current` link only after the TUI shows a preview and the user approves activation.

## Link Planning And Apply

Agent and skill selections are draft TUI state until saved. Link creation/removal is always planned first with `generateLinkPlan`.

The dry-run plan must show:

- create-link and remove-link operations
- conflicts for unmanaged target paths
- warnings for missing targets, unknown skills, unsupported agents, or already-present managed links

`applyLinkPlan` may run only after final confirmation. It creates or removes manager-owned links, updates the manifest, and skips unsafe targets instead of overwriting unmanaged paths.

## Agent Support

Supported MVP agents can receive linked skills. Custom agents require a target path. Gemini CLI uses Agent Skills directory links under `~/.gemini/skills`; the manager does not generate Gemini `.toml` command wrappers.

## Development Rules

- Prefer pure functions in core modules.
- Keep path handling explicit and reject traversal or unmanaged overwrite cases.
- Do not add Express or a backend.
- Do not add write behavior to read-only views such as Status, Doctor, discovery, or Help.
- Verification for implementation work is `pnpm typecheck` and `pnpm test`.
