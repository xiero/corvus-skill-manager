# Corvus Skill Manager Architecture

Corvus Skill Manager is a TUI-first TypeScript application with two adapters over one shared
application layer: the Ink TUI for humans and a deterministic machine JSON CLI for coding
agents. Running `corvus-skills` with no arguments still launches the TUI.

See `docs/agent-native-architecture.md` for the full adapter/application/domain boundary and
the machine-interface invariants.

## Layers

1. **CLI package (`packages/cli`)**
   - Owns the runnable `corvus-skills` binary.
   - Boots the Ink TUI when invoked with no arguments.
   - Routes subcommands and `--help` to the machine CLI without initializing Ink.
   - May own transport concerns only: argv parsing, request-document reading, protocol
     serialization, and exit-code mapping.
   - Must not grow independent business logic. Workflow logic belongs in the application layer.

2. **TUI package (`packages/tui`)**
   - Owns user navigation, guided flow orchestration, previews, and confirmations.
   - Starts in the Guided Flow wizard by default.
   - Keeps Home, Status, Doctor, Help, and manual advanced setup/configuration screens available.
   - Calls the shared application use cases rather than reproducing workflow logic, and may
     trigger write-capable operations only after rendering the relevant preview and receiving
     explicit user confirmation.

3. **Core package (`packages/core`)**
   - Owns pure planning logic, schema validation, path safety, git inspection/setup helpers, discovery, manifest handling, lock handling, and link application.
   - Also owns the shared application layer (`src/application/`): the versioned machine
     protocol and the high-level use cases that both the TUI and the machine CLI call. TUI and
     machine CLI invoke the same use cases, so setup, discovery, planning, apply, and
     verification have exactly one implementation.
   - Should remain testable without Ink and without spawning the CLI.
   - Must contain no command-line parsing.
   - Filesystem side effects must stay isolated in small modules with explicit inputs and deterministic outcomes.

## State And Writes

These are invariants of the manager, not conventions of any one interface. They hold
identically for the TUI and the machine CLI, and are enforced in the domain and application
layers rather than by a screen or a prompt.

All mutable manager metadata lives under:

```text
~/.agents/corvus-skill-manager
```

The manager may write only:

- its own config, lock, manifest, plan, cache, and log files under `~/.agents/corvus-skill-manager`
- immutable skillpack revision snapshots and the manager-owned `current` link under `~/.agents/skillpacks/<skillpack-id>`
- confirmed manager-owned symlinks or junctions inside configured agent target directories

The manager must never overwrite or modify an unmanaged file, directory, symlink, or junction;
unsafe targets are skipped and reported, never replaced. Disable and remove operations may
remove only manifest-owned links. Read-only commands must not mutate state at all, including
creating a default config as a side effect. `--json` is never implicit authorization: every
mutation requires a write command plus an exact confirmation token matching a persisted plan.

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

For the machine CLI, plan-then-apply is additionally made explicit and durable: `install plan`
persists a digest-identified plan artifact plus a fingerprint of the state it was computed
against, and `install apply --plan-id <id> --confirm <id>` revalidates schema, digest,
confirmation, and fingerprint before executing only the operations contained in that plan.
Stale, tampered, or unconfirmed plans are rejected with stable machine error codes.

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
- Do not add write behavior to read-only views such as Status, Doctor, discovery, or Help,
  or to read-only machine commands.
- Do not embed an LLM, require an AI API key, or make an invisible semantic choice. Semantic
  interpretation belongs to the calling agent; Corvus executes deterministic operations.
- Do not add an MCP adapter in this pass; keep the application layer as the seam for one later.
- Verification for implementation work is `pnpm typecheck` and `pnpm test`.
