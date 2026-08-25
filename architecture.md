# Corvus Skill Manager Architecture

Corvus Skill Manager is a TUI-first TypeScript application with two adapters over one shared
application layer: the Ink TUI for humans and a deterministic machine JSON CLI for coding
agents. Running `corvus-skills` with no arguments still launches the TUI.

See `docs/agent-native-architecture.md` for the full adapter/application/domain boundary and
the machine-interface invariants.

## Layers

1. **CLI package (`packages/cli`)**
   - Owns the runnable `corvus-skills` binary.
   - Boots the Ink TUI when invoked with no arguments.
   - Routes subcommands and `--help` to the machine CLI without initializing Ink.
   - May own transport concerns only: argv parsing, request-document reading, protocol
     serialization, and exit-code mapping.
   - Must not grow independent business logic. Workflow logic belongs in the application layer.

2. **TUI package (`packages/tui`)**
   - Owns user navigation, guided flow orchestration, previews, and confirmations.
   - Starts in the Guided Flow wizard by default.
   - Keeps Home, Status, Doctor, Help, and manual advanced setup/configuration screens available.
   - Receives a `CorvusApplication` through React context and calls shared use cases rather
     than reproducing workflow logic. Status, Doctor, and Skill Discovery are on use cases.
   - The skillpack screens and the wizard's selection/link preview still call core primitives
     directly because they operate on an unsaved, user-edited config and express per-agent
     enable, disable, explicit skill roots, and bundle roots in one pass — neither has an
     equivalent use case. Bundle/dependency expansion remains in the shared pure resolver; the
     TUI only presents its roots, provenance, compatibility, and link-plan output. These are the
     same engines the application layer calls, not a second implementation; see
     `docs/agent-native-architecture.md`.
   - May trigger write-capable operations only after rendering the relevant preview and
     receiving explicit user confirmation.
   - Maps protocol error codes to human sentences; never renders raw protocol JSON.

3. **Core package (`packages/core`)**
   - Owns pure planning logic, schema validation, path safety, git inspection/setup helpers, discovery, manifest handling, lock handling, and link application.
   - Also owns the shared application layer (`src/application/`): the versioned machine
     protocol (`protocol/`), persisted plan artifacts (`plans/`), the install request contract
     and planner (`install/`), the catalog/search scorer (`skills/`), and the high-level use
     cases (`useCases/`) exposed through `CorvusApplication` / `createCorvusApplication`.
   - Owns the single implementation of setup, discovery, planning, apply, and verification.
     Both adapters reach that implementation — the machine CLI through use cases, the TUI
     through use cases where one exists and otherwise through the same underlying engines.
   - Returns protocol result types, never rendered strings and never Ink elements.
   - Should remain testable without Ink and without spawning the CLI.
   - Must contain no command-line parsing.
   - Filesystem side effects must stay isolated in small modules with explicit inputs and deterministic outcomes.

## State And Writes

These are invariants of the manager, not conventions of any one interface. They hold
identically for the TUI and the machine CLI, and are enforced in the domain and application
layers rather than by a screen or a prompt.

All mutable manager metadata lives under:

```text
~/.agents/corvus-skill-manager
```

The manager may write only:

- its own config, lock, manifest, plan, cache, and log files under `~/.agents/corvus-skill-manager`
- immutable skillpack revision snapshots and the manager-owned `current` link under `~/.agents/skillpacks/<skillpack-id>`
- confirmed manager-owned symlinks or junctions inside configured agent target directories

The manager must never overwrite or modify an unmanaged file, directory, symlink, or junction;
unsafe targets are skipped and reported, never replaced. Disable and remove operations may
remove only manifest-owned links. Read-only commands must not mutate state at all, including
creating a default config as a side effect. `--json` is never implicit authorization: every
mutation requires a write command plus an exact confirmation token matching a persisted plan.

## Skillpack Revision Model

The required local layout is:

```text
~/.agents/skillpacks/<skillpack-id>/
  revisions/
    <commit>/
      repo/
  current -> revisions/<active-commit>/repo
```

