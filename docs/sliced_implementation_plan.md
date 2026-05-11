# Corvus Skill Manager MVP Plan

## Product Summary

Corvus Skill Manager is a TUI-first installer/configurator for wiring a local skillpack into multiple coding agents. Its job is not to author, edit, publish, or run skills. It provides a controlled terminal UI where the user selects a skillpack, validates available `SKILL.md` folders, detects remote collection updates, previews approved revision changes, chooses target agents, previews filesystem operations, then creates or removes manager-owned links in agent skill directories.

The product’s core promise is: keep active skillpack revisions read-only from the manager’s perspective, keep mutable manager metadata under `~/.agents/corvus-skill-manager`, and make the installed state auditable through Status and Doctor views.

## MVP Boundaries

Included:

- TUI launched by `corvus-skills`; CLI is only the entrypoint.
- Initial clone of a skillpack into `~/.agents/skillpacks/<id>/revisions/<commit>/repo` with `current` pointing at the active revision.
- Read-only remote update detection and TUI-approved revision activation.
- No automatic update, mutable pull, commit, push, formatting, generation, or dependency install inside the skill repo.
- `registry.json` loading and validation.
- `SKILL.md` metadata parsing and static risk scan.
- Agent selection for Codex, Claude, Copilot CLI, OpenCode, Pi, and Custom.
- Gemini shown as unsupported/deferred in MVP, because MVP is link-only.
- Apply preview before any write.
- Creation/removal of manager-owned links only in agent target directories.
- Config, lock, and managed-target manifest under `~/.agents/corvus-skill-manager`.
- Status and Doctor screens.
- Vitest coverage for config, registry, path safety, adapter planning, link ownership, and Doctor checks.

Excluded:

- Skill repo editing.
- Mutable skill repo updates after initial clone.
- Automatic skill collection updates.
- Skill generation.
- Gemini `.toml` wrapper generation.
- Marketplace, remote registry API, auth, cloud sync, Express backend.
- Skill execution or script execution.
- Automatic overwrite of existing unmanaged files/directories.

## Architectural Risks

- **Write-safety boundary:** the core must make it impossible for normal flows to mutate active skillpack revisions. File operations should be routed through small, test-covered setup/update/apply layers.
- **Ownership tracking:** removal must only affect targets recorded in the manager manifest and verified as matching the expected source/link shape.
- **Path traversal:** registry paths must stay inside the skillpack root; absolute paths and `../` escapes must be rejected.
- **Agent path uncertainty:** some agent paths may change or be user-specific. Adapters should expose defaults but allow override before apply.
- **Cross-platform links:** Unix symlinks and Windows junction behavior differ. MVP should support symlink/junction planning, with copy fallback deferred unless explicitly allowed later.
- **Revision vs mutable update model:** initial and approved update clones create immutable revision snapshots; no pull/update behavior should mutate an existing checkout.
- **Gemini mismatch:** Gemini’s `.toml` command model is not link-only, so Gemini should be deferred rather than forced into an inaccurate adapter.

## Vertical Slice Order

1. **TUI Shell + Config**
   - Create pnpm TypeScript workspace with `core`, `tui`, and thin `cli` package.
   - Build Ink app with Welcome, early Status/Doctor views, and navigation.
   - Implement Zod config schema, default paths, load/save under `~/.agents/corvus-skill-manager`.
   - Acceptance: `pnpm dev` opens TUI; first run creates valid manager config; tests cover config defaults/load/save.

2. **Skillpack Setup With Initial Revision**
   - Add TUI flow for repo URL, branch, skillpack ID, and local checkout path.
   - Clone only when the active `current` path is absent.
   - Store snapshots under `revisions/<commit>/repo` and point `current` at the active revision.
   - If checkout exists, inspect commit and dirty state, but do not pull or repair.
   - Write lock state only under manager directory.
   - Acceptance: fresh setup clones a revision; existing checkout is read-only inspected; dirty checkout is reported; no existing revision is mutated.

2a. **Remote Update Preview**
   - Compare active commit with the remote branch using read-only git operations.
   - Notify the user in Status/Setup when the remote commit differs.
   - Download an inactive revision snapshot only when the user asks to preview.
   - Summarize added, removed, and changed skills before activation.
   - Switch `current` only after explicit approval.
   - Acceptance: remote changes are detected without modifying the active snapshot; preview does not repoint `current`; approval activates the new revision.

3. **Registry + Skill Discovery**
   - Load `registry.json`.
   - Validate skill IDs, relative paths, path containment, supported agents, and `SKILL.md`.
   - Parse frontmatter with `gray-matter`; validate with Zod.
   - Add basic static risk scan.
   - Acceptance: valid skills render in TUI; invalid skills show clear errors; traversal/absolute paths are rejected.

4. **Agent Selection + Link Planning**
   - Implement adapter interface for Codex, Claude, Copilot, OpenCode, Pi, and Custom.
   - Gemini appears as deferred/unsupported in MVP.
   - Implement agent selection screen with editable target paths where needed.
   - Generate an apply plan only; no writes until confirmation.
   - Acceptance: selected skills and agents produce deterministic link operations with default target paths.

5. **Apply Engine + Managed Links**
   - Implement `ensure-dir`, `create-link`, and `remove-managed-link`.
   - Add manifest tracking for manager-owned targets.
   - Detect existing unmanaged target conflicts and skip with a visible warning.
   - Support symlink on Unix and junction for Windows directories.
   - Acceptance: apply creates links after confirmation; unmanaged targets are never overwritten; disable removes only manifest-owned links.

6. **Status + Doctor**
   - Build status report from config, lock, manifest, registry, and filesystem state.
   - Build doctor report for invalid config, missing skillpack, dirty checkout, missing source, broken link, and unmanaged conflicts.
   - Acceptance: Status shows skillpack commit and enabled skills by agent; Doctor detects broken/missing/stale states without modifying anything.

7. **Polish + Release Readiness**
   - Add keyboard help, error boundary, cleaner layout, and useful empty states.
   - Add README install/use docs.
   - Add CI for typecheck and tests.
   - Acceptance: fresh install instructions work; tests pass; no feature writes to the skill repo.

## Assumptions Locked For Implementation

- MVP is TUI-first; there is no CLI-only Slice 1.
- Initial clone and approved update clones are allowed, but no pull/reclone-over-existing behavior is included.
- After clone, the manager treats every revision checkout as read-only.
- Gemini is deferred for MVP because generated `.toml` wrappers would violate the current link-only target rule.
- The manager may write only to its own state directory and agent target directories for confirmed, manager-owned link operations.
- TypeScript, Node.js, React Ink, Zod, and Vitest are the preferred stack.
