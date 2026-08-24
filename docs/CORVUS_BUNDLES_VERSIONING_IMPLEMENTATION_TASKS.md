# Corvus Skill Manager — Registry v3, Bundles & Versioning
## Codex-ready sequential implementation task list

**Repository:** `xiero/corvus-skill-manager`  
**Feature scope:** first-class bundles, skill/bundle SemVer, root-vs-effective selection, version-aware dependencies, bundle-aware planning/TUI/machine interface, and semantic skillpack update intelligence.

This task list is intentionally **dependency ordered**. Codex should execute tasks in ID order unless a task explicitly lists multiple already-completed prerequisites.

## Mandatory kickoff instruction for Codex

Before implementing **CSM-BND-001**, read:

- `AGENTS.md`
- `architecture.md`
- `docs/agent-native-architecture.md`
- `docs/skillpack-contract.md`
- `docs/semantic-registry.md`
- the current registry/config/install/plan schemas and their tests

Treat `AGENTS.md` as authoritative. Do not introduce an LLM, backend, MCP adapter, hidden semantic choices, mutable skillpack checkout behavior, or any write path that bypasses preview/plan/confirmation.

For every task:

1. inspect the current implementation before editing;
2. keep business logic in `packages/core`, not the CLI/TUI adapter;
3. write/update focused tests in the same task;
4. run the relevant package tests during development;
5. before marking the task done, run at least `pnpm typecheck` and the relevant Vitest suite;
6. do not start a task whose listed dependencies are incomplete;
7. document any intentional deviation from this task specification before implementing the deviation.

## Frozen design decisions

- Use **bundle** as the composition term. `skillpack` remains the repository/distribution-source concept; npm/workspace `package` remains an implementation/package-manager concept.
- Registry v3 requires **SemVer** on every skill and bundle.
- The skillpack Git commit remains the exact physical lock/reproducibility boundary. Skill/bundle SemVer communicates compatibility and upgrade meaning; it does not replace the commit lock.
- A bundle is a named composition/root set, not a workflow runtime. Orchestration behavior belongs in a real skill (for example a `spec-unleashed-orchestrator` skill) that a bundle may include.
- Registry v3 bundles may contain skills from the **same skillpack only**. Cross-skillpack bundle members are out of scope.
- Registry v3 does **not** support nested bundles. `bundle -> skills` only.
- Skill `requires` remains the hard dependency mechanism. Bundle membership means composition/distribution, not technical dependency.
- Version constraints are validated against the single version present in the active skillpack snapshot. Corvus does not select among multiple versions of the same skill.
- Persist **root selection** separately from the derived/effective skill set. Existing `selectedSkillIds` from config v1/v2 migrate as explicit root skills.
- The manifest remains a filesystem-ownership ledger only. Do not add bundle/package provenance to `manifest.json`.
- Every mutation remains plan-then-apply; read-only paths remain side-effect free; the TUI and machine interface share the same application/core logic.
- `allCompatible` continues to mean all compatible individual skills; it must not silently select bundles.

## Current repository anchors

- `AGENTS.md`
- `architecture.md`
- `docs/agent-native-architecture.md`
- `docs/skillpack-contract.md`
- `docs/semantic-registry.md`
- `packages/core/src/registry/registrySchema.ts`
- `packages/core/src/skills/skillDiscovery.ts`
- `packages/core/src/skills/skillRelationships.ts`
- `packages/core/src/config/configSchema.ts`
- `packages/core/src/application/install/installRequest.ts`
- `packages/core/src/application/install/installPlanner.ts`
- `packages/core/src/application/plans/planSchema.ts`
- `packages/core/src/lock/lockSchema.ts`
- `packages/core/src/manifest/manifestSchema.ts`
- `packages/tui/src/screens/`
- `packages/tui/src/wizard/wizardFlow.ts`
- `test/support/skillpackFixtures.ts`

## Execution overview

| Phase | Task range | Purpose |
|---|---|---|
| 0 — Baseline & contract | CSM-BND-001 – CSM-BND-002 | Baseline & contract |
| 1 — Registry v3 | CSM-BND-003 – CSM-BND-008 | Registry v3 |
| 2 — Discovery domain | CSM-BND-009 – CSM-BND-012 | Discovery domain |
| 3 — Config v3 root selection | CSM-BND-013 – CSM-BND-016 | Config v3 root selection |
| 4 — Bundle/effective resolver | CSM-BND-017 – CSM-BND-021 | Bundle/effective resolver |
| 5 — Install contract | CSM-BND-022 – CSM-BND-028 | Install contract |
| 6 — Machine interface | CSM-BND-029 – CSM-BND-030 | Machine interface |
| 7 — TUI | CSM-BND-031 – CSM-BND-034 | TUI |
| 8 — Update intelligence | CSM-BND-035 – CSM-BND-037 | Update intelligence |
| 9 — Maintainer tooling | CSM-BND-038 – CSM-BND-039 | Maintainer tooling |
| 9 — Documentation & release | CSM-BND-040 – CSM-BND-042 | Documentation & release |

## Tasks

# 0 — Baseline & contract

## CSM-BND-001 — Freeze the Registry v3 / bundle architecture contract

**Objective:** Create one implementation-facing specification that turns the agreed design into authoritative repository language before code changes begin.

**Depends on:** None  
**Size:** S

**Likely files / modules:**
- `_specs/registry-v3-bundles-and-versioning.md`
- `architecture.md`

**Implementation notes:**
- Document terminology: skill, bundle, skillpack, root selection, effective selection, dependency.
- Freeze the MVP boundaries: same-skillpack bundle members, no nested bundles, no runtime orchestration, no multi-version resolver.
- Define the role split between SemVer and the skillpack commit lock.
- Define migration guarantees for registry v1/v2 and config v1/v2.
- Explicitly preserve AGENTS.md invariants: TUI-first, shared application layer, plan-then-apply, immutable skillpacks.

**Acceptance criteria:**
- [x] The spec contains normative examples for registry v1/v2/v3 and config v2/v3.
- [x] Every later task can reference a frozen decision instead of re-deciding architecture.
- [x] No runtime code changes are required in this task.

