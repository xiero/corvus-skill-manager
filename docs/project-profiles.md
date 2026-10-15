# Global and project profiles

Corvus can install skills from its existing skillpacks into a particular project. Each
profile has independent agent enablement, explicit skill roots, bundle roots and target
directories. The global profile remains the default when the TUI starts or a machine
request omits `scope`.

## TUI

1. Open **Global / Project** from Home.
2. Choose a saved project, or press `n` and enter an existing directory. Git is optional.
   Selecting a directory does not register it or create skill directories.
3. Open **Guided Flow** or **Configure Agents**. In project mode, choose an agent, then
   use Space to select skills or bundles. `e` enables/disables that agent, and `t` edits
   its project target. Custom Agent requires an explicit target.
4. Press `p` to create a persisted preview. Review the roots, link changes, dependencies
   and warnings, then press `a` to apply. `b` cancels without changing configuration or links.
   The first approved installation saves the project profile.
5. Repeat for other agents. Status and Doctor inspect the profile shown in the header.

To remove a saved project, select it in **Global / Project**, press `d`, review its
owned links, and press `a`. Other profiles, project files and unmanaged links are preserved.
Directories created to contain skills are left in place. Missing or moved project roots
are reported and are never recreated automatically.

Manage Skillpacks remains shared across profiles. Updating a skillpack affects all profiles
using it; the preview lists affected projects. A skillpack cannot be removed while any
profile still selects its roots or owns links to it, even if an agent is disabled.

## Machine interface

```bash
corvus-skills projects list --json
corvus-skills install plan --project /work/company-app --agent codex --bundle team:backend --json
corvus-skills install apply --plan-id <plan-id> --confirm <plan-id> --json
corvus-skills install verify --plan-id <plan-id> --json
corvus-skills status --project /work/company-app --json
corvus-skills doctor --project /work/company-app --json
corvus-skills agents list --project /work/company-app --json
corvus-skills projects remove-plan --project /work/company-app --json
corvus-skills projects remove-apply --plan-id <plan-id> --confirm <plan-id> --json
```

Install request v2 accepts an optional `scope` and `enabled`:

```json
{
  "schemaVersion": 2,
  "scope": {"kind": "project", "rootPath": "/work/company-app"},
  "targetAgents": ["codex"],
  "selectedSkills": [],
  "selectedBundles": [{"id": "team:backend"}],
  "replaceSelection": true,
  "enabled": true
}
```

Omitted scope or `{"kind":"user"}` selects global settings. Relative project roots are
resolved against the caller's current directory; `~` uses the application home directory.
Roots are canonicalized through `realpath`, so an alias cannot register a duplicate profile.
Relative agent target paths resolve against the selected project root. Every project target
must remain inside that root, outside manager metadata and skillpack directories.

Use `enabled: false` to remove that profile's links for the targeted agents while retaining
their roots. To clear roots as well, supply empty `selectedSkills` and `selectedBundles`
with `replaceSelection: true`. With `--request`, put scope in the document; combining
`--project` with `--request` is rejected. Apply and verify take scope from the persisted
plan, never from the current directory or a separate override.

The application exposes `listProjects()`, `resolveProject({rootPath})`,
`projectRemovePlan({rootPath})`, and `projectRemoveApply({planId, confirm})`.
`status`, `doctor`, and `listAgents` accept `{scope}`. `resolveProject` is read-only and
validates a directory without saving it. The TUI and machine CLI share these use cases.

## Storage and compatibility

- Manager config v4 stores global selections in `agents` and project selections in
  `projects[canonicalRootPath] = {rootPath, agents}` under `~/.agents/corvus-skill-manager`.
- Config v1–v3 files normalize to v4 in memory. Read-only commands do not rewrite them;
  the next authorized save writes v4. Existing selections remain global.
- Manifest entries record project scope; older entries without scope remain globally owned.
  Ownership checks prevent a profile from adopting or deleting another profile's links.
- Persisted plan format v4 binds requests and link operations to the profile. Older plans
  require regeneration and fresh review. The JSON envelope remains v1; install requests
  v1 and v2 remain readable.
- Project identity, selection state, ownership and target containment are checked again
  before applying. Redirected target parents, missing/replaced roots and unmanaged targets
  block writes. Corvus does not modify `.gitignore`, create project manifests, copy skill
  sources into the project, or mutate active skillpack snapshots.

Skillpack revisions are shared. Per-project version pinning, repo-hosted skill sources,
team-shared project configuration and automatic project relocation are not implemented.

## Agent directories

Defaults verified against upstream documentation:

| Agent | Project directory | Source |
| --- | --- | --- |
| Codex | `.agents/skills` | [Codex skill roots](https://github.com/openai/codex/blob/main/codex-rs/ext/skills/src/host_roots.rs) |
| Claude Code | `.claude/skills` | [Claude Code skills](https://code.claude.com/docs/en/skills) |
| Copilot CLI | `.github/skills` | [Copilot CLI skill locations](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) |
| OpenCode | `.opencode/skills` | [OpenCode skills](https://opencode.ai/docs/skills/) |
| Pi | `.pi/skills` | [Pi skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md) |
| Gemini CLI | `.gemini/skills` | [Gemini discovery tiers](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/using-agent-skills.md) |
| Custom | Explicit project-contained path | Configured by the user |

Agents control discovery, trust and precedence. Some also discover other agents' compatible
directories or skills in ancestor projects. Corvus manages the requested links; it does not
change these discovery rules. A global skill remains globally available until separately
disabled there. Selecting it in a project does not narrow its global visibility.
