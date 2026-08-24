Timestamp: 2026-08-24T17:49:36Z
Version: v1.0.0

# Spec: Registry v3 Bundles and Versioning

## Summary

Corvus will add first-class, versioned bundles while preserving individual skills and skillpacks
as distinct concepts. Registry v3 gives every skill and bundle a semantic version, persists what
the user explicitly selected as roots, and derives the effective linked skills deterministically.
The feature is available through the TUI and machine interface without weakening immutable
skillpack, read-only, or plan-then-apply guarantees.

## Motivation

Users need to select a useful composition such as a complete development workflow without
manually discovering every member and dependency. Skillpack maintainers and calling agents also
need compatibility and upgrade meaning finer than a raw Git commit, while retaining the commit as
the exact reproducibility boundary.

## Affected Layers

- **Core domain logic (`packages/core/src/`) — modified:** registry parsing, discovery,
  relationship validation, selection resolution, config/lock read models, and link-planning
  inputs gain versioned bundle semantics.
- **Application layer (`packages/core/src/application/`) — modified:** read models, install
  contracts, persisted plans, verification, and update comparison expose the same root/effective
  model to both adapters.
- **Ink TUI adapter (`packages/tui/`) — modified:** humans can inspect and select bundles and see
  provenance-rich previews before the existing approval step.
- **Machine CLI adapter (`packages/cli/`) — modified:** transport exposes bundle discovery and
  selection through versioned deterministic JSON contracts; it gains no business logic.
- **Skillpack snapshots — read-only:** registries and skill files are inspected but never mutated
  by Corvus.
- **Repository documentation — modified:** architecture and public contracts define Registry v3,
  bundle composition, migration, and version semantics.

## Reference Documents

- `AGENTS.md` — TUI-first direction; shared application layer; immutable skillpacks; manager write
  boundaries; deterministic plan-then-apply; side-effect-free read operations.
- `CLAUDE.md` — package dependency direction, application/domain ownership, revision layout,
  path safety, and verification commands.
- `architecture.md` — adapter/application/domain boundaries, manager state, immutable revisions,
  and link planning/apply invariants.
- `docs/agent-native-architecture.md` — shared use cases, deterministic machine contracts,
  adapter responsibilities, and durable plan confirmation.
- `docs/skillpack-contract.md` — Registry v1/v2 compatibility, registry normalization,
  relationship behavior, and read-only skillpack rules.
- `docs/semantic-registry.md` — deterministic search, hard dependency expansion,
  recommendations, and conflicts.
- `docs/CORVUS_BUNDLES_VERSIONING_IMPLEMENTATION_TASKS.md` — frozen design decisions and ordered
  implementation scope for `CSM-BND-001` through `CSM-BND-042`.
- Current registry/config/install/plan schemas and tests — observed v1/v2 compatibility,
  qualified skill references, request normalization, persisted plan digests, state fingerprints,
  confirmation, and unmanaged-link protections.

## Functional Requirements

### Normative terminology

- A **skill** is a linkable capability stored as a directory containing `SKILL.md` and described
  by one registry skill entry.
- A **bundle** is a named, versioned composition of skills in one Registry v3 skillpack. A bundle
  is selectable catalog metadata; it has no path, `SKILL.md`, link target, or runtime of its own.
- A **skillpack** is a repository/distribution source captured as an immutable Git revision
  snapshot. It is not a bundle and is not an npm/workspace package.
- A **root selection** is explicit user intent: an individually selected skill or selected
  bundle. Only roots are persisted in Manager Config v3.
- An **effective selection** is the deduplicated set of linkable skills derived for one agent
  from root skills, bundle members, and transitive hard dependencies.
- A **dependency** is a skill named by another skill's `requires` field. Dependencies are
  technical requirements; bundle membership is composition and does not imply `requires` in
  either direction.

These terms are normative. Public docs, TUI labels, machine fields, errors, and implementation
names must not use `package`, `skillpack`, `workflow`, or `dependency` as substitutes for
`bundle`.

### Registry versions and semantic versions

- Registry v1 and v2 remain readable with their existing meaning and do not gain mandatory skill
  versions or bundles.
- Registry v3 requires every skill and bundle to declare a canonical Semantic Versioning 2.0.0
  version. A leading `v`, omitted minor/patch component, surrounding whitespace, or other loose
  syntax is invalid. Canonical prerelease and build metadata are allowed.
- Registry v3 hard dependencies use `{ "id": <local-skill-id>, "version": <semver-range> }`.
  Exact versions, caret ranges, tilde ranges, and comparator sets are supported. Registry v1/v2
  `requires` remains an array of local skill ID strings.