**Required tests / verification:**
- Documentation-only; run existing `pnpm typecheck` and `pnpm test` to prove no regression.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-002 — Add SemVer library and shared version primitives

**Objective:** Use a proven SemVer implementation rather than hand-rolling range parsing and compatibility checks.

**Depends on:** CSM-BND-001  
**Size:** S

**Likely files / modules:**
- `packages/core/package.json`
- `packages/core/src/versioning/semver.ts`
- `packages/core/src/versioning/semver.test.ts`

**Implementation notes:**
- Add a maintained SemVer dependency to core (and typings only if required by the selected package).
- Expose small pure helpers for strict version parsing, range parsing, satisfies(), and change classification (major/minor/patch/same).
- Reject loose/non-canonical versions if the v3 contract requires canonical SemVer.
- Keep the helper independent of registry/discovery code.

**Acceptance criteria:**
- [x] Valid examples such as 1.0.0, 2.3.1 and prereleases per the chosen contract parse deterministically.
- [x] Invalid versions/ranges fail with stable, testable errors.
- [x] No registry behavior changes yet.

**Required tests / verification:**
- Unit tests for valid/invalid versions, ranges, prerelease behavior, and major/minor/patch classification.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

# 1 — Registry v3

## CSM-BND-003 — Introduce Registry v3 skill version schema

**Objective:** Extend the registry contract so every v3 skill has a mandatory semantic version while v1/v2 remain readable unchanged.

**Depends on:** CSM-BND-002  
**Size:** S

**Likely files / modules:**
- `packages/core/src/registry/registrySchema.ts`
- `packages/core/src/registry/registrySchema.test.ts`

**Implementation notes:**
- Add registry version 3 and keep v1/v2 schemas available.
- Add mandatory `version` to each v3 skill entry.
- Validate skill versions with the shared strict SemVer primitive.
- Do not retroactively require versions in registry v1/v2.

**Acceptance criteria:**
- [x] Existing valid v1 and v2 fixtures still parse.
- [x] A v3 skill without `version` fails.
- [x] A v3 skill with malformed SemVer fails.
- [x] `currentRegistryVersion` becomes 3 only when all v3 schema pieces required for parsing exist.

**Required tests / verification:**
- Schema tests covering backward compatibility and v3 version validation.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-004 — Define versioned hard-dependency references for v3 skills

**Objective:** Allow hard skill dependencies to declare compatible version ranges without adding a multi-version package resolver.

**Depends on:** CSM-BND-003  
**Size:** M

**Likely files / modules:**
- `packages/core/src/registry/registrySchema.ts`
- `packages/core/src/registry/registrySchema.test.ts`

**Implementation notes:**
- Define a v3 required-skill reference object `{ id, version }` where `version` is a SemVer range.
- Use the object form for v3 `requires`.
- Keep v1/v2 string-array `requires` semantics unchanged.
- Normalize downstream discovery into one internal relationship representation so install code does not branch on registry version.

**Acceptance criteria:**
- [x] v3 hard dependency constraints are machine-readable and validated.
- [x] v2 string relationships continue to work.
- [x] Malformed dependency IDs or ranges fail registry validation.

**Required tests / verification:**
- Schema tests for exact, caret, tilde and bounded ranges plus invalid objects/ranges.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-005 — Add first-class bundle schema to Registry v3

**Objective:** Model workflow/capability compositions explicitly instead of pretending they are ordinary skills.

**Depends on:** CSM-BND-003  
**Size:** M

**Likely files / modules:**
- `packages/core/src/registry/registrySchema.ts`
- `packages/core/src/registry/registrySchema.test.ts`

**Implementation notes:**
- Add top-level `bundles` to registry v3.
- Define required bundle fields: `id`, `version`, `title`, `description`, `skills`.
- Represent bundle members as `{ id, version }` skill references with SemVer ranges.
- Allow useful bounded catalog metadata only where it has clear value (for example tags/keywords) and reuse existing limits where practical.
- Do not add `path` or `SKILL.md` requirements to bundles.

**Acceptance criteria:**
- [x] A bundle is discoverable from registry metadata but has no filesystem installation target of its own.
- [x] Bundle IDs obey the same safe identifier rules as skills.
- [x] Bundle versions are mandatory valid SemVer.
- [x] A v3 registry may contain zero bundles.

**Required tests / verification:**
- Schema tests for valid bundle, empty/duplicate/malformed members, invalid IDs, invalid versions and unknown fields.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-006 — Validate bundle membership and v3 version constraints

**Objective:** Reject incoherent Registry v3 snapshots during discovery instead of allowing broken bundles to fail later during install.

**Depends on:** CSM-BND-004, CSM-BND-005  
**Size:** M

**Likely files / modules:**
- `packages/core/src/registry/registrySchema.ts`
- `packages/core/src/skills/skillRelationships.ts`
- `packages/core/src/skills/skillRelationships.test.ts`

**Implementation notes:**
- Validate that each bundle member names a skill in the same registry.
- Validate that the member's range is satisfied by that skill's v3 version.
- Validate each v3 `requires` range against the required skill version in the same snapshot.
- Reject duplicate bundle IDs and duplicate members after normalization.
- Keep `recommends` missing-target behavior non-blocking and `conflictsWith` behavior consistent with current rules.

**Acceptance criteria:**
- [x] Unknown bundle member is a blocking discovery error.
- [x] Bundle member version mismatch is a blocking discovery error with bundle/member/range/actual-version details.
- [x] Hard dependency version mismatch is a blocking discovery error.
- [x] Output ordering is deterministic.

**Required tests / verification:**
- Unit tests for matching/mismatching ranges, duplicate members, unknown members and deterministic issue ordering.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-007 — Enforce MVP bundle boundaries explicitly

**Objective:** Make out-of-scope package-manager behavior fail loudly instead of being accidentally supported.

**Depends on:** CSM-BND-005  
**Size:** S

**Likely files / modules:**
- `packages/core/src/registry/registrySchema.ts`
- `packages/core/src/registry/registrySchema.test.ts`
- `docs/skillpack-contract.md`

