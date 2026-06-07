Timestamp: 2026-05-14T19:46:20Z
Version: v1.0.0

# Spec: Wizard Guided TUI Flow

## Summary

The TUI should guide users through the full skill manager workflow as a wizard instead of expecting them to know which view to open next. The guided flow is for first-time setup and routine reconfiguration, leading the user from current state inspection through skillpack readiness, agent and skill selection, plan review, explicit confirmation, and completion. The design must preserve the existing safety model: no skillpack mutation, no unmanaged overwrites, and no write action without a preview and explicit approval.

## Motivation

The current first-run path requires the user to remember the correct sequence of Setup Skillpack, Configure Agents, save, review plan, and apply. That creates avoidable uncertainty in a TUI where the safest path should be obvious. A wizard-style flow reduces user decision load while keeping every sensitive operation deliberate and auditable.

## Affected Layers

- TUI app shell: **modified**
- TUI workflow/navigation experience: **modified**
- Core planning and safety contracts: **read-only**
- Manager persisted configuration and manifest state: **read-only**
- CLI entrypoint: **read-only**
- Skillpack revision snapshot model: **read-only**
- Agent target link model: **read-only**

## Reference Documents

- `AGENTS.md` - sections: Project Direction; Skillpack Repository Boundary; Manager State And Writes; Implementation Notes; Done Criteria
- `README.md` - sections: What It Does; What It Does Not Do; First-Run Flow; Supported Agents; Revision Snapshot Model; Troubleshooting
- `docs/safety-model.md` - sections: Write Boundaries; Skillpack Boundary; Agent Target Boundary; Read-Only Views; Update Preview; Gemini CLI; Failure Handling
- `docs/managed-manifest.md` - sections: Create Behavior; Remove Behavior; Broken Links; Dry Run
- `docs/skillpack-contract.md` - sections: Snapshot Layout; Revision Rules; Preferred Registry; Registryless Fallback
- `architecture.md` - not present in the working tree; applicable layer boundaries were derived from the authoritative project docs listed above.

## Functional Requirements

- The TUI must offer a guided flow that presents the next recommended step based on the current manager state.
- The guided flow must cover skillpack readiness, agent enablement, skill selection, dry-run plan review, explicit apply confirmation, and completion status.
- The guided flow must skip or mark steps complete when the current state already satisfies them, while showing enough context for the user to understand why no action is needed.
- The guided flow must never perform a write operation before showing a preview of the planned change and receiving explicit user approval.
- Skillpack setup must respect the immutable revision model: initial clone is allowed only when the active path is missing, and updates must use previewed revision snapshots plus approved current-link activation.
- Remote update detection in the guided flow must remain read-only until the user explicitly requests a preview or approves activation.
- Agent and skill selection must lead naturally into a dry-run link plan so users do not have to discover a separate plan/apply path manually.
- A no-op plan must be clearly presented as safe and complete, with guidance toward selecting agents or skills if the user expected links to be created.
- Gemini CLI must be selectable as a supported Agent Skills target.
- Existing read-only Status, Doctor, and Help capabilities must remain available outside the guided flow.
- The user must be able to exit the guided flow without applying pending changes.
- The guided flow must handle unexpected runtime or render failures through the safe fallback behavior, without repair or apply side effects.

## In Scope

- A wizard-style TUI path for first-run setup and normal configuration.
- State-aware step progression that tells the user what comes next.
- Preview and confirmation gates for initial setup, update activation, and link application.
- Guidance for already-complete, blocked, and no-op states.
- Continued visibility of supported agents, custom agent requirements, and Gemini's default skills target.
- Preservation of the existing TUI-first product direction and thin CLI entrypoint.

## Out of Scope

- CLI-only setup, install, update, or apply commands.
- Express, backend services, cloud sync, authentication, marketplace features, or copy fallback behavior.
- Gemini `.toml` command wrapper generation.
- Automatically pulling, repairing, resetting, formatting, committing, or otherwise mutating active skillpack checkouts.
- Overwriting unmanaged files, directories, symlinks, or manifest entries.
- Replacing Status, Doctor, or Help with the wizard; they remain available as supporting read-only views.
- Changing the skillpack contract, registry shape, or manifest entry shape.