- Registry v3 `recommends` and `conflictsWith` remain arrays of local skill IDs. They do not select
  versions and preserve their existing non-installing/symmetric behavior.
- A version constraint is tested against the one skill version present in the active immutable
  snapshot. A missing target or unsatisfied hard-dependency constraint is a blocking validation
  error; Corvus never chooses or fetches another version.
- Skill and bundle SemVer communicates authored compatibility and upgrade significance. The
  active skillpack Git commit remains the exact content lock and physical reproducibility
  boundary. A semantic version never replaces, weakens, or redirects that lock.
- Major/minor/patch/same update classification follows the declared versions only. Corvus may
  report a likely breaking risk for a major change, but it does not infer the correct next
  version or approve an update.

### Bundle contract

- Registry v3 may contain zero or more bundles. Each bundle requires `id`, `version`, `title`,
  `description`, and a non-empty `skills` array.
- Each bundle member is `{ "id": <local-skill-id>, "version": <semver-range> }` and must name a
  skill in the same registry whose declared version satisfies the range.
- Bundle and skill IDs use the existing safe local identifier rules. Bundle members are
  unqualified local skill IDs; a `<skillpack-id>:<skill-id>` member is invalid.
- Bundle IDs are unique within the registry, and members are unique within a bundle after
  normalization. Validation errors are deterministic and identify the bundle, member, requested
  range, and actual version where applicable.
- Bundle catalog metadata may include bounded `tags` and `keywords` using the same canonical
  token rules as skill catalog metadata. Unknown fields are rejected.
- Bundles cannot contain bundles. Cross-skillpack members and nested bundles require a future
  registry version.
- Bundle membership never creates a filesystem operation for the bundle itself and never turns
  the bundle into an executable workflow. Orchestration belongs in an ordinary skill which a
  bundle may include.

### Root and effective selection

- Manager Config v3 stores qualified root skill references in `selectedSkillIds` and qualified
  root bundle references in `selectedBundleIds`, independently for each agent.
- Config v3 never persists the dependency-expanded or bundle-expanded effective skill set.
- Resolution starts with explicit skill roots and direct members of bundle roots, then expands
  transitive `requires` breadth-first. Output and diagnostics are canonical and deterministic.
- Overlapping roots produce one effective skill while retaining every applicable provenance
  path: explicit, bundle member, and dependency-of.
- Every effective skill must support the target agent. An incompatible bundle member or
  transitive dependency blocks that bundle's plan for the agent; Corvus never silently installs
  a compatible subset.
- Conflict checks operate on the final effective set. Recommendations are surfaced but never
  selected automatically.
- Removing a root recomputes the entire effective set. A skill remains linked while any remaining
  root still implies it, and a link is removable only when no root implies it and the manifest
  records it as manager-owned.
- `allCompatible` continues to select all compatible individual skills only. It never selects,
  expands, or persists bundles implicitly.

### Migration guarantees

- Registry v1/v2 files are parsed in place and remain read-only. Corvus does not rewrite them to
  v3, infer missing semantic versions, or synthesize bundles.
- Config v1/v2 `selectedSkillIds` values normalize in memory to Config v3 explicit/root skill
  selections using the existing qualification rules. `selectedBundleIds` initializes to `[]`.
- A read-only operation never persists an in-memory config migration or creates default manager
  state. A later confirmed write may persist the normalized Config v3 representation.
- Migration is deterministic and idempotent. Every formerly selected skill remains a root even
  if an older planner originally selected it as a derived dependency; migration cannot safely
  reconstruct intent that was not stored.
- `manifest.json` remains a filesystem-ownership ledger. It does not store bundle selection,
  dependency provenance, package metadata, or semantic versions.
- The lock continues to identify immutable skillpack commits/revisions. Semantic versions may be
  reported alongside comparisons but do not change lock ownership.

### Shared workflow and safety

- Bundle discovery, compatibility, root/effective resolution, planning, verification, and update
  comparison live in core/application code shared by the TUI and machine adapter.
- Running `corvus-skills` without arguments continues to launch the Ink TUI. Machine JSON support
  does not replace or bypass the human interface.
- Every write-capable bundle operation produces a persisted digest-identified plan, requires an
  exact confirmation token, and revalidates a state fingerprint immediately before mutation.
- Plan payloads distinguish root skills, root bundles, effective skills, provenance, config
  changes, and link operations. Decision-relevant registry versions, bundle definitions, and
  selected roots participate in deterministic digest/fingerprint contracts.
- Read-only bundle list/search/inspect/status/verify/update-check operations perform no writes,
  including no implicit config creation or migration persistence.