**Implementation notes:**
- Ensure a bundle member can only be an unqualified local skill ID.
- Reject qualified `<skillpack-id>:<skill-id>` member references.
- Do not define a bundle-to-bundle member type; nested bundles must be structurally impossible in v3.
- Document that cross-skillpack composition and nested bundles require a future registry version.

**Acceptance criteria:**
- [x] The schema cannot represent nested bundles.
- [x] Cross-skillpack member references fail validation.
- [x] The failure is explicit and documented.

**Required tests / verification:**
- Schema tests for qualified/cross-pack member references and unknown bundle-specific fields.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-008 — Extend registry validation reporting for v3

**Objective:** Expose actionable validation diagnostics for maintainers and CI.

**Depends on:** CSM-BND-006, CSM-BND-007  
**Size:** M

**Likely files / modules:**
- `packages/core/src/application/skills/`
- `packages/core/src/reports/`
- `packages/core/src/application/application.test.ts`

**Implementation notes:**
- Include missing/invalid skill versions, invalid bundle versions, missing members and version mismatches in validation output.
- Report counts for skills, versioned skills, bundles and valid bundle memberships.
- Preserve deterministic machine JSON ordering.
- Do not write registry files or skillpack contents.

**Acceptance criteria:**
- [x] `skills validate-registry --json` (or the existing equivalent use case) fully describes Registry v3 failures.
- [x] v1/v2 output remains backward compatible where contractually required.
- [x] Validation remains read-only.

**Required tests / verification:**
- Application tests asserting exact stable error codes/fields and no filesystem mutations.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

# 2 — Discovery domain

## CSM-BND-009 — Carry skill versions through discovery

**Objective:** Make semantic version data available to planners, inspection, status and update intelligence without reparsing registry files.

**Depends on:** CSM-BND-003  
**Size:** M

**Likely files / modules:**
- `packages/core/src/skills/skillDiscovery.ts`
- `packages/core/src/skills/skillDiscovery.test.ts`
- `packages/core/src/index.ts`

**Implementation notes:**
- Add optional/internal version representation to `DiscoveredSkill` that is populated for v3.
- Keep v1/v2 discovered skills valid with an explicit legacy/unversioned representation.
- Preserve qualified skill refs across multiple skillpacks.
- Do not infer versions from Git tags, package.json or SKILL.md.

**Acceptance criteria:**
- [x] v3 discovered skills expose exact registry versions.
- [x] v1/v2 discovery remains functional.
- [x] Existing callers compile without duplicate parsing logic.

**Required tests / verification:**
- Discovery tests for v1/v2/v3 and multi-skillpack qualification.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-010 — Add `DiscoveredBundle` and bundle catalog discovery

**Objective:** Expose Registry v3 bundles as first-class catalog objects while keeping them distinct from linkable skills.

**Depends on:** CSM-BND-005, CSM-BND-009  
**Size:** M

**Likely files / modules:**
- `packages/core/src/skills/skillDiscovery.ts`
- `packages/core/src/skills/bundleDiscovery.ts`
- `packages/core/src/index.ts`
- `test/support/skillpackFixtures.ts`

**Implementation notes:**
- Define `DiscoveredBundle` with qualified ref, local ID, version, metadata, owning skillpack and normalized member constraints.
- Discovery returns bundles separately from skills; never place bundles into the linkable skill array.
- Qualify bundle identity as `<skillpack-id>:<bundle-id>` for manager-level selection.
- Registryless fallback discovers skills only and returns no bundles.

**Acceptance criteria:**
- [x] Two skillpacks may both contain a local bundle named `default` without collision because refs are qualified.
- [x] Bundle discovery is deterministic.
- [x] No bundle produces a source path for agent linking.

**Required tests / verification:**
- Fixture and discovery tests including same local bundle ID in two skillpacks.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-011 — Derive bundle agent compatibility

**Objective:** Give the TUI and machine interface a deterministic answer to 'can this whole bundle be installed for agent X?'

**Depends on:** CSM-BND-006, CSM-BND-010  
**Size:** M

**Likely files / modules:**
- `packages/core/src/skills/bundleCompatibility.ts`
- `packages/core/src/skills/bundleCompatibility.test.ts`

**Implementation notes:**
- Compute bundle compatibility from all direct members plus their transitive hard dependencies.
- A bundle is compatible with an agent only if every effective required skill supports that agent.
- Return structured incompatibility reasons identifying the blocking member/dependency.
- Do not silently drop incompatible members.

**Acceptance criteria:**
- [x] Compatibility is deterministic and explainable.
- [x] A partially compatible bundle is reported incompatible, not partially installed.
- [x] Legacy unversioned skills can still participate in compatibility when referenced only by legacy flows; v3 bundle members always resolve to v3 skills.

**Required tests / verification:**
- Unit tests for fully compatible, direct-member incompatible and transitive-dependency incompatible bundles.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-012 — Add bundle list/inspect/search application read models

**Objective:** Make bundles available to humans and calling agents without mixing them into existing skill search semantics.

**Depends on:** CSM-BND-010, CSM-BND-011  
**Size:** M

**Likely files / modules:**
- `packages/core/src/application/skills/`
- `packages/core/src/application/useCases/`
- `packages/core/src/application/CorvusApplication.ts`

**Implementation notes:**
- Add read-only use cases for bundle listing and inspection.
- Add deterministic lexical bundle search using title/id/description/tags/keywords if bundle metadata supports them.
- Inspection must show member constraints, actual member versions and derived supported agents/incompatibility reasons.
- Keep skill search unchanged unless a consciously versioned response contract is updated.

**Acceptance criteria:**
- [x] Calling adapters can inspect a bundle before selecting it.
- [x] Read-only operations perform zero state writes.
- [x] Results are stable-sorted and token-bounded.

**Required tests / verification:**
- Application/use-case tests plus read-only directory-tree diff assertions.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

# 3 — Config v3 root selection

## CSM-BND-013 — Design and implement Manager Config v3

**Objective:** Separate persisted user intent (roots) from derived effective skills while minimizing migration churn.

