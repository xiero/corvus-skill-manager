Timestamp: 2026-05-20T19:31:57Z
Version: v1.0.0

# Spec: Cancelable TUI Field Editing

## Summary

Corvus Skill Manager should let users cancel inline edits for every editable TUI parameter. When a user starts changing a field such as the skillpack ID or active path and then presses `h` or `q` while still editing, the edit should be discarded and the field should return to the value that was visible before editing began. This protects users from accidental draft changes while preserving the existing Home and quit behavior outside edit mode.

## Motivation

Inline TUI editing currently makes it too easy to get stuck with accidental edits when the user changes their mind. Users expect a safe escape path: pressing a familiar navigation or quit key during editing should first cancel the edit instead of saving partial text or immediately leaving the screen.

## Affected Layers

- TUI package (`packages/tui`) - **modified**
- Core package (`packages/core`) - **read-only**
- CLI package (`packages/cli`) - **read-only**

## Reference Documents

- `architecture.md` - sections: Layers; State And Writes; Development Rules
- `AGENTS.md` - sections: Project Direction; Manager State And Writes; Implementation Notes; Done Criteria

## Functional Requirements

- Every inline-editable TUI parameter must support canceling the active edit.
- While a field is in edit mode, pressing `h` or `q` must cancel the edit, exit edit mode, and restore the value that was visible when edit mode began.
- If the restored value was an application default, the default must be shown again, such as `corvus-skillpack` for the default skillpack ID.
- If the restored value was an existing configured custom value, that configured value must be shown again rather than being replaced by a package default.
- Canceling an edit must not save config, inspect a skillpack, clone a revision, switch a revision, generate a link plan, or apply links.
- Outside edit mode, existing `h` and `q` behavior must remain unchanged.
- Confirming an edit with the existing confirmation key must continue to accept the edited value.
- Any dependent default-derived field must remain consistent after canceling the source field edit, so canceled text must not leave stale dependent values behind.
- The TUI must make the cancel behavior discoverable in the relevant key hints while editing.

## In Scope

- Cancel behavior for skillpack setup fields such as skillpack ID, repository URL, branch, and active path.
- Cancel behavior for the same skillpack fields inside the guided flow.
- Cancel behavior for editable agent target paths inside agent configuration and guided flow screens.
- Restoration of default-backed values and existing configured values after canceling.
- Tests that prove cancel does not trigger manager writes or navigation while edit mode is active.

## Out of Scope

- Changing the default skillpack ID, repository URL, branch, or active path values.
- Adding persistent undo history after an edit has been confirmed.
- Reverting saved manager config, applied link plans, or activated skillpack revisions.
- Adding CLI-only edit or cancel commands.
- Changing skillpack update, clone, preview, or activation behavior.
- Adding Gemini support beyond the existing deferred display.

## Acceptance Criteria

- Given the skillpack ID field shows `corvus-skillpack`, when the user enters edit mode, types another value, and presses `q`, then edit mode exits and the field again shows `corvus-skillpack`.
- Given the active path field shows its default value, when the user enters edit mode, changes the text, and presses `h`, then edit mode exits and the default active path is restored.
- Given an editable field starts with a configured custom value, when the user changes it and cancels, then the custom value from before edit mode is restored.
- Given a field is in edit mode, when the user presses `h` or `q`, then the screen does not navigate Home or quit on that keypress.
- Given no field is in edit mode, when the user presses `h` or `q`, then the current screen keeps its existing navigation behavior.
- Given the user confirms an edit instead of canceling, then the edited draft value remains visible and the existing workflow continues.
- Given the user cancels an edit, then no manager config, lock, manifest, skillpack revision, or agent target filesystem state is changed.

## Edge Cases

- The user deletes all text from a field and then cancels.
- The user changes a field that normally controls a default-derived dependent field and then cancels.
- The user cancels a field that began with a configured custom value rather than a default.
- The user presses `h` or `q` repeatedly after a cancel.
- The user cancels while discovery, inspection, or another non-edit background read is already displaying stale information.
- The user enters edit mode, types nothing, and cancels.

## Risks and Constraints

- **Security:** The feature must not introduce new filesystem writes or skillpack mutations. It should only affect unsaved TUI draft state.
- **Performance:** Canceling must be immediate and must not trigger remote checks, filesystem scans, or plan generation.
- **Architectural:** Edit cancellation belongs in TUI state handling and must not push UI-only draft behavior into core planning or filesystem layers.
- **Operational:** Users must not lose confirmed configuration or applied state because cancel is only for the active unconfirmed edit session.

## Open Questions

None.

## Testing Guidelines

- Unit-test editable field cancellation for default-backed values, configured custom values, empty in-progress input, and unchanged input.
- Test that `h` and `q` cancel edit mode before they perform screen navigation.
- Test that normal `h` and `q` behavior still works when no field is being edited.
- Test skillpack field dependencies so canceling a source field does not leave stale dependent draft values.
- Exercise the guided flow and manual setup/configuration paths that expose editable parameters.
