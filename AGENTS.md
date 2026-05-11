# Corvus Skill Manager Agent Rules

These rules are authoritative for implementation work in this repository.

## Project Direction

- Corvus Skill Manager is a TUI-first project.
- Do not implement a CLI-only MVP.
- The CLI binary may only be a thin entrypoint that launches the Ink TUI.
- Use TypeScript, Node.js, React Ink, Zod, and Vitest.
- Prefer pure functions in core modules.
- Do not add Express or a backend.
- Gemini is deferred for MVP and must be displayed as unsupported/deferred.

## Skillpack Repository Boundary

- The manager must never edit, format, generate into, commit, push, pull, reset, repair, or otherwise mutate an active skillpack repository checkout.
- Initial clone is allowed only when the active `current` path does not exist yet.
- Remote change detection must be read-only, for example by comparing the active commit with `git ls-remote`.
- Approved collection updates must use immutable revision snapshots, not mutable `git pull`.
- The required local layout is:
  - `~/.agents/skillpacks/<skillpack-id>/revisions/<commit>/repo`
  - `~/.agents/skillpacks/<skillpack-id>/current -> revisions/<active-commit>/repo`
- A new revision may be cloned only into a previously absent `revisions/<commit>/repo` snapshot.
- The `current` link may be switched only after the TUI shows a preview and the user explicitly approves the update.
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

## Done Criteria

- `pnpm typecheck` passes.
- `pnpm test` passes.
- Relevant docs are updated.
- The final report states whether the skillpack repo was touched. Expected answer is: no mutable touch; only an initial revision clone or approved new revision snapshot/current-link switch when explicitly requested.
