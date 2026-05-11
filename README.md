# Corvus Skill Manager

Corvus Skill Manager is a TUI-first manager for wiring local skillpacks into supported coding agents. It helps you configure one skillpack snapshot, discover skills, detect remote collection updates, select which agents should receive which skills, preview a link plan, and apply only confirmed manager-owned links.

The CLI binary is intentionally thin: `corvus-skills` launches the Ink TUI. Command workflows such as `corvus-skills update` or `corvus-skills install` are not part of the MVP.

## What It Does

- Creates and loads manager state under `~/.agents/corvus-skill-manager`.
- Configures a skillpack source and performs the initial revision clone only when the active snapshot is absent.
- Detects remote skillpack changes in read-only mode and lets you preview/approve a new local revision snapshot.
- Discovers skills from `registry.json`, or from `SKILL.md` files in read-only fallback mode when a registry is missing.
- Lets you enable supported agents and select skills per agent.
- Generates a deterministic dry-run link plan.
- Applies confirmed plans by creating/removing manager-owned symlinks or Windows junctions.
- Shows read-only Status, Doctor, and Help views.

## What It Does Not Do

- It does not pull into, reset, repair, format, commit, push, or edit the active skillpack checkout.
- It does not automatically update the local skill collection; revision activation requires preview and approval in the TUI.
- It does not overwrite unmanaged files, directories, or symlinks.
- It does not execute skill scripts or install dependencies inside the skillpack.
- It does not generate Gemini `.toml` wrappers in the MVP.
- It does not provide marketplace, cloud, auth, Express, backend, or copy-fallback behavior.

## Run From npm

After the packages are published to npm, anyone can start the TUI with:

```bash
npx @corvus-tools/skill-manager
```

For a global install:

```bash
npm install -g @corvus-tools/skill-manager
corvus-skills
```

The npm package exposing the runnable binary is `@corvus-tools/skill-manager`.
Its single bin is `corvus-skills`, so `npx @corvus-tools/skill-manager` starts the TUI directly.

## Local Development

```bash
pnpm install
pnpm build
pnpm dev
```

For local binary testing after build:

```bash
pnpm --filter @corvus-tools/skill-manager exec corvus-skills
```

The package exposing the binary is `@corvus-tools/skill-manager`:

```json
{
  "bin": {
    "corvus-skills": "./dist/index.js"
  }
}
```

## Publishing

This repo publishes three public npm packages:

1. `@corvus-tools/skill-manager-core`
2. `@corvus-tools/skill-manager-tui`
3. `@corvus-tools/skill-manager`

Publish them in that order after a clean build/typecheck/test run. The CLI package depends on the TUI package, and the TUI package depends on the core package.

## First-Run Flow

1. Start the TUI with `npx @corvus-tools/skill-manager`, `pnpm dev`, or `corvus-skills`.
2. Open **Setup Skillpack**.
3. Preview setup, then confirm only if the active snapshot is missing and you want the initial revision clone.
4. Open **Configure Agents**.
5. Enable one or more supported agents with Space.
6. Press Enter on an enabled agent, then select skills with Space.
7. Press `b`, then `s` to save config.
8. Review the dry-run plan.
9. Press `a`, then `y` to apply after explicit confirmation.

If no skills are selected, the plan has no create-link operations and no links are created. Open **Help** in the TUI for the same workflow and common no-op cases.

## Supported Agents

| Agent | MVP status | Default target path |
| --- | --- | --- |
| OpenAI Codex CLI | Supported | `~/.agents/skills` |
| Claude Code | Supported | `~/.claude/skills` |
| GitHub Copilot CLI | Supported | `~/.copilot/skills` |
| OpenCode | Supported | `~/.config/opencode/skills` |
| Pi Agent | Supported | `~/.pi/agent/skills` |
| Custom | Custom target required | user-provided |
| Gemini CLI | Deferred | unsupported in MVP |

Gemini remains visible so the MVP can explain its status, but Gemini wrapper generation is intentionally deferred.

## State Files

All manager-owned metadata lives under:

```text
~/.agents/corvus-skill-manager
```

The main files are:

- `config.json`: manager config, skillpack source, agent selections
- `lock.json`: recorded skillpack commit and branch after setup/inspection
- `manifest.json`: manager-owned link records

Default skillpack layout:

```text
~/.agents/skillpacks/<skillpack-id>/
  revisions/
    <commit>/
      repo/
  current -> revisions/<active-commit>/repo
```

Default skillpack source:

```text
https://github.com/xiero/skill-collection.git
```

The TUI displays that source as `corvus-skillpack`.

## Revision Snapshot Model

Initial clone creates an immutable revision under `revisions/<commit>/repo` and points `current` at it. The configured checkout path is `current`.

Status can compare the active commit with the remote branch head without writing to the skillpack. When a remote update is available, Setup Skillpack can download an inactive preview snapshot. The active `current` link changes only after explicit approval.

Status, Doctor, discovery, planning, and apply do not mutate active skillpack revisions. Apply only writes manager metadata under `~/.agents/corvus-skill-manager` and confirmed manager-owned links inside configured agent target directories.

## Troubleshooting

**No links were created**

Open Configure Agents, enable an agent, press Enter on that agent, select at least one skill with Space, save with `s`, then review/apply the plan.

**The plan shows conflicts**

The target path already contains an unmanaged file, directory, or symlink. The manager will not overwrite it. Move it manually or choose a different target path.

**Missing `registry.json`**

The manager falls back to read-only `SKILL.md` discovery. Doctor reports this as a warning because registry-backed discovery is preferred.

**Gemini is unsupported**

Gemini `.toml` wrapper generation is deferred for MVP. Do not expect Gemini link operations.

**Dirty checkout**

Doctor reports dirty skillpack checkouts, but will not reset or repair them. Review the checkout manually.

**Remote update available**

Open Setup Skillpack, preview the update, review added/changed/removed skills, then approve activation if you want `current` to point at the new revision.

## Docs

- [Skillpack Contract](docs/skillpack-contract.md)
- [Managed Manifest Behavior](docs/managed-manifest.md)
- [Safety Model](docs/safety-model.md)
- [npm Publishing](docs/npm-publishing.md)

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

CI runs the same install, build, typecheck, and test path.