**Depends on:** CSM-BND-001, CSM-BND-010  
**Size:** M

**Likely files / modules:**
- `packages/core/src/config/configSchema.ts`
- `packages/core/src/config/configSchema.test.ts`

**Implementation notes:**
- Introduce persisted config version 3.
- In v3, `selectedSkillIds` means explicit/root skill selections only.
- Add `selectedBundleIds` per agent for explicit/root bundle selections.
- Store qualified refs for both fields.
- Do not persist dependency-expanded/effective skill sets.

**Acceptance criteria:**
- [x] Config v3 can represent explicit skills + bundles independently.
- [x] The schema remains strict.
- [x] No manifest changes are introduced.

**Required tests / verification:**
- Schema tests for v3, qualified refs, duplicates/normalization and invalid bundle refs.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-014 — Migrate config v1/v2 to normalized v3 in memory

**Objective:** Preserve every existing user's current selection safely when the meaning of `selectedSkillIds` becomes root-only.

**Depends on:** CSM-BND-013  
**Size:** M

**Likely files / modules:**
- `packages/core/src/config/configSchema.ts`
- `packages/core/src/config/configStore.ts`
- `packages/core/src/config/configSchema.test.ts`

**Implementation notes:**
- Parse persisted v1/v2/v3.
- Normalize v1/v2 `selectedSkillIds` to v3 explicit root skills exactly as stored/qualified today.
- Initialize `selectedBundleIds` as empty during migration.
- Do not write migrated config during read-only commands.
- Only a later confirmed write may persist v3.

**Acceptance criteria:**
- [x] Opening an old config changes no filesystem bytes.
- [x] Old selections remain installed after the first v3 plan/apply.
- [x] Migration is deterministic and idempotent.

**Required tests / verification:**
- Migration fixtures for v1 and v2; assert no writes during parse/status/doctor.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-015 — Update config mutation/change models for root selections

**Objective:** Ensure plan artifacts describe changes in user intent rather than only changes in derived link state.

**Depends on:** CSM-BND-013  
**Size:** M

**Likely files / modules:**
- `packages/core/src/application/plans/planSchema.ts`
- `packages/core/src/application/install/installPlanner.ts`

**Implementation notes:**
- Version the relevant plan schema if necessary instead of mutating persisted plan v1 semantics in place.
- Represent root skill changes and root bundle changes explicitly in config-change payloads.
- Keep effective link operations as a separate derived result.
- Maintain canonical sorting for plan digest stability.

**Acceptance criteria:**
- [x] A plan can explain `bundle added`, `bundle removed`, `explicit skill added/removed` separately from created/removed links.
- [x] Equivalent normalized requests produce identical plan digests.

**Required tests / verification:**
- Plan schema/digest tests including ordering independence.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-016 — Add root/effective selection read model

**Objective:** Provide one authoritative structure that distinguishes what the user selected from what Corvus must link.

**Depends on:** CSM-BND-013, CSM-BND-010  
**Size:** S

**Likely files / modules:**
- `packages/core/src/skills/selectionModel.ts`
- `packages/core/src/skills/selectionModel.test.ts`

**Implementation notes:**
- Define root skill refs, root bundle refs and effective resolved skill selections.
- Include provenance fields suitable for plan/status rendering.
- Keep the model pure and adapter-agnostic.
- Do not perform filesystem writes.

**Acceptance criteria:**
- [x] The same model can serve install planner, status/verify and TUI preview.
- [x] A skill may have multiple provenance paths without being duplicated in effective output.

**Required tests / verification:**
- Unit tests for deduplication and multi-provenance representation.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

# 4 — Bundle/effective resolver

## CSM-BND-017 — Implement pure bundle expansion

**Objective:** Expand explicit bundle roots into direct skill roots before hard dependency expansion.

**Depends on:** CSM-BND-010, CSM-BND-016  
**Size:** M

**Likely files / modules:**
- `packages/core/src/skills/bundleResolver.ts`
- `packages/core/src/skills/bundleResolver.test.ts`

**Implementation notes:**
- Accept selected qualified bundle refs and discovered bundles/skills.
- Resolve each bundle to its direct member skills in authored order, then canonicalize output where required by downstream digest contracts.
- Emit provenance `bundle-member` with `bundle:<qualified-bundle-ref>`.
- Return structured missing/invalid bundle errors even though valid discovery should normally prevent them.

**Acceptance criteria:**
- [ ] Selecting one bundle yields its exact direct members.
- [ ] Selecting overlapping bundles deduplicates skills while retaining provenance.
- [ ] Unknown bundle is a blocking deterministic error.

**Required tests / verification:**
- Unit tests for one bundle, overlapping bundles, duplicate roots and unknown bundle.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-018 — Extend selection provenance kinds

**Objective:** Represent bundle membership without confusing it with explicit user skill selection or technical dependency.

**Depends on:** CSM-BND-017  
**Size:** S

**Likely files / modules:**
- `packages/core/src/skills/skillRelationships.ts`
- `packages/core/src/application/plans/planSchema.ts`

**Implementation notes:**
- Add `bundle-member` to the resolved reason-kind model.
- Preserve `explicit`, `dependency-of`, and `all-compatible`.
- Use stable machine-readable reason strings.
- Allow effective skills to preserve more than one origin when useful, or establish deterministic precedence plus an origins collection.

**Acceptance criteria:**
- [ ] Plan/status can distinguish explicit skill, bundle member and transitive dependency.
- [ ] Existing explicit/dependency behavior remains intact.

**Required tests / verification:**
- Relationship and plan schema tests.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-019 — Compose bundle expansion with hard dependency expansion

**Objective:** Create one deterministic resolver pipeline: root skills + bundle members -> required dependencies -> effective skills.

**Depends on:** CSM-BND-017, CSM-BND-018  
**Size:** L

**Likely files / modules:**
- `packages/core/src/skills/effectiveSelectionResolver.ts`
- `packages/core/src/skills/effectiveSelectionResolver.test.ts`
- `packages/core/src/skills/skillRelationships.ts`

