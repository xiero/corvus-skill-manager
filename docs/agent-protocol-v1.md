# Machine Protocol v1

Every JSON command shares one versioned envelope. `schemaVersion` is the protocol version and is
independent of the install-request and persisted-plan versions. The envelope remains v1; the
current install request is v2 and the current persisted plan is v3.

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
| `SKILL_NOT_FOUND` | invalid-request | 2 | No such qualified or default-pack skill id in the readable configured catalogs. |
| `BUNDLE_NOT_FOUND` | invalid-request | 2 | No such qualified or default-pack bundle id in the readable configured catalogs. |
| `BUNDLE_NOT_SUPPORTED_BY_AGENT` | conflict | 3 | A selected bundle member or transitive dependency does not support the target agent; the bundle is atomic. |
| `BUNDLE_MEMBER_MISMATCH` | conflict | 3 | A selected bundle's member graph is unavailable or inconsistent with the readable snapshot. |
| `VERSION_MISMATCH` | conflict | 3 | The active snapshot does not satisfy a required skill or bundle-member version constraint. |
| `UNKNOWN_AGENT` | invalid-request | 2 | Not a known agent adapter. |
| `CONFIG_NOT_FOUND` | conflict | 3 | Manager config does not exist yet. |
| `SKILLPACK_NOT_CONFIGURED` | conflict | 3 | No skillpack is configured. |
| `SKILLPACK_NOT_READY` | conflict | 3 | The active snapshot is missing or unreadable. |
| `SKILL_NOT_SUPPORTED_BY_AGENT` | conflict | 3 | The skill does not declare support for that agent. |
| `SKILL_CONFLICT` | conflict | 3 | Two selected skills declare a mutual conflict. |
| `SKILL_TARGET_NAME_CONFLICT` | conflict | 3 | Skills from different packs would claim the same agent target directory. |
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
kind, its digest, normalized request provenance, final root skill/bundle selections, effective
skills with origins, the intended Config v3 mutation, ordered link operations, warnings and
conflicts, and a state fingerprint. `createdAt` is recorded for audit and deliberately excluded
from the digest, so identical input and state yield the same plan id.

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

The fingerprint has independently diffable components for configured/active skillpacks,
decision-relevant Registry v3 skill and selected bundle definitions, recognized before/after
root selections, unmanaged manifest state, and target paths. Volatile config timestamps and
unrelated catalog entries are excluded. Recognizing either reviewed root state keeps successful
and partial re-apply idempotent; a third root state is stale.

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

The current request schema is `corvus.install-request.v2`. It accepts `selectedSkills`,
`selectedBundles`, or both; each bundle entry is `{ "id": "<qualified-or-default-pack-id>" }`.
`replaceSelection: true` replaces both root collections. `allCompatible` remains mutually
exclusive with explicit roots and selects individual skills only. Legacy request v1 documents
remain readable and preserve existing bundle roots because v1 could not express them.

Equivalent bundle flag transport is available for simple requests:

```bash
corvus-skills bundles list --agent codex --json
corvus-skills bundles search --query "review quality" --agent codex --json
corvus-skills bundles inspect team:review-workflow --json
corvus-skills install plan --agent codex --bundle team:review-workflow --json
```

`--bundle` is repeatable and may be combined with repeatable `--skill`. Explicit roots remain
mutually exclusive with `--all-compatible`. Bundle discovery is read-only; the install flag
creates a persisted plan and is not an apply shortcut.

See `docs/examples/agent-install-requests.json` for validated examples.

## Multiple skillpacks

The protected default source is `corvus-skillpack`. Additional sources are addressed with
`--skillpack-id` on setup, status, update, and removal operations. Catalog entries include a
qualified `ref` such as `team-pack:private-review`; install and inspect accept that form.
Legacy unqualified IDs deterministically mean `corvus-skillpack:<id>`.

`skillpack remove-plan --skillpack-id <id>` refuses the default pack and any pack still used by
agent selections or managed links. Confirmed `remove-apply` unregisters the source without
deleting its immutable revision snapshots.
