# Corvus Skill Manager

Corvus Skill Manager is a TUI-first manager for wiring local skillpacks into supported coding agents. It keeps the protected default Corvus collection and any number of additional repositories side by side, discovers their skills as one catalog, previews link plans, and applies only confirmed manager-owned links.

`corvus-skills` with no arguments launches the Ink TUI, exactly as before. With a subcommand it
runs a deterministic JSON command interface built for coding agents — see
[AI Agents](#ai-agents) below.

## What It Does

- Creates and loads manager state under `~/.agents/corvus-skill-manager`.
- Keeps the default `corvus-skillpack` and configures any number of additional skillpack sources.
- Performs each pack's initial revision clone only when that pack's active snapshot is absent.
- Detects remote skillpack changes in read-only mode and lets you preview/approve a new local revision snapshot.
- Discovers skills from `registry.json`, or from `SKILL.md` files in read-only fallback mode when a registry is missing.
- Reads optional registry v2 semantic metadata (domain, task, language, technology, platform, use case) and skill relationships, so skills can be found by intent rather than by name.
- Lets you enable supported agents and select skills per agent.
- Generates a deterministic dry-run link plan.
- Applies confirmed plans by creating/removing manager-owned symlinks or Windows junctions.
- Shows read-only Status, Doctor, and Help views.
- Exposes the same workflows to coding agents as a deterministic JSON CLI, with plan-then-apply confirmation.

## What It Does Not Do

- It does not pull into, reset, repair, format, commit, push, or edit the active skillpack checkout.
- It does not automatically update the local skill collection; revision activation requires a preview and an explicit approval (`a` in the TUI, or a matching `--confirm` plan token in the machine CLI).
- It does not overwrite unmanaged files, directories, or symlinks.
- It does not execute skill scripts or install dependencies inside the skillpack.
- It does not generate Gemini `.toml` command wrappers.
- It does not provide marketplace, cloud, auth, Express, backend, or copy-fallback behavior.
- It does not embed an LLM, require an AI API key, or make a semantic choice invisibly. The calling agent interprets intent; Corvus executes deterministic operations.

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

When `corvus-skills` is launched from a global install, the TUI checks npm for a newer
`@corvus-tools/skill-manager` release and shows the update command on Home when one is
available. It does not run package-manager commands for you.

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

Publish them in that order after a clean build/typecheck/test run. The CLI package depends on both the TUI package and the core package, and the TUI package depends on the core package. Because all three share a version and depend on each other with `workspace:^`, a release must publish all three together.

## First-Run Flow

1. Start the TUI with `npx @corvus-tools/skill-manager`, `pnpm dev`, or `corvus-skills`.
2. The TUI opens **Home** first.
3. Select **Guided Flow** for the recommended wizard.
4. Skillpack: inspect the protected default source, then press `a` only for the safe setup/config action shown. Use **Manage Skillpacks** to add further repositories alongside it.
5. Update: if a remote update is available, preview the inactive revision snapshot before pressing `a` to activate it. You can continue without updating.
6. Agents: enable one or more supported agents with Space. Gemini CLI is supported through Agent Skills links.
7. Skills: press Enter on an enabled agent, then select skills with Space. When more than one agent is enabled, a skill toggle applies to every enabled agent at once; a `[~]` marker means a skill is selected for some but not all of them.
8. Plan: review the dry-run link plan. A no-op plan means no links will be created.
9. Apply: open the final apply step from the plan, then press `a` to save selections and apply manager-owned link changes.

The guided wizard uses one approval key consistently: `a` applies or approves the write-capable action on the current step.

If no skills are selected, the plan has no create-link operations and no links are created. **Manage Skillpacks** and **Configure Agents** remain available from Home as manual advanced screens.

### Managing repository sources in the TUI

**Manage Skillpacks** separates the protected default repository from additional repositories in two clearly labeled sections. Select a repository and press Enter to inspect its status, edit its settings, or preview an update. The default is marked `[DEFAULT] [PROTECTED]` and never offers a removal action.

Choose **+ Add repository** or press `a` to add another source. Enter the Git URL first; Corvus derives a unique repository ID from the repo name, uses `main` as the branch, and generates `~/.agents/skillpacks/<id>/current` as the active path. Review the generated values before applying, or open **Advanced settings** to change them. Once registered, the repository ID remains read-only so qualified skill references stay stable.

### Managing repository sources from the machine CLI

Adding a source is also plan-then-apply. First generate and review a setup plan:

```bash
corvus-skills skillpack setup-plan \
  --skillpack-id team-skills \
  --repository https://github.com/acme/team-skills.git \
  --branch main \
  --checkout-path "$HOME/.agents/skillpacks/team-skills/current" \
  --json
```

Then repeat the returned `planId` as the confirmation token:

```bash
corvus-skills skillpack setup-apply \
  --plan-id <plan-id> \
  --confirm <plan-id> \
  --json
```

Inspect one source or install one of its skills with its qualified reference:

```bash
corvus-skills skillpack status --skillpack-id team-skills --check-remote --json
corvus-skills install plan --agent codex --skill team-skills:review-helper --json
```

An unused additional source can be unregistered with `skillpack remove-plan --skillpack-id team-skills`, followed by `skillpack remove-apply` with the returned plan ID and matching confirmation token. Removal preserves its immutable revisions and `current` link.

## AI Agents

You can ask an installed coding agent (Codex, Claude Code, Gemini CLI, Copilot CLI, OpenCode,
Pi Agent, …) to drive Corvus for you, without knowing any Corvus commands:

> "Use Corvus Skill Manager to install the whole compatible skillpack for yourself."
>
> "Install `spec-unleashed` and `git-commit` for Codex and Claude Code."
>
> "Install a balanced set of skills useful for embedded development."

The agent's discovery entrypoint is a single command:

```bash
corvus-skills capabilities --json
```

That returns the protocol version, every supported command, whether each is read-only or
write-capable, the confirmation model, the supported agent adapters, the request schema, the
relevant paths, and the exit-code contract — everything needed to operate the binary without
external documentation.

The agent then follows: `status` → make the required skillpack sources ready → `skills search` / `skills inspect`
→ choose exact skill IDs → `install plan` → review conflicts → `install apply --plan-id <id>
--confirm <id>` → `install verify`.

Two properties matter:

- **Corvus never makes a semantic choice.** Search ranking is local, lexical, and deterministic,
  and returns the score and matched fields for every candidate. Choosing which skills to install
  is the calling agent's job, and its reasoning is recorded in the plan as provenance.
- **Every write is plan-then-apply.** A plan is persisted with a digest and a fingerprint of the
  state it was computed against; apply must repeat the plan id as an explicit confirmation token
  and re-validates everything before mutating. `--json` is never implicit authorization, and
  unmanaged files are never overwritten.

Details: [Agent Interface](docs/agent-interface.md) ·
[Machine Protocol v1](docs/agent-protocol-v1.md) ·
[Semantic Registry](docs/semantic-registry.md) ·
[Request examples](docs/examples/agent-install-requests.json)

## Supported Agents

| Agent | MVP status | Default target path |
| --- | --- | --- |
| OpenAI Codex CLI | Supported | `~/.agents/skills` |
| Claude Code | Supported | `~/.claude/skills` |
| GitHub Copilot CLI | Supported | `~/.copilot/skills` |
| OpenCode | Supported | `~/.config/opencode/skills` |
| Pi Agent | Supported | `~/.pi/agent/skills` |
| Custom | Custom target required | user-provided |
| Gemini CLI | Supported | `~/.gemini/skills` |

Gemini CLI support uses its Agent Skills directory model. The manager links selected skill directories into the configured Gemini skills target and does not generate `.toml` command wrappers.

## State Files

All manager-owned metadata lives under:

```text
~/.agents/corvus-skill-manager
```

The main files are:

- `config.json`: manager config, all skillpack sources, and qualified agent selections
- `lock.json`: recorded skillpack commit and branch after setup/inspection
- `manifest.json`: manager-owned link records
- `plans/<plan-id>.json`: persisted plan artifacts written by machine commands and **Manage Skillpacks**, each carrying its own digest and a fingerprint of the state it was computed against

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

The TUI displays that source as `corvus-skillpack`. Additional sources use their own unique IDs and the same revision layout.

Catalog entries expose both their local `id` and a stable `ref` in the form
`<skillpack-id>:<skill-id>`. Unqualified machine requests remain compatible and refer to the
default pack. Two packs may contain the same local ID, but both cannot be installed into the
same agent target because they would claim the same directory name.

Pack-specific machine operations accept `--skillpack-id`. Removing an unused secondary source
uses `skillpack remove-plan` followed by `remove-apply`; the registration is removed but its
immutable snapshots and `current` link are deliberately preserved.

## Revision Snapshot Model

Initial clone creates an immutable revision under `revisions/<commit>/repo` and points `current` at it. The configured checkout path is `current`.

Status can compare the active commit with the remote branch head without writing to the skillpack. When a remote update is available, Manage Skillpacks can download an inactive preview snapshot. The active `current` link changes only after explicit approval.

Status, Doctor, discovery, planning, and apply do not mutate active skillpack revisions. Apply only writes manager metadata under `~/.agents/corvus-skill-manager` and confirmed manager-owned links inside configured agent target directories.

## Troubleshooting

**No links were created**

Open Guided Flow, enable an agent, press Enter on that agent, select at least one skill with Space, generate the plan, then approve the Apply step with `a`.

**The plan shows conflicts**

The target path already contains an unmanaged file, directory, or symlink. The manager will not overwrite it. Move it manually or choose a different target path.

**Missing `registry.json`**

The manager falls back to read-only `SKILL.md` discovery. Doctor reports this as a warning because registry-backed discovery is preferred.

**Gemini skills do not appear**

Confirm Gemini is enabled, at least one skill is selected for Gemini, and the configured target path points to Gemini's skills directory. The default is `~/.gemini/skills`.

**Dirty checkout**

Doctor reports dirty skillpack checkouts, but will not reset or repair them. Review the checkout manually.

**Remote update available**

Open Guided Flow, preview the update, review added/changed/removed skills, then press `a` on the Update step if you want `current` to point at the new revision.

**An additional repository is unavailable**

Explicit operations using qualified references from other readable repositories continue with a warning. `install plan --all-compatible` blocks until every configured repository is readable, because otherwise it could silently produce an incomplete selection.

**A machine command exits non-zero**

The exit code is a broad category and the JSON `errors[].code` is authoritative: `2` invalid
input, `3` conflict or unsafe target, `4` confirmation required or stale plan, `5` safety block,
`6` git/filesystem/network, `7` internal. Read `nextActions` — it usually contains the exact
command to run next. Full taxonomy: [Machine Protocol v1](docs/agent-protocol-v1.md).

**`install apply` reports `STALE_PLAN`**

Local state changed after the plan was generated, so the plan no longer describes what would
happen. Regenerate with `install plan`, review it, and apply the new plan id. Corvus will not
regenerate and apply silently.

**An agent installed skills you did not expect**

Every plan records the calling agent's `intent`, its `selectionPolicy`, and a per-skill `reason`,
and the applied plan artifact stays under `~/.agents/corvus-skill-manager/plans/`. Read it to see
exactly what was requested and why, then use `install plan --replace-selection` to correct the
selection.

## Docs

- [Architecture](architecture.md)
- [Agent-Native Architecture](docs/agent-native-architecture.md)
- [Agent Interface](docs/agent-interface.md)
- [Machine Protocol v1](docs/agent-protocol-v1.md)
- [Semantic Registry](docs/semantic-registry.md)
- [Skillpack Contract](docs/skillpack-contract.md)
- [Registry v1 to v2 Migration](docs/skillpack-registry-migration.md)
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
