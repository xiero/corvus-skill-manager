# Skillpack Contract

Corvus Skill Manager reads a local skillpack snapshot. The active snapshot is read-only from the manager's perspective. Updates are modeled as immutable revisions, never as `git pull` against the active checkout.

## Snapshot Layout

The default local layout is:

```text
~/.agents/skillpacks/<skillpack-id>/
  revisions/
    <commit>/
      repo/
        registry.json
        skills/
          <skill-id>/
            SKILL.md
  current -> revisions/<active-commit>/repo
```

The configured checkout path is the active `current` path. Discovery and link planning read through that path so existing manager-owned agent links continue to resolve after `current` is repointed.

## Revision Rules

- The active path should resolve to a git worktree.
- The manager may create the initial revision snapshot only when the active path does not exist.
- The manager may detect remote changes with read-only git operations such as `git ls-remote`.
- The manager may clone a new revision only into an absent `revisions/<commit>/repo` snapshot.
- The manager may switch the `current` link only after the TUI shows a preview and the user approves the update.
- Existing active checkouts and existing revisions are inspected only. The manager does not pull, reset, repair, build, install, format, or commit inside them.

## Preferred Registry

The preferred skillpack root contains:

```text
registry.json
```

The registry shape is:

```json
{
  "version": 1,
  "skills": [
    {
      "id": "review-helper",
      "path": "skills/review-helper",
      "title": "Review Helper",
      "description": "Helps review code changes.",
      "supportedAgents": ["codex", "claude"],
      "tags": ["review"]
    }
  ]
}
```

Rules:

- `id`, `path`, `title`, `description`, and `supportedAgents` are required.
- `tags` is optional.
- Skill paths must be relative.
- Absolute paths and `../` traversal are rejected.
- Paths must resolve inside the active skillpack snapshot.
- Duplicate skill ids are rejected.

## Skill Files

Each registry entry must point to a directory containing:

```text
SKILL.md
```

Minimal frontmatter:

```markdown
---
name: review-helper
description: Helps review code changes.
---
```

The manager parses frontmatter and scans for risk indicators, but it does not rewrite files or execute scripts.

## Registryless Fallback

If `registry.json` is missing, the manager can discover `SKILL.md` files in read-only fallback mode. This is useful for MVP compatibility, but Doctor reports it as a warning because the registry contract is more explicit.

Fallback-discovered skills default to Codex support and receive the `registryless` tag.
