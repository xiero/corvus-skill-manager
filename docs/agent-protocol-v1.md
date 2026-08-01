# Machine Protocol v1

Every JSON command shares one versioned envelope. `schemaVersion` is the protocol version and is
independent of the install-request version and the persisted-plan version, both of which are
also currently `1`.

## Envelope

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "install.plan",
  "changed": false,
  "data": {},
  "warnings": [],
  "errors": [],
  "nextActions": []
}
```

| Field | Meaning |
|---|---|
| `schemaVersion` | Protocol version. Currently `1`. |
| `ok` | Whether the command succeeded. An idempotent no-op is a success. |
| `command` | Stable command identity, e.g. `install.plan`, `skills.search`, `agents.list`. |
| `changed` | Whether local state was modified. Read-only commands are always `false`. |
| `data` | Command-specific payload. |
| `warnings` | Non-blocking findings. Present on successes too. |
| `errors` | Non-empty exactly when `ok` is `false`. |
| `nextActions` | Machine-readable hints. Advice only — never authorization. |

In `--json` mode **stdout contains exactly one JSON document and nothing else**: no colour, no
ANSI escapes, no terminal clearing, no prompts. Diagnostics go to stderr, and only when
`--debug` is passed.

Serialization is canonical: object keys are sorted and optional fields are omitted rather than
emitted as `null` or `undefined`. Equivalent results are byte-identical, so output is safe to
diff and to snapshot.

## Warnings

```json
{
  "code": "recommendation-not-selected",
  "message": "Skill \"embedded-testing\" is recommended by a selected skill but was not selected.",
  "skillId": "embedded-testing"
}
```

`path`, `agentId`, and `skillId` appear only when relevant.

## Errors

```json
{
  "code": "UNMANAGED_TARGET_EXISTS",
  "category": "conflict",
  "message": "Target exists and is not manager-owned.",
  "retryable": false,
  "path": "/home/user/.agents/skills/example"
}
```

Branch on `code`. The `message` is for humans and may change wording; the code never changes
meaning and never changes category. `details` carries structured extras — for example
`STALE_PLAN` includes `changedComponents`, naming exactly which part of local state drifted.

### Taxonomy

| Code | Category | Exit | Meaning |
|---|---|---:|---|
| `INVALID_REQUEST` | invalid-request | 2 | Malformed flags, request document, or option value. |
| `CONFIG_INVALID` | invalid-request | 2 | `config.json` does not match its schema. |
| `SKILL_NOT_FOUND` | invalid-request | 2 | No such skill id in the active skillpack. |
| `UNKNOWN_AGENT` | invalid-request | 2 | Not a known agent adapter. |
| `CONFIG_NOT_FOUND` | conflict | 3 | Manager config does not exist yet. |
| `SKILLPACK_NOT_CONFIGURED` | conflict | 3 | No skillpack is configured. |
| `SKILLPACK_NOT_READY` | conflict | 3 | The active snapshot is missing or unreadable. |
| `SKILL_NOT_SUPPORTED_BY_AGENT` | conflict | 3 | The skill does not declare support for that agent. |
| `SKILL_CONFLICT` | conflict | 3 | Two selected skills declare a mutual conflict. |
| `AGENT_NOT_SUPPORTED` | conflict | 3 | The adapter cannot receive linked skills. |
| `AGENT_TARGET_REQUIRED` | conflict | 3 | The agent has no target path (always true for `custom`). |
| `UNMANAGED_TARGET_EXISTS` | conflict | 3 | Something not manager-owned occupies the target path. |
| `PLAN_NOT_FOUND` | confirmation | 4 | No such plan, or it is unreadable or of the wrong kind. |
| `PLAN_CONFIRMATION_REQUIRED` | confirmation | 4 | `--confirm` did not match the plan id. |
| `PLAN_DIGEST_MISMATCH` | confirmation | 4 | The stored plan was edited after it was generated. |
| `STALE_PLAN` | confirmation | 4 | Local state changed after the plan was generated. |
| `SAFETY_POLICY_BLOCKED` | safety | 5 | A safety rule refused the operation. |
| `EXTERNAL_OPERATION_FAILED` | external | 6 | git, filesystem, or network failure. Retryable. |
| `INTERNAL_ERROR` | internal | 7 | Unexpected failure. Stack traces never reach stdout. |

### Exit codes

| Exit | Meaning |
|---:|---|
| `0` | Success, including an idempotent no-op. |
| `2` | Invalid input, request, or schema. |
| `3` | Conflict or unsafe target state. |
| `4` | Explicit confirmation required, or a stale plan. |
| `5` | Safety policy blocked the operation. |
| `6` | External dependency, filesystem, git, or network failure. |
| `7` | Unexpected internal failure. |

The JSON error code is authoritative; exit codes are broad categories. When several errors are
reported, the exit code comes from the first one.

## Plan-then-apply

Every write is two-phase.

**Plan.** A plan command persists an artifact under
`~/.agents/corvus-skill-manager/plans/<plan-id>.json` containing the plan schema version, its
kind, its digest, the normalized request and intent provenance, the intended config mutation,
the ordered link operations, warnings and conflicts, and a fingerprint of the state it was
computed against. `createdAt` is recorded for audit and is deliberately excluded from the
digest, so an identical request against identical state always yields an identical plan id.

The plan id is `<kind>-<first 32 hex of the sha256 digest>`. It is filesystem-safe by
construction, and any id not matching that shape is rejected before it is used as a path.

**Apply.** The apply command re-validates, immediately before mutating:

1. the stored file parses against a strict schema;
2. the stored digest still matches the stored payload (detecting tampering);
3. `--confirm` equals the plan id exactly;
4. the current state fingerprint still matches;
5. per-operation source paths, target paths, and manifest ownership.

Only operations contained in the plan are executed. `--json` is never implicit permission.

### What the fingerprint covers

The fingerprint digests state the plan *depends on but does not itself change*: the skillpack
config and active revision, the metadata of the skills it touches, the manifest entries it does
not own, and the set of target paths. State the plan does change — the targeted agents'
selections and its own manifest entries — is validated separately, so a successful apply does
not invalidate its own plan. That is what makes re-running `install apply` an idempotent no-op
instead of a `STALE_PLAN` error.

### Operation results

`install apply` returns a per-operation status:

| Status | Meaning |
|---|---|
| `applied` | The link was created or removed. |
| `already-satisfied` | The desired state was already in place. |
| `skipped` | Safely declined; for example a broken managed link awaiting `--replace-broken-links`. |
| `blocked` | Refused for safety, e.g. an unmanaged target. |
| `failed` | The operation could not complete, e.g. a missing source. |

Any `blocked` or `failed` operation makes the command fail overall with status
`partially-applied`, while every unaffected operation still completes and config records only
what actually linked.

## Request documents

Complex requests are supplied as a JSON document:

```bash
corvus-skills install plan --request ./request.json --json
corvus-skills install plan --request - --json    # read one document from stdin
```

Empty input, invalid JSON, and multiple concatenated documents are all rejected with
`INVALID_REQUEST`. Repeated CLI flags and a request document normalize to exactly the same
request, so the two entry points cannot produce different plans.

See `docs/examples/agent-install-requests.json` for validated examples.