Initial clone is allowed only when the active `current` path does not exist. Existing active checkouts and existing revisions are inspected and reported; they are not repaired, updated, formatted, reset, re-cloned over, committed, pulled, or pushed.

Manager Config v3 retains the ID-keyed collection of skillpacks introduced in v2.
`corvus-skillpack` remains the protected default and additional packs use the same independent
revision layout. Skills retain their
repository-local ID for the target directory and gain a qualified
`<skillpack-id>:<skill-id>` selection identity. Registry relationships are scoped to their
declaring pack, and cross-pack target-name collisions are explicit plan conflicts.

Remote change detection is read-only and compares the active commit with `git ls-remote`. Approved updates create or reuse an immutable revision snapshot under `revisions/<commit>/repo`, then switch the manager-owned `current` link only after a preview and an explicit approval — `a` in the TUI, or a matching `--confirm` plan token in the machine CLI.

## Registry v3 Bundles And Selection Semantics

The frozen feature contract for Registry v3, bundles, semantic versions, selection, migration,
and normative Registry/Config examples is
[`_specs/registry-v3-bundles-and-versioning.md`](_specs/registry-v3-bundles-and-versioning.md).
The public authoring contract is [`docs/skillpack-contract.md`](docs/skillpack-contract.md).

- A **skill** is a linkable capability; a **bundle** is a named composition of skills with no
  filesystem target or runtime of its own; a **skillpack** is the immutable repository snapshot
  that distributes both.
- Registry v3 requires canonical SemVer on every skill and bundle. Version ranges express
  compatibility against the single version in the active snapshot; the skillpack Git commit
  remains the exact physical reproducibility lock. Corvus is not a multi-version resolver.
- Bundles contain only skills from their declaring skillpack. Nested bundles, cross-skillpack
  members, and bundle-owned workflow execution are outside Registry v3.
- Manager Config v3 persists **root selections** (explicit skills and bundles) separately. The
  **effective selection** is derived from those roots, bundle members, and transitive hard
  dependencies; it is not persisted in config or manifest. Existing Config v1/v2 skill
  selections migrate conservatively as explicit skill roots.
- Config v1/v2/v3 are accepted as persisted input, but core normalizes every successful read to
  the canonical v3 in-memory model. This normalization is side-effect free; only an already
  authorized write workflow may persist v3. The shared pure selection read model in
  `packages/core/src/skills/selectionModel.ts` keeps canonical skill/bundle roots separate from
  deduplicated effective skills and retains every provenance path.
- The pure resolver pipeline expands qualified bundle roots to authored direct members, merges
  them with skill roots, and then traverses same-skillpack hard dependencies. Effective skills
  remain unique while explicit, all-compatible, bundle-member, and dependency origins stay
  independently explainable; transitive bundle roots are retained for diagnostics.
- Agent compatibility and symmetric conflicts are evaluated only after complete effective
  expansion. Any unsupported bundle member or dependency blocks the whole agent plan, and
  recommendations from effective skills remain advisory rather than becoming roots or links.
- Registry v1/v2 remain readable without inferred versions or manager-authored migration.
  `allCompatible` continues to mean compatible individual skills and never selects bundles.
- Bundle-aware writes use the same shared application/core plan-then-apply path as individual
  skills. Read-only operations stay side-effect free, adapters do not duplicate resolution
  logic, the manifest remains a link-ownership ledger, and active skillpack snapshots remain
  immutable.
- The machine adapter exposes `bundles list`, `bundles search`, and `bundles inspect` as
  deterministic read-only views over the shared bundle catalog. `install plan --bundle <ref>`
  transports exact bundle roots into request v2 and still requires the persisted plan plus exact
  confirmation before any write.
- Guided Flow presents Bundles before Individual Skills, keeps both as unsaved per-agent roots,
  and derives `[x]`/`[~]`/incompatible states across enabled agents. Bundle details expose
  versions, direct member ranges, actual snapshot versions, and compatibility reasons before
  selection. The dry-run plan groups explicit roots, derived members/dependencies, provenance,
  warnings/conflicts, and link operations; only the later explicit `a` approval persists Config
  v3 roots and applies manager-owned links.