**Implementation notes:**
- Merge explicit root skills with bundle direct members.
- Then invoke/extend existing breadth-first hard dependency expansion.
- Preserve same-skillpack relationship scoping.
- Track provenance through the transitive dependency layer.
- Return dependencies-added and bundle-members-added separately.

**Acceptance criteria:**
- [ ] No duplicate effective link targets arise from overlapping roots.
- [ ] Dependency traversal remains terminating/deterministic.
- [ ] A dependency shared by two bundles remains one effective skill.

**Required tests / verification:**
- Unit tests for mixed explicit/bundle roots, shared dependencies and deterministic order.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-020 — Validate agent support after full effective expansion

**Objective:** Prevent partial workflow installation when a bundle member or transitive dependency cannot run on the target agent.

**Depends on:** CSM-BND-019, CSM-BND-011  
**Size:** M

**Likely files / modules:**
- `packages/core/src/skills/effectiveSelectionResolver.ts`
- `packages/core/src/application/install/installPlanner.ts`

**Implementation notes:**
- Validate every effective skill against each target agent.
- For bundle-origin failures, surface the bundle ref and blocking skill in the error details.
- Do not silently install the compatible subset.
- Keep current strict behavior for explicit unsupported skills and required dependencies.

**Acceptance criteria:**
- [ ] A bundle installation is atomic at planning semantics: incompatible effective set blocks the plan for that agent.
- [ ] Error output is actionable and stable.

**Required tests / verification:**
- Planner tests for unsupported direct member and unsupported transitive dependency.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-021 — Apply conflicts and recommendations to effective selection

**Objective:** Ensure existing relationship rules continue to operate correctly after bundle expansion.

**Depends on:** CSM-BND-019  
**Size:** M

**Likely files / modules:**
- `packages/core/src/skills/skillRelationships.ts`
- `packages/core/src/application/install/installPlanner.ts`

**Implementation notes:**
- Run conflict detection over the final effective skill set.
- Collect recommendations from effective skills but never auto-select them.
- Include bundle provenance in conflict diagnostics when available.
- Keep symmetric conflict behavior.

**Acceptance criteria:**
- [ ] A conflict introduced by two different bundles blocks planning.
- [ ] Recommendations remain warnings/offers only.
- [ ] No recommendation becomes a root/effective skill without explicit selection.

**Required tests / verification:**
- Tests for bundle-vs-bundle conflict, bundle-vs-explicit conflict and recommendations.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

# 5 — Install contract

## CSM-BND-022 — Version the install request contract for bundles

**Objective:** Let both TUI/application callers and coding agents express explicit bundle roots deterministically.

**Depends on:** CSM-BND-013, CSM-BND-017  
**Size:** M

**Likely files / modules:**
- `packages/core/src/application/install/installRequest.ts`
- `packages/core/src/application/install/installRequest.test.ts`

**Implementation notes:**
- Introduce install request schema v2 (or equivalent explicit version bump).
- Add `selectedBundles` alongside `selectedSkills`.
- Keep `allCompatible` mutually exclusive with explicit root selection modes.
- Normalize/deduplicate/sort bundle refs exactly like skill refs.
- Preserve request v1 parsing if the machine protocol promises it, otherwise provide an explicit migration/error contract.

**Acceptance criteria:**
- [ ] Equivalent ordering of skill/bundle roots yields byte-identical normalized requests.
- [ ] Request v2 can represent skills-only, bundles-only or both.
- [ ] `allCompatible` never auto-selects bundles.

**Required tests / verification:**
- Schema/normalization tests including duplicate and reordered roots.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-023 — Integrate root/effective resolution into install planning

**Objective:** Replace the current 'expanded dependencies become next persisted selectedSkillIds' behavior with root-persisted/effective-derived planning.

**Depends on:** CSM-BND-019, CSM-BND-020, CSM-BND-021, CSM-BND-022  
**Size:** L

**Likely files / modules:**
- `packages/core/src/application/install/installPlanner.ts`
- `packages/core/src/application/install.test.ts`

**Implementation notes:**
- Resolve requested root skill/bundle changes per agent.
- Build the effective skill set using the new resolver.
- Feed only effective skills to existing link planning.
- Build config changes from root selections only.
- Keep replace/additive semantics explicit for both root skill and root bundle selections.

**Acceptance criteria:**
- [ ] Dependencies and bundle members create links but are not persisted as explicit roots.
- [ ] Existing manager-owned link safety logic remains authoritative.
- [ ] Current explicit-skill install behavior remains functionally compatible.

**Required tests / verification:**
- End-to-end application tests for additive, replace, bundle-only and mixed selection.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-024 — Persist rich install-plan provenance and summaries

**Objective:** Make dry-run output explain exactly why each link will exist.

**Depends on:** CSM-BND-015, CSM-BND-023  
**Size:** M

**Likely files / modules:**
- `packages/core/src/application/plans/planSchema.ts`
- `packages/core/src/application/install/installPlanner.ts`

**Implementation notes:**
- Add root bundle selections and effective provenance to install plan payload.
- Add summary fields such as bundlesSelected, bundleMembersAdded, dependenciesAdded and effectiveSkills.
- Keep link operations themselves skill/link oriented.
- Version persisted plan schema rather than making old plan artifacts ambiguously parse.

**Acceptance criteria:**
- [ ] Plan shows explicit roots separately from derived members/dependencies.
- [ ] Plan digest includes every decision-relevant bundle/version/root field.
- [ ] Old persisted plan handling follows an explicit compatibility policy.

**Required tests / verification:**
- Plan artifact tests, digest tests and tamper-detection tests.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-025 — Include bundle/registry state in stale-plan fingerprints

**Objective:** Prevent applying a plan after a bundle definition or relevant registry version changed.

**Depends on:** CSM-BND-024  
**Size:** M

**Likely files / modules:**
- `packages/core/src/application/context.ts`
- `packages/core/src/application/plans/planSchema.ts`
- `packages/core/src/application/install.test.ts`

**Implementation notes:**
- Fingerprint the active skillpack revision/registry data sufficient to detect changed bundle membership, skill versions or constraints.
- Fingerprint the root-selection config state.
- Keep fingerprint components named and independently diffable.
- Do not over-fingerprint irrelevant volatile data.

