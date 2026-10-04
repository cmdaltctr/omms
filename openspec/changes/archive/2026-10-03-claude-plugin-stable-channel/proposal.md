# Proposal

## Why

Claude Code installs the `omms` plugin from git, not from npm. `.claude-plugin/marketplace.json` lists the plugin with `"source": "./"`, so Claude Code reads the plugin from `main`. release-please bumps `.claude-plugin/plugin.json` when the release pull request merges, which is before the npm publish. When the publish fails, Claude Code still installs that version.

That happened on 2026-10-03. The 4.4.0 publish failed on the Windows smoke. Claude Code with marketplace auto-update installed plugin 4.4.0 anyway. The plugin launcher runs `--at-least-own-version`, found no local copy at 4.4.0, and ran `npx om-memory-system@4.4.0`. npm answered `notarget`, so every hook in a new session returned nothing: no memories and no capture. A global install of 4.4.1 fixed this one machine. The next failed release breaks every Claude Code user again.

## What Changes

- `.claude-plugin/marketplace.json` lists the plugin with a GitHub source on a `stable` branch: `{ "source": "github", "repo": "cmdaltctr/omms", "ref": "stable" }`. Claude Code then installs the plugin from `stable`, not from `main`.
- A new workflow, `claude-plugin-channel.yml`, moves `stable` to the commit of the git tag `v<version>`, where `<version>` is npm's `latest` dist-tag. It runs every hour and on manual dispatch. The maintainer dispatches it after approving a release. A version that npm never published never reaches `stable`.
- A new script, `scripts/sync-claude-plugin-channel.sh`, holds the logic, so a test can run it against a temporary git repository.
- The release runbook and the `s-omms-npm-release` skill add one step after approval: dispatch the workflow, so Claude Code users get the release at the next auto-update and do not wait for the hourly run.
- Docs say that Claude Code gets a release only after it is approved on npm, and that local plugin testing uses `claude --plugin-dir`. Adding this checkout as a local marketplace now installs from GitHub `stable`, not from local files.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `release-publishing`: a new requirement says Claude Code users receive only plugin versions published to npm, and get each one after approval without a further release.

## Impact

- Changed: `.claude-plugin/marketplace.json`, `tests/claude-plugin-assets.test.ts`, `docs/claude-code-adapter.md`, `docs/ci.md`, `docs/upgrading.md`, `UPDATES.md`.
- New: `.github/workflows/claude-plugin-channel.yml`, `scripts/sync-claude-plugin-channel.sh`, `tests/claude-plugin-channel.test.ts`, an ADR.
- New git branch `stable`, written only by the workflow. It must exist before the marketplace change reaches `main`, or Claude Code cannot install the plugin.
- The workflow needs `contents: write` to push `stable`. It pushes no other ref.
- Pi, OpenCode, and the npm package do not change. They already install from npm.
- No new dependencies.
- Post-merge workflow and installed-plugin checks remain in the separate rollout checklist in `docs/ci.md`. The maintainer approved this split so the verified implementation can archive before its pull request.