- Skillpack registries, skill directories, active checkouts, and existing revision snapshots are
  never edited, repaired, formatted, pulled, reset, committed, pushed, or overwritten.
- The manager never overwrites unmanaged targets and removes only manifest-owned links.
- Corvus remains deterministic and contains no embedded LLM, semantic chooser, backend, Express
  service, MCP adapter, secret requirement, or external paid service.

### Normative Registry examples

Registry v1 remains valid and unversioned:

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

Registry v2 remains valid with string-valued relationships and no bundle collection:

```json
{
  "version": 2,
  "skills": [
    {
      "id": "review-helper",
      "path": "skills/review-helper",
      "title": "Review Helper",
      "description": "Helps review code changes.",
      "supportedAgents": ["codex", "claude"],
      "domains": ["code-quality"],
      "requires": ["git-basics"],
      "recommends": ["test-helper"],
      "conflictsWith": []
    },
    {
      "id": "git-basics",
      "path": "skills/git-basics",
      "title": "Git Basics",
      "description": "Provides Git fundamentals.",
      "supportedAgents": ["codex", "claude"]
    }
  ]
}
```

Registry v3 requires skill and bundle versions and versioned hard references:

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
      "domains": ["code-quality"],
      "requires": [{"id": "git-basics", "version": "^1.4.0"}],
      "recommends": ["test-helper"],
      "conflictsWith": []
    },
    {
      "id": "git-basics",
      "version": "1.5.0",
      "path": "skills/git-basics",
      "title": "Git Basics",
      "description": "Provides Git fundamentals.",
      "supportedAgents": ["codex", "claude"]
    },
    {
      "id": "test-helper",
      "version": "3.0.0-beta.1",
      "path": "skills/test-helper",
      "title": "Test Helper",
      "description": "Helps design focused tests.",
      "supportedAgents": ["codex", "claude"]
    }
  ],
  "bundles": [
    {
      "id": "review-workflow",
      "version": "1.0.0",
      "title": "Review Workflow",
      "description": "A maintained code-review composition.",
      "skills": [
        {"id": "review-helper", "version": "~2.1.0"},
        {"id": "test-helper", "version": ">=3.0.0-beta.1 <4.0.0"}
      ],
      "tags": ["review"],
      "keywords": ["quality gate"]
    }
  ]
}
```

### Normative Manager Config examples

Config v2 stores qualified skill selections. During migration every listed skill becomes an
explicit root:

```json
{
  "version": 2,
  "managerStateDir": "/home/example/.agents/corvus-skill-manager",
  "createdAt": "2026-08-01T10:00:00.000Z",
  "updatedAt": "2026-08-01T10:00:00.000Z",
  "skillpacks": {
    "team": {
      "id": "team",
      "repositoryUrl": "https://example.test/team-skills.git",
      "branch": "main",
      "checkoutPath": "/home/example/.agents/skillpacks/team/current"
    }
  },
  "agents": {
    "codex": {
      "enabled": true,
      "selectedSkillIds": ["team:review-helper", "team:git-basics"]
    }
  }
}
```

Migrating the Config v2 example above retains both listed skills as roots and initializes
`selectedBundleIds` to `[]`; migration does not guess their original provenance. Separately, a
newly authored or explicitly changed Config v3 stores root skills and root bundles independently.
In this bundle-only example, `git-basics` is omitted because it is an effective dependency rather
than a root:

```json
{
  "version": 3,
  "managerStateDir": "/home/example/.agents/corvus-skill-manager",
  "createdAt": "2026-08-01T10:00:00.000Z",
  "updatedAt": "2026-08-24T17:49:36.000Z",
  "skillpacks": {
    "team": {
      "id": "team",
      "repositoryUrl": "https://example.test/team-skills.git",
      "branch": "main",
      "checkoutPath": "/home/example/.agents/skillpacks/team/current"
    }
  },
  "agents": {
    "codex": {
      "enabled": true,
      "selectedSkillIds": [],
      "selectedBundleIds": ["team:review-workflow"]
    }
  }
}
```

## In Scope

- Registry v3 skill and bundle schema semantics.
- Mandatory canonical SemVer for v3 skills and bundles and ranges for hard dependencies and
  bundle members.
- Same-skillpack, non-nested bundle composition.
- Config v3 root skills/root bundles and deterministic effective selection derivation.
- Backward-compatible reads and in-memory migration for Registry v1/v2 and Config v1/v2.
- Bundle-aware shared application behavior, TUI, machine JSON, plan/apply/verify, and read-only
  semantic update intelligence.
- Maintainer validation for version discipline without automatically choosing version bumps.

## Out of Scope

- Nested bundles or bundle-to-bundle membership.
- Cross-skillpack bundle members.
- Selecting among or downloading multiple versions of a skill.
- Replacing the immutable skillpack commit/revision lock with SemVer.
- Executing a bundle as a workflow or adding runtime orchestration to bundles.
- Automatically selecting recommended skills or inferring bundle membership from intent.
- Persisting effective selections, reference counts, bundle provenance, or versions in the
  manifest.
- An embedded LLM, AI API key, backend, Express service, MCP adapter, marketplace, telemetry, or
  paid external service.
- Any mutable operation against an active skillpack checkout or existing revision snapshot.

## Acceptance Criteria

- The normative terminology and examples above remain the source of truth for later bundle tasks.
- Registry v1 and v2 examples remain readable with existing semantics; neither requires skill
  versions or a `bundles` field.
- Registry v3 rejects an unversioned skill/bundle, unknown or duplicate member, invalid range,
  cross-skillpack member, nested bundle representation, and unsatisfied member/dependency range.
- Config v1/v2 migration retains every selected skill as a root and initializes empty bundle
  roots without writing during reads.
- Config v3 stores only root skill and bundle references; effective skills are reproducibly
  derived and provenance is explainable.
- SemVer reports compatibility/upgrade meaning while the Git commit remains the exact physical
  lock.
- Bundle planning is atomic per agent, deterministic, shared by both adapters, and cannot bypass
  persisted preview plus exact confirmation.
- `allCompatible` never selects bundles, the manifest stays an ownership ledger, and active
  skillpacks remain immutable.
- `pnpm typecheck` and `pnpm test` pass after this documentation-only contract task.

## Edge Cases

- A Registry v3 file contains no bundles: skills remain individually discoverable and linkable.
- A bundle has no members, duplicate members, an unknown member, a qualified member ID, or a
  range not satisfied by the snapshot: registry validation blocks use with stable details.
- Two skillpacks use the same local bundle or skill ID: manager-level root references remain
  qualified and do not collide.
- Two bundles overlap or an explicit root is also a bundle member: the effective skill is
  deduplicated while all provenance is retained.
- A shared dependency is still required after one root is removed: it remains effective and its
  manager-owned link is retained.
- A bundle member or transitive dependency does not support a target agent: the plan is blocked
  rather than partially installing the bundle.
- Registry v1/v2 or registryless discovery has no semantic versions: it remains usable through
  legacy individual-skill flows and reports semantic update data as unversioned/unknown.
- A read-only command encounters Config v1/v2: normalization occurs in memory only.
- A plan is stale because config, active commit, registry, roots, or target state changed: apply
  rejects it and requires a newly previewed plan.

## Risks and Constraints

- **Security:** registry IDs, paths, ranges, and persisted plan IDs are untrusted input. Existing
  strict schemas, path containment checks, immutable snapshot rules, state fingerprints, exact
  confirmation, and unmanaged-target protection remain mandatory.
- **Performance:** expansion and validation must be deterministic and bounded by registry limits.
  No network access or version download occurs during selection resolution.
- **Architectural:** the largest risk is duplicated resolution logic in adapters or confusing
  roots with effective links. Core/application owns the model; TUI/CLI only present or transport
  it, and the manifest remains link-only.
- **Operational:** legacy config cannot reveal why an old skill was selected. Conservatively
  treating every migrated selection as a root prevents accidental removals at the cost of
  retaining some formerly derived skills until the user changes roots explicitly.
- **Compatibility:** persisted request, config, plan, and protocol contracts must be versioned
  when their meaning changes; old artifacts must never acquire ambiguous new semantics.

## Open Questions

None. The frozen decisions in the implementation task list and existing repository invariants
answer all architecture-level questions required for implementation.

## Testing Guidelines

- Unit-test strict SemVer parsing/ranges/change classification, Registry v1/v2/v3 schemas,
  bundle membership validation, config migration, root/effective resolution, compatibility,
  provenance, conflicts, and deterministic ordering.
- Test persisted plan digests, state fingerprints, stale/tampered/unconfirmed rejection,
  read-only no-write behavior, unmanaged target protection, and manifest-owned removal safety.
- Exercise TUI and machine adapters against the same application-layer bundle scenarios,
  including bundle inspection, mixed roots, incompatible members, preview, apply, removal, and
  verification.
- Retain representative Registry v1/v2 fixtures alongside Registry v3 bundles, overlapping
  members, transitive dependencies, recommendations, conflicts, and duplicate local IDs across
  skillpacks.
- Run `pnpm typecheck` and `pnpm test` for every task; use targeted Vitest suites first when
  runtime behavior changes.
