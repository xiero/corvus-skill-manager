# npm Publishing

The public runnable package is:

```text
@corvus-tools/skill-manager
```

Users can run it without installing globally:

```bash
npx @corvus-tools/skill-manager
```

## Package Layout

The repo publishes three public packages:

1. `@corvus-tools/skill-manager-core`
2. `@corvus-tools/skill-manager-tui`
3. `@corvus-tools/skill-manager`

The CLI package depends on the TUI package, and the TUI package depends on the core package. Publish in that order.

## Prepublish Checklist

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

Verify the CLI package contents:

```bash
pnpm --filter @corvus-tools/skill-manager pack --dry-run
```

## Publish

Use pnpm so `workspace:^` dependencies are packed with real semver ranges.

```bash
pnpm --filter @corvus-tools/skill-manager-core publish --access public
pnpm --filter @corvus-tools/skill-manager-tui publish --access public
pnpm --filter @corvus-tools/skill-manager publish --access public
```

You must own or have publish access to the `@corvus-tools` npm scope.

## Runtime Command

The package has a single binary:

```json
{
  "bin": {
    "corvus-skills": "./dist/index.js"
  }
}
```

Because it has one bin, `npx @corvus-tools/skill-manager` runs the TUI directly.

Global installs can also use `corvus-skills`.

```bash
npm install -g @corvus-tools/skill-manager
corvus-skills
```

Global installs perform a read-only npm latest-version check on TUI startup. If a newer
manager release exists, Home shows:

```bash
npm install -g @corvus-tools/skill-manager@latest
```

The TUI only displays the command; it does not execute npm or modify its own install.
