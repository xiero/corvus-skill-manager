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

## Development

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
```
