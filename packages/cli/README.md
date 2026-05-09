# @corvus/skill-manager

Run Corvus Skill Manager from npm:

```bash
npx @corvus/skill-manager
```

Or install globally:

```bash
npm install -g @corvus/skill-manager
corvus-skills
```

The CLI is intentionally thin. It launches the Ink TUI and does not implement separate command workflows.

Corvus Skill Manager configures a local skillpack checkout, discovers skills, lets you choose target agents, previews link operations, and applies only confirmed manager-owned links.

The skillpack checkout is read-only after the optional initial clone. The manager does not pull, update, reset, repair, edit, install dependencies, or execute scripts inside the checkout.
