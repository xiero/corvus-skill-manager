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

The CLI is intentionally thin. It launches the Ink TUI and does not implement separate command workflows.

Corvus Skill Manager configures a local skillpack snapshot, discovers skills, detects remote collection updates, lets you choose target agents, previews link operations, and applies only confirmed manager-owned links.

The active skillpack checkout is read-only. Updates use immutable `revisions/<commit>/repo` snapshots and an approved `current` link switch; the manager does not pull, reset, repair, edit, install dependencies, or execute scripts inside the checkout.
