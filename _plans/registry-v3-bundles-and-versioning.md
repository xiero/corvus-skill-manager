Timestamp: 2026-08-25T05:09:54Z
Version: v1.7.0

# Implementation Plan: Registry v3 Bundles and Versioning — Phase 7

## Context

Phases 1–6 established Registry v3 bundles, root/effective resolution, bundle-aware plan/apply,
and machine workflows. Phase 7 implements `CSM-BND-031` through `CSM-BND-034`: first-class Ink
bundle presentation, bundle roots in unsaved guided drafts, a bundle-first combined selection
step, and provenance-rich plan/apply previews using shared core resolution.

Source spec: `_specs/registry-v3-bundles-and-versioning.md`

## Open Question Status

- Answered: the existing `skills` wizard step id remains stable, but its label and content become
  a combined Bundles + Individual Skills selection step.
- Answered: one flattened keyboard cursor moves through bundles first and skills second; the
  selected bundle's detail is always visible, so inspection does not require a modal.
- Answered: bundle toggles broadcast across enabled agents exactly like the existing skill
  broadcast. `[x]`, `[~]`, and `[ ]` retain all/some/none semantics.
- Answered: a bundle incompatible with any enabled agent stays visible with reasons but cannot be
  toggled on for a misleading plan.
- Answered: the TUI calls the shared pure effective-selection resolver per agent, then feeds the
  resulting effective skills to the existing link planner. It does not expand bundles itself.
- Answered: the final `a` approval remains the only config/link write gate; back/Home navigation
  discards unsaved bundle and skill draft changes.
- Still blocked: none.

## Assumptions

- Guided Flow is the primary Phase 7 surface. The manual Configure Agents screen continues to
  preserve existing bundle roots but is not expanded into a second bundle UX.
- Bundle catalog presentation uses the exported application bundle read model, derived locally
  from the already read-only discovery result; no extra filesystem read or write is introduced.
- Previous effective selections are recomputed from persisted roots so removing a bundle plans
  removal only for skills no longer implied by any remaining root.
- Recommendations remain visible as warnings and are never selected automatically.
- Current Ink 5 `useInput` and react-test-renderer patterns remain compatible; Context7 was
  consulted for keyboard-handler activation and component testing guidance.

## Critical Files

- `packages/tui/src/wizard/wizardFlow.ts` — count skill and bundle roots in derived step state.
- `packages/tui/src/wizard/wizardSelection.ts` — pure adapter-neutral draft-to-effective/link-plan
  composition using core resolution, compatibility, conflicts, and recommendations.
- `packages/tui/src/screens/BundleCatalogView.tsx` — reusable bundle list/detail presentation.
- `packages/tui/src/screens/WizardScreen.tsx` — discovery, combined cursor/toggles, draft roots,
  plan generation, apply persistence, and provenance preview integration.
- TUI wizard/render/interaction/equivalence tests and Registry v3 fixtures.
- `architecture.md`, `docs/agent-native-architecture.md`, and the ordered task checklist.

## Implementation Sequence

1. Add a pure TUI orchestration helper that resolves current and previous roots with core,
   validates bundle compatibility/conflicts, preserves provenance, and generates the link plan.
2. Add reusable bundle catalog/detail components showing version, description, direct member
   ranges/actual versions, supported agents, and explicit incompatibility reasons.
3. Extend wizard discovery and drafts with qualified bundles; derive all/some/none root states
   across enabled agents without writing config.
4. Replace the skill-only step with bundle-first combined navigation, blocking incompatible
   toggles while retaining individual skill control and multi-agent partial state.
5. Persist bundle roots only inside the existing confirmed apply path and recompute previous and
   next effective selections for safe removal/retention behavior.
6. Extend dry-run/apply previews with explicit bundles, explicit skills, bundle members,
   dependencies, effective versions/origins, warnings/conflicts, and link operations.
7. Add focused render/interaction/cancel/equivalence tests, update authoritative docs/checklists,
   then run targeted and full verification.

## Data, API, or Contract Changes

- No machine protocol, request, plan-artifact, config, manifest, or registry schema version changes.
- Wizard draft agents now require canonical `selectedBundleIds` alongside `selectedSkillIds`.
- The new TUI-only selection preview separates roots, derived skills, and link operations while
  reusing exported core application/domain read models.
- Bundle selection remains draft state until confirmed apply persists Manager Config v3.

## Testing Strategy

- Pure planner: bundle-only/mixed roots, overlapping roots, dependencies, previous-root removal,
  recommendations, conflicts, and incompatible agents.
- Rendering: compatible/incompatible bundle list and detail, versions/ranges, partial selection,
  and bundle-first ordering.
- Interaction: bundle broadcast toggle, mixed bundle/skill selection, blocked incompatible
  selection, plan preview groups, and explicit apply.
- Cancellation: Home/back before apply leaves config and links unchanged and restores draft state
  on remount.
- Equivalence: TUI effective link operations match application install planning for the same
  bundle/skill roots.

## Verification Commands

```sh
pnpm vitest run packages/tui/src/wizard/wizardSelection.test.ts packages/tui/src/wizard/wizardFlow.test.ts
pnpm vitest run packages/tui/src/screens/BundleCatalogView.test.tsx packages/tui/src/screens/WizardSkillBroadcast.test.tsx packages/tui/src/screens/WizardScreen.test.tsx packages/tui/src/screens/EditingCancel.test.tsx
pnpm vitest run packages/tui/src/application/equivalence.test.ts
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## Documentation Updates

- Update `architecture.md` and `docs/agent-native-architecture.md` for the shared resolver-backed
  TUI draft/preview path.
- Mark `CSM-BND-031` through `CSM-BND-034` complete only after verification.
- Record verification results and safe deviations here before commit.

## Risks and Stop Conditions

- Stop if bundle expansion, dependency traversal, compatibility, or conflict logic would need to
  be duplicated in a React component.
- Stop if selecting or inspecting a bundle writes config, links, plan artifacts, or skillpack data.
- Stop if apply could proceed for an incompatible bundle or without the existing explicit `a` gate.
- Do not add Phase 8 update intelligence or mutate active skillpack snapshots.

## Rollback Notes

Revert the Phase 7 commit. Config v3 bundle roots and links created through previously confirmed
workflows remain valid; the TUI returns to skill-only editing while machine bundle workflows
continue to function. No data downgrade or skillpack rewrite is required.

## Verification Result

- Focused Phase 7 suite — passed: 8 test files, 55 tests.
- `pnpm typecheck` — passed.
- `pnpm test` — passed: 46 test files, 440 tests.
- `pnpm build` — passed.
- `git diff --check` — passed.
- Safe plan refinement: incompatible bundles preserve their visible root state (`[!x]`/`[!~]`)
  and may be removed from enabled-agent drafts, while a new incompatible root remains blocked.
- Safe plan refinement: bundle detail derives additional transitive dependencies through the
  shared core resolver, keeping relationship traversal out of React presentation code.

## Commit Message Draft

```text
✨ feat(tui): add bundle selection workflow
```
