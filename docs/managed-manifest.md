# Managed Manifest Behavior

Corvus Skill Manager records every manager-owned link in:

```text
~/.agents/corvus-skill-manager/manifest.json
```

The manifest is the ownership boundary for apply and disable/remove behavior.

## Entry Shape

Each entry records:

- `agentId`
- `skillId`
- `targetPath`
- `sourcePath`
- `linkType`
- `createdAt`
- `updatedAt`

The manifest key is the target path. Doctor reports a manifest mismatch if the key and recorded `targetPath` differ.

## Create Behavior

Apply may create:

- a symlink on Unix-like systems
- a directory junction on Windows when needed

Create operations are allowed only when:

- the source path exists
- the source path is inside the configured active skillpack snapshot
- the target path is absent, or the target is a confirmed broken manager-owned link

For the default revision layout, manifest source paths point through `~/.agents/skillpacks/<skillpack-id>/current`. Activating an approved revision switches that manager-owned link, so agent links do not need to be recreated just because the skill collection moved to a new commit.

Apply refuses to overwrite:

- real files
- real directories
- unmanaged symlinks
- manifest entries whose ownership does not match the requested agent/skill
- existing links whose target does not match the expected source

## Remove Behavior

Remove operations may remove only manifest-owned links. If a target is not recorded in the manifest, the manager refuses to remove it.

If a manifest-owned link is already missing, apply may remove the stale manifest entry. Doctor reports this so the user can decide whether to re-apply or clean up.

## Broken Links

Broken manager-owned links can be replaced only through an apply preview and explicit confirmation. Doctor never repairs broken links.

## Dry Run

Planning is always dry-run. No link or directory is created until the TUI reaches the explicit apply confirmation screen and the user confirms.
