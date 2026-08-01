# Safety Model

Corvus Skill Manager is designed around small, auditable filesystem side effects.

Every rule here is an invariant of the manager, enforced in the domain and application layers.
It applies identically to the Ink TUI and to the machine JSON CLI — an agent driving Corvus is
subject to exactly the same boundaries as a human, with no bypass, escape hatch, or force flag.

## Write Boundaries

The manager may write only:

1. Manager-owned files under `~/.agents/corvus-skill-manager`
2. Immutable skillpack revision snapshots and the manager-owned `current` link under `~/.agents/skillpacks/<skillpack-id>`
3. Confirmed manager-owned links inside configured agent target directories

The manager must not mutate an active skillpack checkout. Collection updates are represented by cloning a new revision snapshot and switching `current` after explicit approval.

## Skillpack Boundary

Allowed:

- clone the initial revision when the active `current` path does not exist
- check the remote branch head with read-only git operations
- clone a new revision into an absent `revisions/<commit>/repo` snapshot after preview is requested
- switch the manager-owned `current` link after explicit approval
- inspect current commit
- inspect dirty state
- read `registry.json`
- read `SKILL.md`
- scan for risk indicators

Forbidden:

- pull into the active checkout
- mutable update of an existing checkout or revision
- reset
- repair
- format
- commit
- push
- install dependencies
- run scripts
- rewrite registry or frontmatter

## Agent Target Boundary

Agent target directories are modified only after a confirmed apply. The manager refuses unmanaged conflicts and removes only links recorded in its manifest.

There is no copy fallback in the MVP. Skills are linked, not copied.

## Read-Only Views

Status remote checks, Doctor, Help, and discovery are read-only. Doctor reports actionable issues but never repairs them.

The read-only machine commands are `status`, `doctor`, `agents list`, `skillpack status`,
`skillpack update-check`, `skills list`, `skills search`, `skills inspect`,
`skills validate-registry`, and `install verify`. None of them creates a default config as a
side effect: a missing config is reported structurally, not fixed. Tests compare the whole home
directory tree before and after these commands.

## Machine Confirmation Model

Every write-capable machine command is two-phase. A plan command persists a digest-identified
artifact under `~/.agents/corvus-skill-manager/plans/`, and the apply command must repeat that
plan id as an explicit `--confirm` token. Before mutating, apply re-validates the plan schema,
its digest (detecting tampering), the confirmation token, and a fingerprint of the state the
plan was computed against; a mismatch fails with `STALE_PLAN` rather than being auto-corrected.
Only operations contained in the persisted plan are executed.

`--json` is never implicit authorization, machine mode never prompts, and Corvus never
regenerates a plan and applies it silently.

## Update Preview

When the remote commit differs from the active commit, the manager can download an inactive revision snapshot for preview. The preview summarizes added, removed, and changed skills. The active `current` link is unchanged until activation is explicitly approved — with `a` in the TUI, or with a matching `--confirm` token in the machine CLI.

## Gemini CLI

Gemini CLI is supported through Agent Skills directory links. The default user-scope target is `~/.gemini/skills`, and apply uses the same manager-owned link planning and unmanaged overwrite protections as other supported agents. The manager does not generate Gemini `.toml` command wrappers.

## Failure Handling

The TUI includes a safe fallback screen for unexpected render/runtime failures. The fallback reports the error and does not attempt repair or apply actions.