**Acceptance criteria:**
- [ ] Changing bundle membership/version after plan creation makes apply stale.
- [ ] Changing root config after plan creation makes apply stale.
- [ ] Unrelated non-semantic timestamps do not unnecessarily invalidate plans.

**Required tests / verification:**
- Stale-plan tests that assert exact differing fingerprint components.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-026 — Apply config v3 root selections only after confirmed plan

**Objective:** Persist user intent safely while leaving the manifest focused on manager-owned links.

**Depends on:** CSM-BND-023, CSM-BND-025  
**Size:** M

**Likely files / modules:**
- `packages/core/src/application/useCases/`
- `packages/core/src/config/`
- `packages/core/src/manifest/manifestSchema.ts`

**Implementation notes:**
- On confirmed apply, write selected root skills and bundles to config v3.
- Apply effective link operations using the existing manifest/link engine.
- Do not store bundle provenance in manifest entries.
- Do not write config when planning.

**Acceptance criteria:**
- [ ] A successful apply upgrades old config to v3 only as part of the approved mutation.
- [ ] Manifest schema can remain unchanged unless an unrelated technical need is proven.
- [ ] Read-only and plan operations write nothing except persisted plan artifacts where already contractually intended.

**Required tests / verification:**
- Apply tests plus directory-tree mutation assertions.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-027 — Implement dependency-aware bundle removal through recomputation

**Objective:** Remove bundles without explicit reference counting by recalculating the effective set from remaining roots.

**Depends on:** CSM-BND-026  
**Size:** L

**Likely files / modules:**
- `packages/core/src/application/install/installPlanner.ts`
- `packages/core/src/skills/effectiveSelectionResolver.ts`
- `packages/core/src/application/install.test.ts`

**Implementation notes:**
- When a bundle root is removed, recompute effective skills from remaining explicit skill/bundle roots.
- Remove only links no longer required by any remaining root.
- Retain shared skills/dependencies automatically.
- Never remove unmanaged links.

**Acceptance criteria:**
- [ ] Removing bundle A retains a shared skill still required by bundle B.
- [ ] Removing the final root that needs a dependency plans its managed link removal.
- [ ] No persisted refcount database is required.

**Required tests / verification:**
- End-to-end tests for overlapping bundles and explicit skill retaining a former bundle member.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-028 — Extend install verification for root and effective state

**Objective:** Make verify/status able to detect drift between desired roots, derived skills and actual managed links.

**Depends on:** CSM-BND-026  
**Size:** M

**Likely files / modules:**
- `packages/core/src/application/useCases/`
- `packages/core/src/reports/`
- `packages/core/src/application/install.test.ts`

**Implementation notes:**
- Report root selections, derived effective skills and actual link state separately.
- Detect missing managed links for bundle members/dependencies.
- Detect stale links no longer implied by root selections where safe to report.
- Remain read-only.

**Acceptance criteria:**
- [ ] Verify can explain both 'why should this skill exist?' and 'does the link exist?'.
- [ ] No repair occurs automatically.

**Required tests / verification:**
- Verification tests including bundle-derived missing link and no-write assertions.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

# 6 — Machine interface

## CSM-BND-029 — Expose bundle capabilities in the machine protocol

**Objective:** Allow coding agents to discover bundle support from `capabilities` without external documentation.

**Depends on:** CSM-BND-012, CSM-BND-022, CSM-BND-024  
**Size:** M

**Likely files / modules:**
- `packages/core/src/application/protocol/`
- `packages/core/src/application/CorvusApplication.ts`
- `packages/cli/src/`

**Implementation notes:**
- Version machine protocol response contracts where required.
- Advertise bundle list/search/inspect and bundle-capable install request schema.
- Expose stable error codes for unknown bundle, incompatible bundle, member mismatch and version mismatch.
- Keep CLI package transport-only.

**Acceptance criteria:**
- [ ] `corvus-skills capabilities --json` is sufficient for an agent to learn how to discover and install a bundle.
- [ ] stdout remains exactly one JSON document in JSON mode.
- [ ] No business logic appears in CLI handlers.

**Required tests / verification:**
- Protocol snapshot/contract tests and CLI adapter tests.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-030 — Add machine commands/flags for bundle discovery and selection

**Objective:** Provide deterministic agent-native operations over the shared application layer.

**Depends on:** CSM-BND-029  
**Size:** M

**Likely files / modules:**
- `packages/cli/src/`
- `packages/core/src/application/useCases/`

**Implementation notes:**
- Add bundle list/search/inspect routing using application use cases.
- Allow install plan request documents and/or flags to include bundle refs.
- Do not add an install shortcut that bypasses persisted plan + exact confirmation.
- Preserve qualified refs across multiple skillpacks.

**Acceptance criteria:**
- [ ] An agent can discover `team-skills:spec-unleashed`, plan it and apply the returned plan using the existing confirmation model.
- [ ] Unknown/ambiguous refs fail deterministically.

**Required tests / verification:**
- CLI integration tests for JSON shape, exit codes and plan-then-apply flow.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

# 7 — TUI

## CSM-BND-031 — Add bundle catalog/detail presentation components

**Objective:** Present bundles as first-class compositions without making them look like linkable skill directories.

**Depends on:** CSM-BND-012  
**Size:** M

**Likely files / modules:**
- `packages/tui/src/screens/`
- `packages/tui/src/application/`

**Implementation notes:**
- Add reusable bundle list/detail rendering fed by core application read models.
- Show bundle version, description, direct members, actual member versions and derived agent compatibility.
- Show incompatibility reasons instead of silently hiding bundles.
- Keep raw protocol JSON out of the TUI.

**Acceptance criteria:**
- [ ] Users can inspect what a bundle contains before selecting it.
- [ ] Bundle UI remains read-only until the existing planning/apply step.

**Required tests / verification:**
- Ink rendering tests for compatible and incompatible bundles.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-032 — Extend guided selection state with bundle roots

**Objective:** Let users select bundles and individual root skills in one draft without immediately mutating persisted config.

