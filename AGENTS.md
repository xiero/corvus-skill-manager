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

- The manager must never edit, format, generate into, commit, push, pull, or update the skillpack repository after the initial clone.
- Initial clone is allowed only when the checkout does not exist yet.
- After clone, the skillpack checkout is read-only from the manager's perspective.
- If a checkout already exists, inspect and report its state; do not repair, update, pull, re-clone, format, or write into it.

## Manager State And Writes

- All manager state must live under `~/.agents/corvus-skill-manager`.
- The manager may write only:
  - its own config, lock, manifest, cache, and log files under `~/.agents/corvus-skill-manager`
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
- The final report states whether the skillpack repo was touched. Expected answer after setup is: no, except initial clone when explicitly requested.
