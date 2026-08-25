# Skillpack Contract

Corvus Skill Manager reads one protected default skillpack plus any number of additional local skillpack snapshots. Every active snapshot is read-only from the manager's perspective. Updates are modeled independently as immutable revisions, never as `git pull` against an active checkout.

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

Three registry versions are supported. **v2 is a strict superset of v1**, and v1/v2 registries
stay readable with no edits. Registry v3 adds mandatory versions and bundles as an explicit new
contract rather than changing legacy meaning.

### Registry v1

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
- `version` may be omitted; a missing version is treated exactly as before.

### Registry v2

v2 adds optional **semantic classification** and optional **relationships**. Both exist so a
coding agent can translate a broad user intent ("a balanced set for embedded development")
into exact skill IDs without guessing from file names.

```json
{
  "version": 2,
  "skills": [
    {
      "id": "embedded-driver-development",
      "path": "skills/embedded-driver-development",
      "title": "Embedded Driver Development",
      "description": "Helps implement and review embedded C/C++ drivers.",
      "supportedAgents": ["codex", "claude"],
      "tags": ["firmware"],
      "domains": ["embedded", "firmware"],
      "tasks": ["driver-development", "debugging", "code-review"],
      "languages": ["c", "cpp"],
      "technologies": ["cmake", "gcc", "stm32"],
      "platforms": ["bare-metal", "rtos"],
      "keywords": ["hal", "registers", "interrupts", "peripherals"],
      "useCases": ["Implement a new peripheral driver"],
      "nonGoals": ["General-purpose web application development"],
      "requires": [],
      "recommends": ["embedded-testing"],
      "conflictsWith": []
    }
  ]
}
```

Semantic fields (all optional, all arrays):

| Field | Meaning |
|---|---|
| `domains` | Broad problem areas, e.g. `embedded`, `web`, `testing`, `documentation`. |
| `tasks` | What the skill helps *do*, e.g. `driver-development`, `code-review`. |
| `languages` | Programming languages, e.g. `c`, `typescript`. |
| `technologies` | Tools/frameworks/libraries, e.g. `cmake`, `react`, `git`. |
| `platforms` | Runtime/target environments, e.g. `bare-metal`, `browser`, `server`. |
| `keywords` | Free-form search terms not covered above. |
| `useCases` | Short sentences describing when the skill applies. |
| `nonGoals` | Short sentences describing when it does **not** apply. Used as a negative search signal. |

Relationship fields (all optional, all arrays of skill IDs in the same registry):

| Field | Meaning |
|---|---|
| `requires` | Hard dependencies. Installing the skill also installs these, with reason `dependency-of:<skill-id>`. |
| `recommends` | Soft suggestions. Surfaced to the calling agent but **never installed automatically**. |
| `conflictsWith` | Skills that should not be installed alongside this one. Treated symmetrically. |

Validation rules for v2 metadata:

- every value is a non-empty, trimmed string — leading/trailing whitespace is rejected rather
  than silently fixed, so registry files stay canonical;
- classification tokens are at most 64 characters, prose (`useCases`, `nonGoals`) at most 280;
- token/relationship arrays hold at most 32 entries, prose arrays at most 16;
- `requires` and `conflictsWith` must reference skills that exist in the registry, and a
  missing target is a blocking discovery error;
- a missing `recommends` target is a warning, not an error;
- a skill may not require or conflict with itself;
- cycles in `requires` are rejected;
- unknown fields are rejected in every version, so a misspelled `domain` or `recommend` fails
  loudly instead of being ignored.

### Registry v3

v3 requires canonical Semantic Versioning 2.0.0 versions for skills and bundles. Hard
dependencies and bundle members use versioned local references; Corvus tests each range against
the one skill version in the active immutable snapshot and never fetches or chooses another
version.

```json
{
  "version": 3,
  "skills": [
    {
      "id": "review-helper",
      "version": "2.1.0",
      "path": "skills/review-helper",
      "title": "Review Helper",
      "description": "Helps review code changes.",
      "supportedAgents": ["codex", "claude"],
      "requires": [{"id": "git-basics", "version": "^1.4.0"}]
    },
    {
      "id": "git-basics",
      "version": "1.5.0",
      "path": "skills/git-basics",
      "title": "Git Basics",
      "description": "Provides Git fundamentals.",
      "supportedAgents": ["codex", "claude"]
    }
  ],
  "bundles": [
    {
      "id": "review-workflow",
      "version": "1.0.0",
      "title": "Review Workflow",
      "description": "A maintained code-review composition.",
      "skills": [{"id": "review-helper", "version": "~2.1.0"}],
      "tags": ["review"],
      "keywords": ["quality gate"]
    }
  ]
}
```

Registry v3 rules:

- every skill and bundle has a canonical full SemVer; leading `v`, partial versions, surrounding
  whitespace, and loose cleanup forms are rejected, while canonical prerelease/build metadata is
  allowed;
- `requires` is an array of strict `{id, version}` objects, where `version` accepts exact, caret,
  tilde, and comparator-set ranges; `recommends` and `conflictsWith` remain local ID arrays;
- `bundles` is required and may be `[]`; a bundle requires `id`, `version`, `title`, `description`,
  and at least one member in `skills`, with optional bounded `tags` and `keywords`;
- bundle titles are at most 64 characters, descriptions at most 280, and each bundle contains at
  most 32 members so catalog responses remain bounded;
- bundles are catalog compositions only: they have no `path`, `SKILL.md`, link target, or
  filesystem operation of their own;
- every dependency and bundle member must resolve to a skill in the same registry and satisfy its
  declared range; unknown targets and mismatches are blocking validation errors;
- bundle IDs are unique, and member IDs are unique within a bundle;
- bundle members are unqualified local skill IDs. Cross-skillpack members, bundle-to-bundle
  members, and nested bundles are unsupported and require a future registry version.

The declared SemVer and the skillpack revision have different jobs. SemVer communicates the
maintainer's compatibility and upgrade intent for a logical skill or bundle. The immutable Git
commit remains the exact physical lock for every file in the active snapshot. Corvus is not a
multi-version package solver and SemVer never replaces that commit lock.

Selecting a bundle stores a qualified bundle **root** in Manager Config v3. Corvus derives the
effective linkable skills from explicit skill roots, bundle members, and transitive hard
dependencies. It links only skill directories; a bundle has no runtime and does not execute a
workflow. Removing a bundle root recomputes effective skills instead of decrementing persisted
reference counts, so shared members and dependencies remain while another root still implies
them. The manifest records only manager-owned links, never bundle provenance.

**Case-normalization rule.** Classification tokens (`tags`, `domains`, `tasks`, `languages`,
`technologies`, `platforms`, `keywords`) are trimmed, lowercased, and have internal whitespace
runs collapsed to a single space. Duplicates after normalization are removed, keeping the first
occurrence. `useCases` and `nonGoals` keep their authored casing but are deduplicated
case-insensitively. Skill IDs are compared exactly. Omitted arrays normalize to `[]`, so
consumers never have to handle `undefined`.

### Migrating legacy registries

1. Change `"version": 1` to `"version": 2`. Nothing else is required — v2 with no semantic
   fields behaves exactly like v1.
2. Add semantic metadata per skill, **by inspecting each skill's `SKILL.md`**. Do not infer
   metadata from file names alone; wrong metadata is worse than absent metadata because it
   makes search confidently incorrect.
3. Prefer a few accurate tokens over many speculative ones. `domains` and `tasks` carry the most
   search weight, followed by `languages`/`technologies`/`platforms`, then `keywords`/`tags`.
4. Use `nonGoals` for skills that are easily confused with a neighbouring domain — it actively
   demotes the skill for unrelated queries.
5. Declare `requires` only for genuine hard dependencies; use `recommends` for everything else.
6. Validate before committing:

   ```bash
   corvus-skills skills validate-registry --json
   ```

   The command is read-only and reports the registry version, invalid entries, missing semantic
   metadata, unknown relationship targets, cycles, per-field coverage statistics, versioned-skill
   and bundle counts, valid bundle membership counts, and actionable v3 range mismatches. It is
   suitable for skillpack CI.

While a registry still declares `version: 1` but an entry uses v2 fields, discovery accepts the
entry and emits a `semantic-metadata-in-v1-registry` warning asking for the version bump.

To adopt Registry v3 from either v1 or v2:

1. Give every skill a canonical full `version` chosen by the skillpack maintainer.
2. Convert every hard dependency to `{ "id": "<local-skill-id>", "version": "<range>" }`.
   `recommends` and `conflictsWith` remain arrays of local skill IDs.
3. Add a `bundles` array, using `[]` when the skillpack has no maintained compositions. Give
   every bundle a canonical version and at least one version-ranged skill member.
4. Change the registry discriminator to `"version": 3`, validate, and compare the candidate
   against the previous Registry v3 revision with `skills check-version-discipline` in CI.

Registry v1/v2 remain supported and are never rewritten by Corvus. The complete checklist and
CI examples are in [`skillpack-registry-migration.md`](skillpack-registry-migration.md).

The manager never writes to `registry.json` or to skill files. Migration happens in the
skillpack repository, by its maintainers.

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

Fallback-discovered skills default to Codex support and receive the `registryless` tag. All v2
semantic and relationship arrays are empty for fallback-discovered skills, so they are still
listable and inspectable but rank low in intent-based search.
