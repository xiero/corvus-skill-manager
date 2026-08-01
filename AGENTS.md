# Corvus Skill Manager Agent Rules

These rules are authoritative for implementation work in this repository.

## Project Direction

- Corvus Skill Manager is a TUI-first project. `corvus-skills` with no arguments must always
  launch the Ink TUI.
- Do not implement a CLI-only MVP. The Ink TUI is the human interface and is never replaced by
  the machine CLI.
- The CLI binary is a dual-mode entrypoint: the Ink TUI for humans, and a deterministic machine
  JSON command interface for coding agents. It may own transport concerns only — argv parsing,
  request-document reading, protocol serialization, and exit-code mapping — and must never grow
  business logic. Workflow logic belongs in the shared application layer
  (`packages/core/src/application/`), which both the TUI and the machine CLI call.
- Do not embed an LLM, require an AI API key, or make a semantic choice invisibly. The calling
  agent interprets intent; Corvus executes deterministic operations.
- Do not add an MCP adapter; keep the application layer as the seam for a later one.
- Use TypeScript, Node.js, React Ink, Zod, and Vitest.
- Prefer pure functions in core modules.
- Do not add Express or a backend.
- Gemini CLI is supported through Agent Skills directory links.

## Skillpack Repository Boundary

- The manager must never edit, format, generate into, commit, push, pull, reset, repair, or otherwise mutate an active skillpack repository checkout.
- Initial clone is allowed only when the active `current` path does not exist yet.
- Remote change detection must be read-only, for example by comparing the active commit with `git ls-remote`.
- Approved collection updates must use immutable revision snapshots, not mutable `git pull`.
- The required local layout is:
  - `~/.agents/skillpacks/<skillpack-id>/revisions/<commit>/repo`
  - `~/.agents/skillpacks/<skillpack-id>/current -> revisions/<active-commit>/repo`
- A new revision may be cloned only into a previously absent `revisions/<commit>/repo` snapshot.
- The `current` link may be switched only after a preview and an explicit approval: `a` in the TUI, or a matching `--confirm` plan token in the machine CLI.
- If an active checkout or revision already exists, inspect and report its state; do not repair, update, pull, re-clone over it, format, or write into it.

## Manager State And Writes

- All mutable manager metadata state must live under `~/.agents/corvus-skill-manager`.
- The manager may write only:
  - its own config, lock, manifest, cache, and log files under `~/.agents/corvus-skill-manager`
  - immutable skillpack revision snapshots and the manager-owned `current` link under `~/.agents/skillpacks/<skillpack-id>`
  - confirmed manager-owned symlinks or junctions inside configured agent target directories
- Do not overwrite unmanaged files or directories.
- Disable and remove operations may remove only manifest-owned links.
- Keep filesystem side effects isolated in a small, test-covered core layer.

## Implementation Notes

- The core should make write-safety explicit and easy to test.
- Prefer planning operations before applying them.
- Apply operations should be deterministic, auditable, and covered by Vitest.
- Any path handling that touches the skillpack or agent targets must reject traversal and unmanaged overwrite cases.
- Every write-capable machine command must be plan-then-apply: a persisted, digest-identified
  plan artifact plus an exact confirmation token, revalidated against a state fingerprint
  immediately before mutating. `--json` is never implicit authorization.
- Read-only commands must not mutate state at all, including creating a default config.
- In JSON mode, stdout carries exactly one JSON document; diagnostics go to stderr only.

## Done Criteria

- `pnpm typecheck` passes.
- `pnpm test` passes.
- Relevant docs are updated.
- The final report states whether the skillpack repo was touched. Expected answer is: no mutable touch; only an initial revision clone or approved new revision snapshot/current-link switch when explicitly requested.
