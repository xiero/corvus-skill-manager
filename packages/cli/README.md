# @corvus-tools/skill-manager

Run Corvus Skill Manager from npm:

```bash
npx @corvus-tools/skill-manager
```

Or install globally:

```bash
npm install -g @corvus-tools/skill-manager
corvus-skills
```

When launched from a global install, the TUI checks npm for a newer manager release
and shows the update command on Home when one is available:

```bash
npm install -g @corvus-tools/skill-manager@latest
```

The TUI only displays the command; it does not run npm or mutate its own install.

Corvus Skill Manager configures a local skillpack snapshot, discovers skills, detects remote collection updates, lets you choose target agents, previews link operations, and applies only confirmed manager-owned links.

## For coding agents

`corvus-skills` with no arguments launches the TUI. With a subcommand it runs a deterministic
JSON command interface designed for coding agents (Codex, Claude Code, Gemini CLI, Copilot CLI,
OpenCode, Pi Agent, …). The whole discovery surface is one command:

```bash
corvus-skills capabilities --json
```

That returns the protocol version, every supported command, whether each is read-only or
write-capable, the confirmation model, the supported agent adapters, the request schema, the
relevant paths, and the exit-code contract.

Every write is plan-then-apply: a plan is persisted with a digest and a fingerprint of the state
it was computed against, and apply must repeat the plan id as an explicit `--confirm` token.
`--json` is never implicit authorization. Search ranking is local, lexical, and deterministic —
there is no embedded LLM, and the calling agent makes every semantic choice.

The CLI package itself owns transport concerns only — argument parsing, request-document
reading, protocol serialization, and exit-code mapping. All workflow logic lives in
`@corvus-tools/skill-manager-core`, which the TUI calls too.

The active skillpack checkout is read-only. Updates use immutable `revisions/<commit>/repo` snapshots and an approved `current` link switch; the manager does not pull, reset, repair, edit, install dependencies, or execute scripts inside the checkout.