**Depends on:** CSM-BND-013, CSM-BND-031  
**Size:** L

**Likely files / modules:**
- `packages/tui/src/wizard/wizardFlow.ts`
- `packages/tui/src/screens/ConfigureAgentsScreen.tsx`
- `packages/tui/src/App.tsx`

**Implementation notes:**
- Extend TUI draft state with selected bundle refs per enabled agent.
- Preserve existing multi-agent selection behavior.
- Keep toggles as draft state until plan/apply.
- Do not directly expand bundles in UI code; call the shared core resolver/use case.

**Acceptance criteria:**
- [ ] Selecting a bundle does not write config or links.
- [ ] Cancel/back behavior discards draft changes as existing UX promises.
- [ ] No duplicate business logic exists between TUI and core.

**Required tests / verification:**
- Wizard flow and editing-cancel tests.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-033 — Create combined Bundles + Individual Skills selection UX

**Objective:** Make bundle-first installation easy while preserving advanced individual-skill control.

**Depends on:** CSM-BND-032  
**Size:** L

**Likely files / modules:**
- `packages/tui/src/screens/`
- `packages/tui/src/wizard/wizardFlow.ts`

**Implementation notes:**
- Render a Bundles section before Individual Skills in the appropriate guided step.
- Show selected/partial/incompatible states clearly for multi-agent use.
- Provide a detail view that previews direct members and additional transitive dependencies.
- Do not auto-select recommendations.

**Acceptance criteria:**
- [ ] A user can install Spec Unleashed without knowing its dependencies.
- [ ] An advanced user can still select only individual skills.
- [ ] Incompatible bundle selection cannot proceed to a misleading successful plan.

**Required tests / verification:**
- TUI interaction tests for bundle toggle, mixed selection and multi-agent partial state.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-034 — Render provenance-rich install plan preview

**Objective:** Show users the distinction between requested bundle roots and derived link changes before approval.

**Depends on:** CSM-BND-024, CSM-BND-033  
**Size:** M

**Likely files / modules:**
- `packages/tui/src/screens/`
- `packages/tui/src/wizard/wizardFlow.ts`

**Implementation notes:**
- Group preview into explicit bundles, explicit skills, bundle members, transitive dependencies, warnings/conflicts and link operations.
- Show versions for v3 skills/bundles.
- Retain the existing single explicit approval step.
- Map machine/core errors to human-readable TUI text.

**Acceptance criteria:**
- [ ] The user can answer 'what did I ask for?' and 'what else will Corvus link because of it?' before pressing apply.
- [ ] No apply occurs from the preview itself without the existing explicit approval.

**Required tests / verification:**
- Snapshot/render tests for a representative bundle install and conflict case.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

# 8 — Update intelligence

## CSM-BND-035 — Compare active and candidate registry versions during skillpack update planning

**Objective:** Turn raw commit updates into semantic skill/bundle upgrade information.

**Depends on:** CSM-BND-008, CSM-BND-010  
**Size:** L

**Likely files / modules:**
- `packages/core/src/application/useCases/`
- `packages/core/src/application/plans/planSchema.ts`
- `packages/core/src/git/`

**Implementation notes:**
- Read the active and candidate revision registries without mutating either.
- Compute added/removed/changed skills and bundles plus old/new semantic versions where available.
- Classify v3 version changes as major/minor/patch/same.
- Preserve existing changed-files information.

**Acceptance criteria:**
- [ ] Update plan includes semantic version deltas for skills and bundles.
- [ ] v1/v2 registries degrade gracefully to unknown/unversioned semantic delta.
- [ ] Comparison is deterministic.

**Required tests / verification:**
- Unit/application tests for add/remove, patch/minor/major and legacy registry comparisons.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-036 — Report affected installed bundles and breaking upgrades

**Objective:** Highlight whether a candidate skillpack update changes workflows the user actually has selected.

**Depends on:** CSM-BND-035, CSM-BND-013  
**Size:** M

**Likely files / modules:**
- `packages/core/src/application/useCases/`
- `packages/core/src/application/plans/planSchema.ts`

**Implementation notes:**
- Cross-reference candidate deltas with configured root bundle selections and their effective members.
- Mark installed bundles affected by changed member versions/membership.
- Flag major version changes as breaking-risk warnings, not automatic rejection.
- Do not make semantic release decisions beyond SemVer classification.

**Acceptance criteria:**
- [ ] Update preview can say which selected bundles are affected and why.
- [ ] Major changes are visually/machine distinguishable.
- [ ] No update is auto-approved or auto-applied.

**Required tests / verification:**
- Tests for unrelated updates, affected bundle, direct bundle version change and major member upgrade.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-037 — Expose semantic update intelligence in TUI and machine JSON

**Objective:** Surface the new comparison data consistently to humans and calling agents.

**Depends on:** CSM-BND-036  
**Size:** M

**Likely files / modules:**
- `packages/tui/src/screens/`
- `packages/core/src/application/protocol/`
- `packages/cli/src/`

**Implementation notes:**
- Render skill/bundle version deltas in the existing update preview.
- Highlight major changes and affected installed bundles.
- Expose equivalent structured fields in machine JSON.
- Keep actual revision activation behind the existing confirmed update plan/apply.

**Acceptance criteria:**
- [ ] Human and machine adapters report the same underlying comparison.
- [ ] No duplicate update-diff business logic exists in adapters.

**Required tests / verification:**
- TUI render tests and machine protocol contract tests.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

# 9 — Maintainer tooling

## CSM-BND-038 — Add version-discipline validation between revisions

**Objective:** Detect changed skill/bundle content whose declared version was not bumped, without pretending Corvus can infer the correct new SemVer.

**Depends on:** CSM-BND-035  
**Size:** M

**Likely files / modules:**
- `packages/core/src/application/skills/`
- `packages/core/src/reports/`
- `docs/`

**Implementation notes:**
- Implement a read-only comparison/check that can compare a base registry/revision with a candidate/current one.
- Warn/error when a changed skill retains the same declared version.
- Warn/error when bundle membership/metadata changes but bundle version remains unchanged.
- Do not automatically decide whether a bump should be patch/minor/major.
- Keep CI severity configurable or document the recommended company policy.

