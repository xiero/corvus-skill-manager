# Corvus Skill Manager

Corvus Skill Manager is a TUI-first installer and configurator for wiring skillpacks into supported coding agents.

## Current Slice

This project currently provides the TypeScript pnpm workspace, a thin `corvus-skills` CLI entrypoint, an Ink TUI shell, manager config creation, initial skillpack setup, and read-only skill discovery.

```text
~/.agents/corvus-skill-manager/config.json
```

The CLI does not implement command workflows. It only launches the TUI.

Agent linking, skill execution, and Gemini support are deferred.

## Skillpack Setup

The TUI can configure a skillpack id, Git repository URL, branch, and checkout path. The default checkout path is:

```text
~/.agents/skillpacks/<skillpack-id>/repo
```

Setup only clones when that checkout path does not exist. Existing checkouts are inspected for commit and dirty state without pull, update, repair, reset, or writes inside the checkout. Lock metadata is written under:

The default skillpack source is displayed as `corvus-skillpack` in the TUI and resolves to:

```text
https://github.com/xiero/skill-collection.git
```

```text
~/.agents/corvus-skill-manager/lock.json
```

Agent linking, skill execution, and Gemini support are deferred.

## Skill Discovery

The Status screen reads `registry.json` and each referenced `SKILL.md` from the configured local checkout. Discovery validates registry entries, rejects unsafe paths, reports missing skill files, parses minimal frontmatter, and shows non-blocking risk warnings such as `scripts/` directories or executable-looking files.

Discovery is read-only. It does not modify `registry.json`, rewrite frontmatter, execute scripts, install dependencies, or create links.

## Agent Configuration And Link Planning

The Configure Agents screen lists Codex, Claude, Copilot CLI, OpenCode, Pi Agent, Custom, and Gemini. Gemini is shown as deferred for the MVP and no `.toml` wrappers are generated.

Supported agents can be enabled, assigned a target path, and configured with selected discovered skills. The app generates create-link and remove-link operations plus warnings/conflicts before anything is applied.

Apply requires explicit confirmation. Confirmed apply can create manager-owned symlinks or Windows junctions, remove only manager-owned links, and write its manifest under:

```text
~/.agents/corvus-skill-manager/manifest.json
```

The apply engine refuses to overwrite unmanaged files, unmanaged directories, unmanaged symlinks, or links whose manifest ownership/source does not match the requested operation. It does not write inside the skillpack checkout, execute scripts, generate Gemini wrappers, or use copy fallback.

## Status and Doctor

Status and Doctor are read-only views. They inspect manager config, lock state, managed-link manifest, the local skillpack checkout, discovered skills, configured agents, and managed links without repairing or modifying anything.

Status summarizes the configured skillpack, recorded/current commits, dirty state, enabled agents, selected skills, and managed link count. Doctor reports actionable issues such as missing or invalid config, checkout problems, registry/SKILL.md validation failures, dirty checkouts, broken managed links, manifest mismatches, unmanaged target conflicts, and deferred agents.

## Help

The TUI Help screen documents the expected workflow: setup the skillpack, enable agents, enter skill selection, select skills, save config, review the dry-run plan, and explicitly confirm apply. It also calls out common no-op cases, especially that enabled agents with no selected skills produce no link operations.

## Development

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
```
