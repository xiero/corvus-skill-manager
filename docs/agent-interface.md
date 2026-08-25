# Agent Interface

This document is for **coding agents** (Codex, Claude Code, Gemini CLI, Copilot CLI, OpenCode,
Pi Agent, and others) operating Corvus Skill Manager on a user's behalf.

The division of labour is fixed:

- **You** interpret the user's natural language, choose exact skill IDs, and decide what to ask
  the user about.
- **Corvus** executes deterministic, safe, reviewable operations. It never embeds an LLM, never
  calls a network search, and never makes a semantic choice invisibly.

Never parse TUI output. Every fact you need is available as JSON.

## Discovery entrypoint

```bash
corvus-skills capabilities --json
```

That single call tells you the protocol version, every supported command, whether each is
read-only or write-capable, the confirmation model, the supported agent adapters, the request
schema identifier, the relevant paths, and the exit-code contract. You need nothing else to
learn the workflow.

## Recommended algorithm

1. **Locate the binary.** `corvus-skills` on `PATH`, or `npx @corvus-tools/skill-manager`.
2. **Call capabilities.** `corvus-skills capabilities --json`.
3. **Call status.** `corvus-skills status --json`. Read `data.report.skillpack` and the
   `nextActions` array.
4. **Make the skillpack ready if needed.** If there is no skillpack, or its active snapshot is
   missing:
   ```bash
   corvus-skills skillpack setup-plan --json
   corvus-skills skillpack setup-apply --plan-id <id> --confirm <id> --json
   ```
5. **Find candidates.** Translate the user's intent into search terms and search skills and/or
   maintained bundles:
   ```bash
   corvus-skills skills search --query "embedded firmware c cpp cmake stm32 debugging" --agent codex --json
   corvus-skills bundles search --query "embedded firmware workflow" --agent codex --json
   ```
   Use `skills list` or `bundles list` for a whole catalog. Inspect exact candidates with
   `skills inspect <id...>` or `bundles inspect <id...>`; bundle inspection includes member
   ranges, actual versions, and per-agent compatibility. `--include-content` additionally
   returns `SKILL.md` for named skills only because bundles have no content file.
6. **Choose exact IDs.** Search returns `score`, `matchedFields`, and `matchedTerms` for every
   candidate so you can explain your choice — and so can the user. Ranking is lexical and
   deterministic; the final selection is yours, not Corvus's.
7. **Plan.**
   ```bash
   corvus-skills install plan --agent codex --skill embedded-driver-development \
     --reason 'embedded-driver-development=Relevant to embedded C/C++ driver work.' \
     --intent 'Install a balanced set for embedded development' \
     --selection-policy balanced --json
   ```
8. **Inspect conflicts and warnings.** Read `data.plan.rootSelections`,
   `data.plan.selections`, `data.plan.summary`, `data.plan.conflicts`, and the envelope's
   `warnings`. Pay attention to `bundleMembersAdded`, `dependenciesAdded`, and
   `recommendationsNotSelected`.
9. **Apply with exact confirmation.**
   ```bash
   corvus-skills install apply --plan-id <id> --confirm <id> --json
   ```
   The confirmation token must be the plan id, verbatim. `--json` is not authorization.
10. **Verify and report.**
    ```bash
    corvus-skills install verify --plan-id <id> --json
    ```
    Report `data.status` to the user: `verified`, `verified-no-op`, `partially-applied`,
    `drift-detected`, or `blocked`.

## Reviewing skillpack updates

Run `corvus-skills skillpack update-preview --json` only when the user has asked to review or
perform an update. When an update exists, inspect `data.plan` before requesting activation:

- `skillDeltas` and `bundleDeltas` contain `id`, `change` (`added`, `removed`, or `changed`),
  optional `previousVersion` / `nextVersion`, `versionChange` (`major`, `minor`, `patch`, `same`,
  or `unknown`), and `breakingRisk`.
- `affectedBundles` contains configured bundle roots affected by their own definition or by a
  changed direct/transitive effective skill. Each entry includes deterministic human-readable
  reasons and an aggregate `breakingRisk` flag.