## Acceptance Criteria

- Given a first-time user with no active skillpack snapshot, when they start the TUI, then the guided flow leads them to preview and explicitly confirm the allowed initial revision clone before continuing.
- Given an existing active skillpack snapshot, when the guided flow starts, then it does not re-clone, pull, repair, or mutate that snapshot.
- Given a remote update is available, when the user reaches the update step, then the TUI shows the preview path and requires explicit approval before the current link can change.
- Given no agents or no skills are selected, when the user reaches plan review, then the TUI explains the no-op outcome and guides them back to the relevant selection step.
- Given at least one supported agent and skill are selected, when the user reaches plan review, then the dry-run plan is shown before any link is created or removed.
- Given the dry-run plan contains conflicts or unmanaged targets, when the user reviews it, then the guided flow blocks unsafe apply and explains that unmanaged paths must be resolved outside the manager.
- Given Gemini is shown in the agent list, when the user focuses it, then the TUI presents it as supported with the default `~/.gemini/skills` target.
- Given the user confirms an apply operation, when the operation completes, then the guided flow shows the resulting completion or blocked state without implying that unmanaged files were changed.
- Given the user exits the guided flow before confirmation, when they return to the TUI, then no pending write action has been applied.

## Edge Cases

- Active skillpack checkout exists but is dirty.
- Active skillpack checkout or revision already exists in an unexpected state.
- Remote update check fails or cannot reach the remote.
- Update preview snapshot already exists.
- `registry.json` is missing and read-only fallback discovery is used.
- No skills are discovered.
- Custom agent is enabled without a valid target path.
- Planned target path contains an unmanaged file, directory, symlink, or conflicting manifest ownership.
- Manager state files are missing, malformed, or stale.
- Permission is denied while writing manager metadata or confirmed links.
- The user backs out, cancels, or exits at any step.
- Terminal size is too small to show step context comfortably.

## Risks and Constraints

- **Security:** The guided flow must not hide destructive or sensitive decisions behind automatic progression. All paths that could write manager state, create links, remove links, clone a revision snapshot, or switch the current link require explicit preview and confirmation.
- **Performance:** State inspection should stay responsive in the TUI. Remote checks and discovery should communicate progress and failure clearly instead of making the wizard feel frozen.
- **Architectural:** The CLI must remain a thin entrypoint into the Ink TUI. Core safety behavior should remain explicit and testable, and the wizard must not bypass existing planning or ownership rules.
- **Operational:** Interrupted or failed operations must leave the user with a clear status and a safe next step. Doctor may report problems, but the wizard must not repair active skillpack checkouts or unmanaged targets.
- **Product:** The wizard should reduce user thinking without removing agency. Users still need to see what will happen before any write is applied.

## Open Questions

- Should the guided flow become the default first screen, or should it be a prominent option from the existing home view? **Answer:** It should be the first default screen.
- Should partially completed wizard progress be persisted across TUI restarts, or should each launch derive progress only from current manager state? **Answer:** It should start the wizard from the beginning after relaunch if a wizard was interrupted or not fully completed.
- Should `architecture.md` be added as an authoritative layer document, or should the existing `AGENTS.md`, README, and docs remain the source of truth for layer names? **Answer:**  Yes please, create an architecture.md for the future development.

## Testing Guidelines

- Unit-test the state-to-next-step decision behavior for first-run, already-configured, no-op, blocked, and update-available states.
- Unit-test that write-capable steps cannot advance to apply or activation without a preview and explicit confirmation.
- Unit-test Gemini selectable behavior and default target rendering.
- Exercise TUI integration paths for first-run setup, agent and skill selection, dry-run plan review, no-op plan handling, conflict handling, cancellation, and successful confirmed apply.
- Mock remote update detection, skill discovery, manager state, and link planning boundaries so the guided flow can be tested without mutating skillpack repositories or agent target directories.
- Include dedicated coverage for dirty active checkouts, missing registry fallback, custom agent target validation, unmanaged conflicts, and permission failures.
