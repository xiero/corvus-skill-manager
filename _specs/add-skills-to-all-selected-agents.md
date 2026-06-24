Timestamp: 2026-06-24T00:00:00Z
Version: v1.0.0

# Spec: Add Skills To All Selected Agents

## Summary

In the Guided Flow's Skills step, when more than one agent is enabled, the user can
currently only assign skills to one agent at a time. This feature lets a single skill
selection apply to **every enabled agent at once**: toggling a skill in the Skills step
adds (or removes) it for all enabled agents simultaneously, using one shared checklist.
It is for users wiring the same set of skills into multiple coding agents who do not want
to repeat the same selection per agent.

## Motivation

The common case is selecting the same skills for several agents (e.g. Claude Code, Codex,
and Copilot all receiving the same skill). Today that means entering the Skills step once
per agent and re-toggling the identical list each time, which is tedious and error-prone
(easy to give agents inconsistent selections by mistake). A broadcast selection removes
the repetition and keeps multi-agent selections consistent by default.

## Affected Layers

- frontend TUI: Guided Flow wizard (Skills step orchestration and rendering) — **modified**
- frontend TUI: wizard flow derivation (selected-skill counting / step status) — **read-only / verify** (must keep working with the broadcast model)
- core (link planning, discovery, apply) — **read-only** (no change; `generateLinkPlan` already accepts independent per-agent selections)
- persisted configuration (`config.json` agent selections) — **read-only / unchanged shape** (per-agent `selectedSkillIds` is still written; broadcast only changes how those lists are populated in draft state)

## Reference Documents

- `architecture.md` — TUI layer ("Owns user navigation, guided flow orchestration, previews, and confirmations"), and "Link Planning And Apply" (selections are draft TUI state until saved; creation/removal is always planned first with `generateLinkPlan`).
- `CLAUDE.md` — relevant rules: selections are draft state until saved; the plan → confirm → apply pipeline is unchanged; do not add write behavior to read-only views; core stays Ink-free (broadcast logic lives in the TUI, not core).
- The daemon protocol documents referenced by the spec process do not exist in this repository and do not apply: this is a local TUI-only feature with no backend or daemon communication.

## Functional Requirements

- When two or more agents are enabled, the Skills step presents a single shared skill
  checklist that represents the selection applied to all enabled agents.
- Toggling a skill on adds that skill to every enabled agent's selection.
- Toggling a skill off removes that skill from every enabled agent's selection.
- A skill's checkbox in the shared list shows as selected only when it is selected for
  every enabled agent; mixed states (selected for some but not all) are visually
  distinguishable from fully-selected and fully-unselected.
- When exactly one agent is enabled, the Skills step behaves as it does today (selection
  affects only that agent), with no broadcast.
- The Skills step makes it clear which/how many agents a toggle will affect.
- Regenerating the link plan after broadcast selection produces create/remove operations
  for each enabled agent, consistent with the shared selection.
- Selecting or deselecting a skill invalidates any previously generated dry-run plan, as
  it does today (the user must regenerate the plan before applying).

## In Scope

- Broadcast skill selection across all enabled agents in the Guided Flow Skills step.
- Visual indication of mixed selection state and of how many agents are affected.
- Keeping the single-enabled-agent experience unchanged.
- Preserving the existing draft → plan → confirm → apply pipeline and the per-agent
  `selectedSkillIds` persistence shape.

## Out of Scope

- The non-wizard advanced "Configure Agents" screen — this spec covers only the Guided
  Flow Skills step. (If broadcast is wanted there too, it is a separate follow-up.)
- Selecting skills for a subset of enabled agents (e.g. "these two but not that one").
  The broadcast applies to all enabled agents; granular subset selection is out of scope.
- A user-toggleable mode switch between per-agent and broadcast selection. Behavior is
  determined solely by how many agents are enabled.
- Changes to per-agent target paths, agent enable/disable, skillpack setup, or update steps.
- Any change to core planning, discovery, manifest, or apply logic, or to the persisted
  config schema.
- Linking skills to agents that are not enabled.

## Acceptance Criteria

1. Given two or more enabled agents, when the user toggles a skill on in the Skills step,
   then that skill appears in every enabled agent's selection and the resulting plan
   creates a link for that skill under each enabled agent's target.
2. Given a skill that is selected for all enabled agents, when the user toggles it off,
   then it is removed from every enabled agent's selection and no longer appears in the plan.
3. Given a skill selected for some but not all enabled agents at the time the Skills step
   is entered, then the shared checklist shows that skill in a distinct "mixed" state, and
   toggling it resolves all enabled agents to the same state.
4. Given exactly one enabled agent, the Skills step behaves identically to the current
   per-agent behavior.
5. After any toggle, a previously generated dry-run plan is invalidated and must be
   regenerated before apply is allowed.
6. Disabling an agent and returning to the Skills step makes the broadcast apply only to
   the agents that remain enabled.

## Edge Cases

- Zero enabled agents reaching the Skills step (should not be reachable per existing flow
  gating; the step must not crash and must guide the user back to enable an agent).
- Exactly one enabled agent (no broadcast; unchanged behavior).
- No skills discovered in the active skillpack (shared list is empty; nothing to toggle).
- Pre-existing inconsistent per-agent selections loaded from saved config (mixed state
  must render correctly and be resolvable).
- Agents enabled/disabled after some skills were already selected (broadcast scope must
  reflect the current set of enabled agents, not a stale set).
- An enabled agent missing a required target path — selection is allowed, but the plan/
  apply steps continue to surface the existing target-path requirements and conflicts.

## Risks and Constraints

- **Architectural:** Broadcast logic must live in the TUI draft-state layer only; core
  must remain Ink-free and continue to receive independent per-agent selections via
  `generateLinkPlan`. No new write behavior may be added to read-only views.
- **Operational:** The draft → plan → confirm → apply safety pipeline must be preserved;
  broadcast only changes how draft selections are populated, never how or what is written.
  Apply still only creates/removes manager-owned links and never overwrites unmanaged paths.
- **Usability:** Broadcasting a removal across all agents could surprise a user who set up
  per-agent selections elsewhere; the mixed-state indicator and the "affects N agents"
  messaging mitigate this.
- **Performance:** Negligible; selection state is small in-memory draft data.

## Open Questions

- None.

## Testing Guidelines

- Unit-test (Vitest) the draft-state broadcast behavior: toggling a skill with multiple
  enabled agents updates every enabled agent's `selectedSkillIds`; toggling off removes it
  from all; single-enabled-agent toggling affects only that agent.
- Unit-test the derivation of the shared checklist state, including the "mixed" state when
  saved selections differ across enabled agents.
- Verify, via the existing wizard flow derivation tests, that selected-skill counting and
  step status still behave correctly under broadcast selection.
- Exercise the end-to-end guided path with mocked operations: enable multiple agents,
  broadcast-select skills, generate the dry-run plan, and confirm the plan contains the
  expected per-agent create operations before apply.
- Cover the edge cases above that change observable behavior: single agent, mixed initial
  state, and agent set changing between visits to the Skills step.