- Registry v1/v2 or registryless comparisons use `unknown`; do not infer a semantic version.
- A major change is an advisory breaking risk. It does not approve, reject, or apply the update.

Activation remains a separate exact-confirmation command:

```bash
corvus-skills skillpack update-apply --plan-id <id> --confirm <id> --json
```

## Checking maintainer version discipline

For skillpack CI, compare two explicit Registry v3 checkout roots without manager setup:

```bash
corvus-skills skills check-version-discipline \
  --base <base-checkout> --candidate <candidate-checkout> --json
```

Inspect `data.skillDeltas`, `data.bundleDeltas`, and `data.issues`. By default, unchanged-version
findings return `VERSION_MISMATCH` and a non-zero conflict exit; `--severity warning` returns the
same `valid: false` report as a successful advisory result. This command is read-only and never
selects a bump, writes manager state, or changes either checkout.

## Authorization behaviour

An explicit user request to install skills authorizes the normal path: creating manager-owned
links additively, for the agents the user named, under those agents' configured target
directories.

**Ask the user again before** any of the following:

| Situation | Why |
|---|---|
| The user did not clearly name which agent(s) to install for | Installing into the wrong agent's directory is user-visible and confusing. |
| `install plan` fails with `UNMANAGED_TARGET_EXISTS` | Something the manager does not own is in the way. Only the user can decide to move it. |
| You are considering `--replace-selection` | Replacement removes skill and bundle roots the user previously chose. Show the removals first. |
| `skillpack update-preview` / `update-apply` was not clearly requested | Activating a new skillpack revision changes what every linked skill resolves to. |
| `install apply` reports `partially-applied`, or verify reports `blocked` / `drift-detected` | The user needs to know, and the resolution is theirs. |
| A plan's warnings include skill risk findings (`scripts-directory`, `suspicious-*`) | The user should decide whether to install a skill that ships scripts. |

**Never** bypass a safety block. Corvus refuses to overwrite unmanaged files, to remove links it
does not own, and to mutate the active skillpack checkout. If a command refuses, relay the
reason and the `nextActions`; do not look for another route to the same effect.

## Error handling

Errors carry a stable `code`, a `category`, and a human `message`. Branch on `code`, not on
message text. See `docs/agent-protocol-v1.md` for the full taxonomy and the exit-code contract.

Common recoveries:

| Code | What to do |
|---|---|
| `CONFIG_NOT_FOUND`, `SKILLPACK_NOT_CONFIGURED`, `SKILLPACK_NOT_READY` | Run the skillpack setup plan/apply pair. |
| `SKILL_NOT_FOUND` | Re-run `skills list` or `skills search`; you used a display name or a stale id. |
| `SKILL_NOT_SUPPORTED_BY_AGENT` | Pick a different skill for that agent, or a different agent. Do not drop it silently — tell the user. |
| `SKILL_CONFLICT` | Two selected skills declare a conflict. Ask the user which one they want. |
| `AGENT_TARGET_REQUIRED` | Supply `agentTargetPaths` for that agent (always required for `custom`). |
| `UNMANAGED_TARGET_EXISTS` | Ask the user to move the file, or drop that skill. |
| `PLAN_CONFIRMATION_REQUIRED` | Repeat the plan id exactly as `--confirm`. |
| `STALE_PLAN`, `PLAN_DIGEST_MISMATCH`, `PLAN_NOT_FOUND` | Regenerate the plan, re-review it, then apply the new id. Never auto-apply a regenerated plan the user has not seen. |
| `EXTERNAL_OPERATION_FAILED` | Retryable. Usually git or the network. |

## Worked examples

Runnable request documents for each of these live in
[`examples/agent-install-requests.json`](examples/agent-install-requests.json).

### 1. Install named skills for one agent

> "Install `spec-unleashed` and `git-commit` for Codex."

```bash
corvus-skills install plan --agent codex --skill spec-unleashed --skill git-commit --json
corvus-skills install apply --plan-id <id> --confirm <id> --json
corvus-skills install verify --plan-id <id> --json
```

### 2. Install the whole compatible skillpack

