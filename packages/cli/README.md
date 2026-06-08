# @corvus-tools/skill-manager

Run Corvus Skill Manager from npm:

```bash
npx @corvus-tools/skill-manager
```

Or install globally:

```bash
npm install -g @corvus-tools/skill-manager
corvus-skills
```

When launched from a global install, the TUI checks npm for a newer manager release
and shows the update command on Home when one is available:

```bash
npm install -g @corvus-tools/skill-manager@latest
```

The TUI only displays the command; it does not run npm or mutate its own install.

The CLI is intentionally thin. It launches the Ink TUI and does not implement separate command workflows.

Corvus Skill Manager configures a local skillpack snapshot, discovers skills, detects remote collection updates, lets you choose target agents, previews link operations, and applies only confirmed manager-owned links.

The active skillpack checkout is read-only. Updates use immutable `revisions/<commit>/repo` snapshots and an approved `current` link switch; the manager does not pull, reset, repair, edit, install dependencies, or execute scripts inside the checkout.
