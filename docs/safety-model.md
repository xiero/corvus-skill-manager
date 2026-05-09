# Safety Model

Corvus Skill Manager is designed around small, auditable filesystem side effects.

## Write Boundaries

The manager may write only:

1. Manager-owned files under `~/.agents/corvus-skill-manager`
2. Confirmed manager-owned links inside configured agent target directories

The manager must not write inside the skillpack checkout after the initial clone.

## Skillpack Boundary

Allowed:

- clone when the checkout path does not exist
- inspect current commit
- inspect dirty state
- read `registry.json`
- read `SKILL.md`
- scan for risk indicators

Forbidden:

- pull
- update
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

Status, Doctor, Help, and discovery are read-only. Doctor reports actionable issues but never repairs them.

## Gemini Boundary

Gemini is shown as deferred/unsupported in the MVP. The manager does not generate Gemini `.toml` wrappers because that would not fit the current link-only apply model.

## Failure Handling

The TUI includes a safe fallback screen for unexpected render/runtime failures. The fallback reports the error and does not attempt repair or apply actions.
