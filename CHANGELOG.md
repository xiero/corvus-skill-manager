# Changelog

## Unreleased — Agent-native interface and intent-based skill installation

**Draft release notes. Nothing has been published.**

Corvus Skill Manager becomes operable by a coding agent without the user knowing any Corvus
commands, while the human TUI stays exactly as it was.

### Preserved TUI

`corvus-skills` with no arguments launches the same Ink TUI: the Home menu, the Guided Flow
wizard as the default entry, the existing preview screens, the single `a` approval key, and the
Status, Doctor, Help, and advanced screens. Ink is now imported dynamically, so a machine
command never loads React or the TUI at runtime.

### Machine JSON CLI

A second mode on the same binary, for Codex, Claude Code, Gemini CLI, Copilot CLI, OpenCode,
Pi Agent, and any other coding agent:

```text
corvus-skills capabilities --json
corvus-skills status|doctor --json
corvus-skills agents list --json
corvus-skills skillpack status|setup-plan|setup-apply|update-check|update-preview|update-apply --json
corvus-skills skills list|search|inspect|validate-registry --json
corvus-skills install plan|apply|verify --json
```

Every command shares one versioned envelope (`schemaVersion: 1`) with `ok`, `changed`, `data`,
`warnings`, `errors`, and `nextActions`. In JSON mode stdout carries exactly one canonical JSON
document with no ANSI and no prompting; diagnostics go to stderr only under `--debug`. Errors
carry stable symbolic codes mapped to a documented exit-code contract (0/2/3/4/5/6/7).

`capabilities --json` is the whole discovery surface: an agent needs only the binary name to
learn the commands, the read/write classification, the confirmation model, the agent adapters,
the request schema, the paths, and the exit codes.

### Intent-oriented catalog and search

`skills search` ranks skills with deterministic local lexical scoring over weighted fields, and
returns the score plus the matched fields and terms for every candidate. There is no LLM, no
embedding model, and no network call: Corvus never makes a semantic choice invisibly. Repeated
searches over the same snapshot return byte-identical JSON, with skill id as the stable
tie-breaker.

### Exact and all-compatible installs

`install plan` accepts an exact selection of skill IDs for one or more target agents, or
`--all-compatible` for every skill supporting each agent. Installation is additive by default;
`--replace-selection` is opt-in and lists every removal before apply. Required dependencies are
expanded transitively with a `dependency-of:<skill-id>` reason; recommendations are surfaced but
never installed automatically. An unknown skill, an unsupported skill/agent pair, or a declared
skill conflict is a blocking error, never a silent skip.

### Plan/apply confirmation

Every write is two-phase. A plan command persists a digest-identified artifact under
`~/.agents/corvus-skill-manager/plans/`, including the normalized request, the intent
provenance, the intended config mutation, the ordered link operations, and a fingerprint of the
state it was computed against. `apply --plan-id <id> --confirm <id>` re-validates the schema,
the digest, the confirmation token, and the fingerprint immediately before mutating, and
executes only operations contained in that plan. `--json` is never implicit authorization.
Re-applying a completed plan is a structured no-op. `install verify` is strictly read-only and
reports `verified`, `verified-no-op`, `partially-applied`, `drift-detected`, or `blocked`.

### Registry v2

Registries may declare `"version": 2` and add optional semantic metadata (`domains`, `tasks`,
`languages`, `technologies`, `platforms`, `keywords`, `useCases`, `nonGoals`) and relationships
(`requires`, `recommends`, `conflictsWith`). `skills validate-registry` reports invalid entries,
unknown relationship targets, dependency cycles, and per-field coverage — read-only, and
suitable for skillpack CI.

### Backward compatibility

- Existing config, lock, manifest, and revision state is read unchanged.
- Registry v1 files stay valid with no edits; v2 is a strict superset.
- Registryless `SKILL.md` discovery still works, with empty semantic arrays.
- All existing TUI behavior and keybindings are unchanged.

### Safety

Unchanged and now shared by both interfaces: no overwriting unmanaged files, directories, or
symlinks; removal only of manifest-owned links; no pull/reset/repair/format/commit/push against
the active skillpack checkout; no writes to registry or skill files; read-only commands mutate
nothing at all, including not creating a default config. There is no force flag.

### Not included

No MCP adapter, no embedded LLM, no AI API key requirement, no backend, cloud service,
authentication layer, marketplace, telemetry, or copy fallback.

### Cross-repository follow-up

Migrating the default `xiero/skill-collection` registry to v2 is deferred; it requires that
repository's checkout. See `docs/skillpack-registry-migration.md` for the checklist. Manager
tests run against representative v2 fixtures and need no network access.
