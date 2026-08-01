# Skillpack Registry Migration: v1 to v2

For maintainers of a skillpack repository, including the default
`xiero/skill-collection`.

**Scope boundary.** Corvus Skill Manager provides the contract, the validator, fixtures, and
this guide. It never writes to `registry.json` or to skill files. The metadata edits themselves
belong in the skillpack repository and require its checkout.

## Why migrate

Registry v1 gives an agent only titles, descriptions, and `supportedAgents`. That is enough to
install a skill the user names, but not enough to answer "install a balanced set for embedded
development" without guessing. v2 adds the semantic metadata that makes intent-based selection
accurate and explainable — see [`semantic-registry.md`](semantic-registry.md).

## Checklist

1. **Bump the version.** Change `"version": 1` to `"version": 2` in `registry.json`. Nothing
   else is required; v2 with no semantic fields behaves exactly like v1. Validate:

   ```bash
   corvus-skills skills validate-registry --json
   ```

2. **Establish a token vocabulary first.** Before tagging anything, decide the canonical spelling
   for each recurring token across the whole skillpack — `cpp` not `c++`, `node` not `nodejs`,
   `bare-metal` not `baremetal`. Values are normalized (trimmed, lowercased, whitespace
   collapsed) and deduplicated, but near-synonyms stay distinct and split search weight.

3. **Tag one skill at a time, reading its `SKILL.md`.** For each skill fill in what you can
   defend from the file's actual content:

   | Field | Question it answers |
   |---|---|
   | `domains` | What problem area is this? (`embedded`, `web`, `testing`, `documentation`) |
   | `tasks` | What does it help you *do*? (`code-review`, `driver-development`) |
   | `languages` | Which languages does it assume? |
   | `technologies` | Which tools, frameworks, or libraries? |
   | `platforms` | Which runtime or target environment? |
   | `keywords` | Search terms not covered above. |
   | `useCases` | One-sentence "use this when…" statements. |
   | `nonGoals` | One-sentence "this is *not* for…" statements. |

   **Do not fabricate metadata from filenames alone.** A skill you cannot confidently tag should
   be left untagged: it will still list and inspect correctly, and will simply rank low in
   intent-based search. Wrong metadata is worse than absent metadata.

4. **Prioritise by ambiguity, not by alphabet.** Tag first the skills most likely to be confused
   with a neighbouring domain, and give them `nonGoals`. That single field removes more false
   positives than any amount of extra `keywords`.

5. **Declare relationships.** Use `requires` only for genuine hard dependencies — installing the
   skill will install those too, automatically. Use `recommends` for "works well with"; it is
   surfaced to the calling agent and never installed automatically. Use `conflictsWith` for
   skills that must not be installed together.

6. **Validate and track coverage.**

   ```bash
   corvus-skills skills validate-registry --json
   ```

   The report includes `coverage` (per-field counts and whole-percent figures),
   `skillsMissingSemanticMetadata`, `unknownRelationshipTargets`, `requiredDependencyCycles`, and
   `invalidEntries`. It is read-only and suitable for skillpack CI.

7. **Spot-check the result with real queries.**

   ```bash
   corvus-skills skills search --query "embedded firmware c cpp cmake stm32" --json
   corvus-skills skills search --query "react node typescript web api" --json
   ```

   Inspect `matchedFields` and `matchedTerms` on each result. If something ranks highly for the
   wrong reason, the metadata is wrong — fix the metadata rather than the query.

## Validation rules to expect

- Every value must be a non-empty, trimmed string. Leading and trailing whitespace is rejected
  rather than silently fixed, so registry files stay canonical.
- Classification tokens are at most 64 characters; `useCases` and `nonGoals` at most 280.
- Token and relationship arrays hold at most 32 entries; prose arrays at most 16.
- Unknown fields are rejected in both versions, so a misspelled `domain` or `recommend` fails
  loudly instead of being ignored.
- `requires` and `conflictsWith` must reference skills that exist in the same registry. Missing
  targets are blocking errors; missing `recommends` targets are warnings.
- A skill may not require or conflict with itself, and cycles in `requires` are rejected.

## Follow-up for `xiero/skill-collection`

The default skillpack's own migration is **deferred**: it requires that repository's checkout
and is not part of this repository's work. When it is undertaken:

- [ ] Bump `registry.json` to `"version": 2`.
- [ ] Agree the token vocabulary across the collection before tagging.
- [ ] Tag every skill by reading its `SKILL.md`, ambiguous skills first.
- [ ] Add `nonGoals` to every skill that spans or borders two domains.
- [ ] Declare `requires` / `recommends` / `conflictsWith` where they genuinely apply.
- [ ] Add `corvus-skills skills validate-registry --json` to that repository's CI.
- [ ] Spot-check embedded, web, testing, and documentation queries against the migrated registry.

Until then, the manager's own tests run against the representative v2 fixtures in
`test/support/skillpackFixtures.ts`, so intent-based discovery is exercised without depending on
any external repository.
