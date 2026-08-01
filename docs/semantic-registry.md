# Semantic Registry

Registry v2 adds optional semantic metadata and skill relationships so a coding agent can turn a
broad intent — "a balanced set for embedded development" — into exact skill IDs without guessing
from file names.

The schema itself is specified in [`skillpack-contract.md`](skillpack-contract.md). This document
covers how the metadata is *used*, and how to author it well.

## Why it exists

Without semantic metadata, an agent asked for "embedded development skills" can only match
against titles and descriptions. That produces confident-looking nonsense: a skill called
"Driver Development" might be about device drivers or about developing drivers for a test
harness. `domains`, `tasks`, `languages`, `technologies`, and `platforms` make the distinction
explicit and machine-checkable.

Corvus does not interpret this metadata semantically. It scores it lexically and deterministically,
and returns the score plus the fields and terms that matched. **The calling agent makes the
selection.** There is no LLM, no embedding model, and no network call anywhere in this path.

## How search ranks

`skills search --query "<terms>"` normalizes the query into terms and scores each skill by
summing field weights:

| Field | Weight | Rationale |
|---|---:|---|
| whole query equals skill id or title | +250 | An exact identity match should always win. |
| `id` | 100 | The id is the most precise identifier. |
| `title` | 60 | Human-facing name. |
| `domains`, `tasks` | 40 | The strongest intent signal. |
| `languages`, `technologies`, `platforms` | 25 | Narrows within a domain. |
| `keywords`, `tags` | 15 | Free-form catch-all. |
| `description`, `useCases` | 8 | Prose; weak but useful. |
| `nonGoals` | **−30** | Negative signal: actively demotes the skill. |

A match on a whole normalized value scores the full weight; a match on one of its sub-tokens
(`stm32` inside `stm32f4-hal`) scores half, rounded toward zero so negative signals stay
negative. Skills scoring zero or less are excluded.

Results are ordered by descending score with **skill id as the stable tie-breaker**, so repeated
searches over the same snapshot return byte-identical JSON. Every result carries `score`,
`matches`, `matchedFields`, and `matchedTerms`, so both you and the user can see *why* something
ranked where it did.

`--limit` is bounded to 1–100 (default 20); anything outside that is rejected rather than
silently clamped. `--agent <id>` restricts results to skills that declare support for that agent.

## Relationships

| Field | Behaviour |
|---|---|
| `requires` | Expanded transitively at plan time. Added skills carry the reason `dependency-of:<skill-id>`. A missing target is a blocking error; cycles are rejected at discovery. |
| `recommends` | Surfaced as a `recommendation-not-selected` warning. **Never installed automatically** — offering it to the user is the agent's job. |
| `conflictsWith` | Treated symmetrically. Two conflicting skills in one selection block planning with `SKILL_CONFLICT`. |

Dependency expansion is breadth-first over the requested order and tracks visited ids, so it is
deterministic and terminates even on a malformed cyclic registry.

## Authoring guidance for skillpack maintainers

1. **Inspect each skill's `SKILL.md` before tagging it.** Do not infer metadata from directory
   names. Wrong metadata is worse than absent metadata, because it makes search confidently
   incorrect rather than merely unhelpful.
2. **Prefer few accurate tokens over many speculative ones.** `domains` and `tasks` carry the
   most weight; a wrong domain does real damage.
3. **Use `nonGoals` for near-misses.** If a skill is routinely confused with a neighbouring
   domain, saying so demotes it for those queries. This is the highest-leverage field for a
   skillpack that spans several domains.
4. **Reserve `requires` for hard dependencies.** If a skill merely works better alongside
   another, that is `recommends`.
5. **Keep tokens conventional.** Values are normalized (trimmed, lowercased, internal whitespace
   collapsed) and deduplicated, but `c++` and `cpp` are still two different tokens. Pick one and
   use it consistently across the skillpack.
6. **Validate in CI.**
   ```bash
   corvus-skills skills validate-registry --json
   ```
   The command is read-only. It reports the registry version, invalid entries, unknown
   relationship targets, required-dependency cycles, skills with no semantic metadata at all,
   and per-field coverage statistics.

## Migration

A v1 registry stays valid with no edits. To adopt v2:

1. Change `"version": 1` to `"version": 2`. Nothing else is required.
2. Add metadata per skill, incrementally. Coverage statistics from `validate-registry` show
   progress.

While a registry still declares `version: 1` but an entry uses v2 fields, discovery accepts the
entry and emits a `semantic-metadata-in-v1-registry` warning asking for the version bump.

**The manager never writes to `registry.json` or to skill files.** Migration happens in the
skillpack repository, by its maintainers. See
[`skillpack-registry-migration.md`](skillpack-registry-migration.md) for the checklist.
