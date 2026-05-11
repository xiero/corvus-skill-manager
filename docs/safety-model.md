# Safety Model

Corvus Skill Manager is designed around small, auditable filesystem side effects.

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

## Update Preview

When the remote commit differs from the active commit, the TUI can download an inactive revision snapshot for preview. The preview summarizes added, removed, and changed skills. The active `current` link is unchanged until the user explicitly approves activation.

## Gemini Boundary

Gemini is shown as deferred/unsupported in the MVP. The manager does not generate Gemini `.toml` wrappers because that would not fit the current link-only apply model.

## Failure Handling

The TUI includes a safe fallback screen for unexpected render/runtime failures. The fallback reports the error and does not attempt repair or apply actions.