- Install request v2 accepts explicit skill and bundle roots while preserving v1 skill-only
  reads. Persisted plan schema v3 shows final roots, effective provenance, and link operations
  independently; replacement recomputes the effective set instead of maintaining refcounts.
- Stale-plan fingerprints cover selected bundle definitions, relevant versioned skill metadata,
  and recognized before/after root state. Confirmed apply persists Config v3 roots while the
  manifest remains link-only, and verify reports roots, effective skills, actual managed links,
  missing derived links, and stale owned links without repair.
- Skillpack update preview reads the active and inactive candidate snapshots and produces one
  deterministic semantic comparison in core. `skillDeltas` and `bundleDeltas` identify
  add/remove/change status, declared versions, and major/minor/patch/same/unknown classification;
  `affectedBundles` explains which configured bundle roots have changed effective members.
  Major changes are advisory breaking risks only. Both TUI surfaces and machine JSON present this
  shared model, and revision activation still requires the persisted update plan plus explicit
  confirmation.
- Maintainer CI can compare two explicit Registry v3 roots with the read-only
  `skills check-version-discipline` command. It fingerprints complete skill directories without
  following symlinks and reports changed skills/bundles whose declared SemVer precedence did not
  move; it never writes either root or chooses a patch/minor/major bump.

## Link Planning And Apply

In the TUI, agent, bundle-root, and skill-root selections are draft state until confirmed apply.
The shared effective-selection resolver expands those roots before `generateLinkPlan`; React does
not own expansion rules. In the machine CLI there is no draft state: a selection arrives as one
request and is planned in a single step. Either way, link creation/removal is always planned first.

For the machine CLI, plan-then-apply is additionally made explicit and durable: `install plan`
persists a digest-identified plan artifact plus a fingerprint of the state it was computed
against, and `install apply --plan-id <id> --confirm <id>` revalidates schema, digest,
confirmation, and fingerprint before executing only the operations contained in that plan.
Stale, tampered, or unconfirmed plans are rejected with stable machine error codes.

The dry-run plan must show:

- create-link and remove-link operations
- conflicts for unmanaged target paths
- warnings for missing targets, unknown skills, unsupported agents, or already-present managed links

`applyLinkPlan` may run only after final confirmation. It creates or removes manager-owned links, updates the manifest, and skips unsafe targets instead of overwriting unmanaged paths.

## Agent Support

Supported MVP agents can receive linked skills. Custom agents require a target path. Gemini CLI uses Agent Skills directory links under `~/.gemini/skills`; the manager does not generate Gemini `.toml` command wrappers.

## Development Rules

- Prefer pure functions in core modules.
- Keep path handling explicit and reject traversal or unmanaged overwrite cases.
- Do not add Express or a backend.
- Do not add write behavior to read-only views such as Status, Doctor, discovery, or Help,
  or to read-only machine commands.
- Do not embed an LLM, require an AI API key, or make an invisible semantic choice. Semantic
  interpretation belongs to the calling agent; Corvus executes deterministic operations.
- Do not add an MCP adapter; keep the application layer as the seam for one later.
- Verification for implementation work is `pnpm typecheck` and `pnpm test`.

## Testing Layout

Tests are colocated as `*.test.ts(x)` next to the code under test. Shared fixtures and harnesses
live in `test/support/` at the repo root: a representative registry v2 skillpack, a stub git
runner that records every invocation, temporary-HOME creation, and directory-tree diffing used
to assert that read-only commands write nothing. Shared deterministic fixtures cover Registry
v1/v2/v3, overlapping bundles, transitive dependencies, recommendations, conflicts, and
duplicate local IDs across skillpacks. Platform-decision tests exercise POSIX directory
symlinks and injected Windows junction behavior without requiring both operating systems in CI.
