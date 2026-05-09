# npm Publishing

The public runnable package is:

```text
@corvus/skill-manager
```

Users can run it without installing globally:

```bash
npx @corvus/skill-manager
```

## Package Layout

The repo publishes three public packages:

1. `@corvus/skill-manager-core`
2. `@corvus/skill-manager-tui`
3. `@corvus/skill-manager`

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
pnpm --filter @corvus/skill-manager pack --dry-run
```

## Publish

Use pnpm so `workspace:^` dependencies are packed with real semver ranges.

```bash
pnpm --filter @corvus/skill-manager-core publish --access public
pnpm --filter @corvus/skill-manager-tui publish --access public
pnpm --filter @corvus/skill-manager publish --access public
```

You must own or have publish access to the `@corvus` npm scope.

## Runtime Command

The package has a single binary:

```json
{
  "bin": {
    "corvus-skills": "./dist/index.js"
  }
}
```

Because it has one bin, `npx @corvus/skill-manager` runs the TUI directly. Global installs can also use `corvus-skills`.
