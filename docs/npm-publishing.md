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

The CLI package depends on **both** the TUI package and the core package (the core dependency is
direct since the CLI serializes the machine protocol), and the TUI package depends on the core
package. Publish in that order: core, TUI, CLI.

Because all three carry the same version and depend on each other with `workspace:^` — which
pnpm rewrites to `^<version>` at pack time — a release must publish all three together. Shipping
a new CLI against an older published core would resolve to a core without the application layer.

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

Check that no compiled test artifacts (`dist/**/*.test.js`) are present. If any appear, the
`dist` directories hold stale output from before tests were excluded from the build — remove
`packages/*/dist` and rebuild.

### Packed smoke test

`pnpm --filter <pkg> exec corvus-skills …` is not a reliable check: pnpm does not link a
package's own bin into its own `node_modules/.bin`, so the name may resolve to a globally
installed release instead of the local build. Verify against a real packed install instead:

```bash
mkdir -p /tmp/corvus-smoke && cd /tmp/corvus-smoke && npm init -y
for p in core tui cli; do (cd <repo>/packages/$p && pnpm pack --pack-destination /tmp/corvus-smoke); done
npm install ./corvus-tools-skill-manager-core-*.tgz \
            ./corvus-tools-skill-manager-tui-*.tgz \
            ./corvus-tools-skill-manager-*.tgz

./node_modules/.bin/corvus-skills --help
./node_modules/.bin/corvus-skills capabilities --json
./node_modules/.bin/corvus-skills status --json     # exit 0 on a fresh HOME, creates nothing
./node_modules/.bin/corvus-skills                   # no arguments still launches the TUI
```

Use an isolated `HOME` for the machine commands so the check cannot touch real manager state.

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
