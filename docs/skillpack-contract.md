# Skillpack Contract

Corvus Skill Manager reads a local skillpack checkout. The checkout is owned by the user and is read-only from the manager's perspective after the optional initial clone.

## Checkout

- The configured checkout path should be a git worktree.
- The manager may clone into the checkout path only when it does not exist.
- Existing checkouts are inspected only. The manager does not pull, reset, repair, build, install, format, or commit inside them.

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
- Paths must resolve inside the skillpack checkout.
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
