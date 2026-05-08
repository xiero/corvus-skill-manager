# Corvus Skill Manager

Corvus Skill Manager is a TUI-first installer and configurator for wiring skillpacks into supported coding agents.

## Slice 1

This slice provides the TypeScript pnpm workspace, a thin `corvus-skills` CLI entrypoint, an Ink TUI shell, and manager config creation under:

```text
~/.agents/corvus-skill-manager/config.json
```

The CLI does not implement command workflows. It only launches the TUI.

Skillpack clone, registry loading, agent linking, and Gemini support are deferred.

## Development

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
```