> "Use Corvus Skill Manager to install the whole compatible skillpack for yourself."

```bash
corvus-skills install plan --agent claude --all-compatible --json
corvus-skills install apply --plan-id <id> --confirm <id> --json
```

`--all-compatible` selects every discovered skill that declares support for each target agent,
then expands required dependencies. Skills that do not support the agent are simply not
selected; the plan reports what was included.

### 3. Broad intent: embedded development

> "Install a balanced set of skills useful for embedded development."

```bash
corvus-skills skills search --query "embedded firmware c cpp cmake stm32 debugging" --agent codex --json
corvus-skills skills inspect embedded-driver-development embedded-testing --json
```

Then hand your exact choice back with provenance:

```bash
corvus-skills install plan --request - --json <<'JSON'
{
  "schemaVersion": 2,
  "intent": "Install a balanced skill set for embedded development",
  "selectionPolicy": "balanced",
  "targetAgents": ["codex"],
  "selectedSkills": [
    {"id": "embedded-driver-development", "reason": "Relevant to embedded C/C++ driver implementation."},
    {"id": "embedded-testing", "reason": "Adds unit-testing and hardware abstraction guidance."}
  ]
}
JSON
```

`embedded-driver-development` declares `requires: ["embedded-toolchain"]`, so the plan adds that
dependency with reason `dependency-of:embedded-driver-development`. Report added dependencies to
the user.

### 4. Discover and install a bundle

Search and inspect before selecting the exact qualified bundle ref:

```bash
corvus-skills bundles search --query "review quality pull request" --agent codex --json
corvus-skills bundles inspect corvus-skillpack:review-workflow --json
corvus-skills install plan --agent codex --bundle corvus-skillpack:review-workflow --json
```

The dedicated flag and request-v2 document below normalize to the same bundle root:

```bash
corvus-skills install plan --request - --json <<'JSON'
{
  "schemaVersion": 2,
  "targetAgents": ["codex"],
  "selectedBundles": [{"id": "corvus-skillpack:review-workflow"}]
}
JSON
```

The plan persists the bundle as a root, lists its members and dependencies as effective skills,
and links only skills. `allCompatible` never chooses bundles.

### 5. Broad intent: React and Node web development

> "Install only the essential skills for React and Node web development."

```bash
corvus-skills skills search --query "react node typescript web frontend api" --agent codex --json
```

`selectionPolicy: "minimal"` records that you interpreted "only the essential" narrowly. It is
audit provenance — Corvus does not second-guess your judgement with it.

### 6. Multiple target agents

> "Install `spec-unleashed` and `git-commit` for Codex and Claude Code."

```bash
corvus-skills install plan --agent codex --agent claude --skill spec-unleashed --skill git-commit --json
```

One plan covers both agents. If a skill supports one agent but not the other, planning fails
with `SKILL_NOT_SUPPORTED_BY_AGENT` — tell the user rather than quietly installing a subset.

### 7. Conflict recovery

```bash
corvus-skills install plan --agent codex --skill git-commit --json
# exit 3, errors[0].code = UNMANAGED_TARGET_EXISTS, errors[0].path = ~/.agents/skills/git-commit
```

Report the path to the user. After they move it, plan again — the old plan id is not reusable,
and Corvus will not overwrite the file for them.

### 8. First-run skillpack setup

```bash
corvus-skills status --json                 # skillpack absent
corvus-skills skillpack setup-plan --json   # reports repo, branch, id, active path, revision path
corvus-skills skillpack setup-apply --plan-id <id> --confirm <id> --json
corvus-skills skills list --json
```

Setup clones only when the active snapshot is absent. Re-running a successful setup is an
idempotent no-op that inspects the existing snapshot rather than repairing or re-cloning it.

**Check the plan's warnings, not just its exit code.** `setup-plan` succeeds with exit 0 even
when it could not read the remote branch head — a mistyped `--branch`, or an unreachable
repository. It reports this as a `remote-head-unreadable` warning and omits
`data.plan.expectedCommitHash`; the failure would otherwise only surface at `setup-apply`
(exit 6). If you see that warning, confirm the repository and branch with the user before
applying.