**Acceptance criteria:**
- [ ] Unchanged content with unchanged version passes.
- [ ] Changed content with unchanged version is detected.
- [ ] Changed content with any bumped version passes the 'bumped' check.
- [ ] The command performs no writes.

**Required tests / verification:**
- Comparison tests and no-write assertions.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-039 — Upgrade shared skillpack fixtures to Registry v3 coverage

**Objective:** Make future regressions easy to catch with representative bundles, versions, dependencies and conflicts.

**Depends on:** CSM-BND-008, CSM-BND-019  
**Size:** S

**Likely files / modules:**
- `test/support/skillpackFixtures.ts`
- `test/support/appHarness.ts`

**Implementation notes:**
- Add a representative v3 fixture with at least two bundles, overlapping members, a transitive dependency, a recommendation and a conflict.
- Retain v1/v2 fixtures for backward compatibility.
- Include multi-skillpack duplicate local IDs to exercise qualification.
- Keep fixture generation deterministic.

**Acceptance criteria:**
- [ ] Tests can construct v1/v2/v3 environments without one-off setup.
- [ ] The v3 fixture is suitable for application, TUI and machine-interface tests.

**Required tests / verification:**
- Fixture self-tests where appropriate; migrate duplicated ad-hoc fixtures to the shared helper.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

# 9 — Documentation & release

## CSM-BND-040 — Update public architecture and contracts

**Objective:** Make Registry v3 and bundle semantics understandable to skillpack maintainers, users and coding agents.

**Depends on:** CSM-BND-037, CSM-BND-038  
**Size:** M

**Likely files / modules:**
- `README.md`
- `architecture.md`
- `docs/skillpack-contract.md`
- `docs/semantic-registry.md`
- `docs/agent-interface.md`
- `docs/agent-protocol-v1.md`
- `CHANGELOG.md`

**Implementation notes:**
- Document Registry v3 schema with complete JSON examples.
- Document SemVer rules and commit-lock distinction.
- Document config v3 root-vs-effective semantics and migration.
- Document bundle discovery/install/remove behavior and MVP boundaries.
- Update machine-interface examples for bundle install.
- State explicitly that bundles do not execute workflows and skillpacks remain immutable.

**Acceptance criteria:**
- [ ] Docs match implemented schemas and command capabilities.
- [ ] Documentation contract tests are updated.
- [ ] No stale v2-only statements remain where v3 is now current.

**Required tests / verification:**
- Run documentation tests plus full test suite.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-041 — Full regression, safety and determinism pass

**Objective:** Prove that bundle/versioning support did not weaken Corvus's core safety guarantees.

**Depends on:** CSM-BND-027, CSM-BND-028, CSM-BND-030, CSM-BND-034, CSM-BND-037, CSM-BND-039, CSM-BND-040  
**Size:** L

**Likely files / modules:**
- `packages/core/src/**/*.test.ts`
- `packages/tui/src/**/*.test.tsx`
- `packages/cli/src/**/*.test.ts`
- `test/support/`

**Implementation notes:**
- Run/extend regression coverage for read-only no-write behavior.
- Test stale/tampered/unconfirmed install plans with bundles.
- Test unmanaged target conflicts and removal safety.
- Test deterministic JSON and digest behavior with reordered roots/bundles.
- Test config migration from v1/v2 and skillpack registry v1/v2 compatibility.
- Test Windows junction and POSIX symlink paths where existing harness supports them.

**Acceptance criteria:**
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] No read-only command creates config/cache/manifest side effects beyond existing explicit contracts.
- [ ] No bundle path bypasses plan-then-apply.
- [ ] No test mutates an active skillpack checkout.

**Required tests / verification:**
- Full repository typecheck and test suite; add focused regression tests for every discovered gap.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

## CSM-BND-042 — Release readiness and implementation mirror

**Objective:** Close the feature with auditable implementation status and a release-ready change summary.

**Depends on:** CSM-BND-041  
**Size:** S

**Likely files / modules:**
- `CHANGELOG.md`
- `_specs/registry-v3-bundles-and-versioning.md`
- `docs/`
- `package.json`

**Implementation notes:**
- Update the feature spec with final implemented deviations/decisions.
- Record migration notes and breaking protocol/schema changes.
- Bump Corvus package versions according to repository release policy only after tests pass.
- Produce a concise final implementation report including files changed, tests run, known follow-ups and explicit statement about skillpack mutation.

**Acceptance criteria:**
- [ ] Final report states: no mutable skillpack checkout touch occurred.
- [ ] All public packages that share a release version remain coherent.
- [ ] The task series can be considered complete without undocumented architectural debt.

**Required tests / verification:**
- Final `pnpm typecheck` and `pnpm test` from a clean working tree.

**Completion report:** Codex must summarize changed files, tests executed, result, and any deviation/open issue before moving to the next task.

---

# Global Definition of Done

The feature is complete only when all of the following hold:

- Registry v1 and v2 remain readable; Registry v3 supports mandatory skill/bundle SemVer and bundles.
- Bundle installation is root-based, deterministic and same-skillpack-only.
- Nested bundles and cross-skillpack bundle members are rejected by contract.
- Config v1/v2 migration preserves existing selections; Config v3 persists explicit/root skills and bundles only.
- Effective skills are derived from explicit roots + bundle members + transitive hard dependencies.
- Removing a bundle recomputes effective state and safely retains shared skills/dependencies.
- `manifest.json` remains a manager-owned link ledger rather than a package provenance database.
- Skillpack Git commit/revision remains the physical reproducibility lock.
- Plan artifacts and state fingerprints cover bundle/version/root-selection state sufficiently to reject stale plans.
- TUI and machine interface call shared application/core logic.
- All writes remain previewed/confirmed plan-then-apply operations.
- Read-only commands remain side-effect free.
- Skillpack checkouts remain immutable from Corvus's perspective.
- Semantic skillpack update preview reports skill/bundle version deltas and affected installed bundles.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- Public docs and examples match the implemented schemas.
