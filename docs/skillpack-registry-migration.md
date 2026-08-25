# Skillpack Registry Migration: v1/v2 to v3

For maintainers of a skillpack repository, including the default `xiero/skill-collection`.

**Scope boundary.** Corvus Skill Manager provides the contract, validator, comparison tooling,
and fixtures. It never writes to `registry.json`, skill files, or an active/existing skillpack
snapshot. Registry edits belong to the skillpack repository and its maintainers.

## Choose the target contract

- Stay on **v1** when only the original skill catalog fields are needed.
- Adopt **v2** for optional semantic search metadata and unversioned local relationships without
  bundles.
- Adopt **v3** for canonical skill versions, version-ranged hard dependencies, and maintained
  skill bundles. Registry v3 is the current authoring contract.

All three versions remain readable. Corvus never rewrites v1/v2 files to v3. Registry migration
does not migrate the physical snapshot: the immutable skillpack Git commit remains the exact
file lock, while skill/bundle SemVer communicates compatibility and upgrade meaning.

## Optional v1 to v2 step

Change `"version": 1` to `"version": 2`; no other field is required. Then add only metadata you
can defend by reading each skill's `SKILL.md`:

| Field | Question it answers |
|---|---|
| `domains` | What problem area is this? |
| `tasks` | What does it help the agent do? |
| `languages` | Which programming languages does it assume? |
| `technologies` | Which tools, frameworks, or libraries? |
| `platforms` | Which runtime or target environment? |
| `keywords` | Which search terms are not covered elsewhere? |
| `useCases` | When should an agent select this skill? |
| `nonGoals` | Which plausible query should not select it? |

Prefer a few accurate tokens over speculative coverage. Establish one token vocabulary across
the pack (`cpp` versus `c++`, for example), prioritise ambiguous skills, and use `nonGoals` to
demote near-misses. Use `requires` only for hard dependencies, `recommends` for advisory
companions, and `conflictsWith` for combinations that must be blocked.

## v1 or v2 to v3 checklist

1. **Inventory every skill and relationship.** Confirm that every registry path stays relative,
   contained in the snapshot, and points to a directory with `SKILL.md`. Resolve unknown hard
   dependencies and cycles before assigning versions.

2. **Choose canonical skill versions.** Add a full Semantic Versioning 2.0.0 `version` to every
   skill. Values such as `v1.0.0`, `1`, `1.0`, loose whitespace, and cleanup forms are invalid.
   Canonical prerelease and build metadata are allowed.

3. **Version hard dependencies.** Convert each v1/v2 string in `requires` to a same-registry
   object:

   ```json
   {
     "requires": [{"id": "git-basics", "version": "^1.4.0"}]
   }
   ```

   Exact versions, caret ranges, tilde ranges, and comparator sets are supported. The range must
   match the dependency version in this one immutable snapshot. `recommends` and
   `conflictsWith` remain arrays of local skill IDs.

4. **Author maintained bundles.** Add the required top-level `bundles` array; use `[]` when no
   compositions are warranted. A bundle needs a unique local `id`, canonical `version`, `title`,
   `description`, and one or more version-ranged skill members:

   ```json
   {
     "id": "review-workflow",
     "version": "1.0.0",
     "title": "Review Workflow",
     "description": "A maintained code-review composition.",
     "skills": [
       {"id": "review-helper", "version": "~2.1.0"},
       {"id": "git-basics", "version": "^1.4.0"}
     ],
     "tags": ["review"],
     "keywords": ["quality gate"]
   }
   ```

   Bundle members are skills in the same registry. Nested bundles, qualified/cross-skillpack
   members, and empty bundles are invalid. A bundle has no path, `SKILL.md`, link target, or
   executable workflow; it is a versioned composition only. Recommendations are never promoted
   into members automatically.

5. **Change the discriminator last.** After every skill and bundle satisfies v3, set the
   top-level registry `"version"` to `3`. This avoids temporarily presenting a partially
   migrated file as valid v3.

6. **Validate the complete registry.** Against a configured checkout, run:

   ```bash
   corvus-skills skills validate-registry --json
   ```

   The read-only report includes invalid entries, semantic coverage, versioned-skill and bundle
   counts, valid membership counts, unknown targets, cycles, and actionable dependency/member
   range mismatches.

7. **Spot-check discovery and compatibility.** Search skills and bundles independently, then
   inspect a bundle for actual member versions and per-agent compatibility:

   ```bash
   corvus-skills skills search --query "embedded firmware c cpp cmake stm32" --json
   corvus-skills bundles search --query "embedded workflow" --agent codex --json
   corvus-skills bundles inspect review-workflow --json
   ```

8. **Enforce version discipline in CI.** Once both sides are Registry v3, compare the previous
   and candidate checkout roots:

   ```bash
   corvus-skills skills check-version-discipline \
     --base ./previous-revision --candidate . --json
   ```

   The default error severity fails when an existing skill's registry metadata or complete
   directory content changes without moving its SemVer precedence, or bundle metadata/membership
   changes without doing so. `--severity warning` supports an advisory rollout. Corvus reports
   the entity but never chooses patch, minor, or major.

## Manager config migration

Registry migration does not require hand-editing manager state. Config v1/v2 remains readable
and normalizes in memory to Config v3. Every legacy `selectedSkillIds` value becomes an explicit
skill root and every migrated agent starts with no bundle roots. Read-only commands do not write
that normalized form back. Only a separately planned and confirmed manager write may persist
Config v3.

Config v3 stores explicit/root skills and bundles, not the effective set. Corvus derives
effective skills from those roots, bundle members, and transitive hard dependencies. Removing a
bundle root recomputes the set, retaining any shared skill still implied by another root. The
manifest remains a manager-owned link ledger and does not store versions or bundle provenance.

## Validation rules to expect

- Unknown fields are rejected in every registry version.
- Classification tokens are bounded, canonicalized, and deduplicated; prose fields remain
  bounded and preserve authored casing.
- Registry v3 rejects missing/noncanonical versions, invalid/unsatisfied ranges, unknown or
  duplicate members, cross-pack/nested bundle representations, empty bundles, and invalid hard
  dependency graphs.
- Missing `recommends` targets remain warnings; missing hard dependencies and conflicts are
  blocking findings.
- `validate-registry`, catalog/search/inspect, version-discipline comparison, Status, and Doctor
  are read-only and do not create default manager state.

## Follow-up for `xiero/skill-collection`

The default skillpack's migration remains a separate repository change. When its maintainers
choose Registry v3:

- [ ] Read every `SKILL.md` and agree the semantic token vocabulary.
- [ ] Assign a canonical version to every skill.
- [ ] Convert every hard dependency to a satisfiable versioned local reference.
- [ ] Author only bundles with a clear maintained composition and compatibility promise.
- [ ] Add validation and version-discipline commands to that repository's CI.
- [ ] Spot-check skill search, bundle search, bundle inspection, and supported-agent filtering.

Until then, manager tests use deterministic shared v1/v2/v3 fixtures under `test/support/`.
They cover overlapping bundles, transitive dependencies, recommendations, conflicts, and
duplicate local IDs without reading or mutating an external skillpack checkout.
