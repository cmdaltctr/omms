# ADR-021: Claude Code installs only npm-approved releases through stable

- **Date:** 2026-10-03
- **Status:** Proposed
- **Deciders:** OMMS maintainer

## Context

Claude Code installs the OMMS plugin from git. The marketplace's relative
source previously loaded the plugin from `main`. release-please updates the
plugin version before the release smoke and npm approval finish.

The failed 4.4.0 publish left Claude Code users with a plugin whose launcher
requested an unavailable npm version. The hooks then returned no memories and
captured nothing. npm users remained on the previous published release.

The marketplace must follow approved releases without a new commit for each
approval. Approval happens on npm outside GitHub, so it triggers no workflow
event.

## Decision

Use a GitHub plugin source with `repo: cmdaltctr/omms` and `ref: stable`.
An hourly workflow and manual dispatch move `stable` to the release commit
named by npm `latest`. Dispatch immediately after approval in the release
runbook and release skill.

Keep the logic in `scripts/sync-claude-plugin-channel.sh`, tested against
scratch git repositories. Accept only plain stable version numbers and resolve
`refs/tags/v<version>^{commit}`. Push only `refs/heads/stable`, with an explicit
lease on its previous value. This permits rollback and refuses concurrent
updates. A missing branch uses an empty lease to protect first creation.

A missing tag or invalid version fails. A registry failure leaves the branch
unchanged and exits successfully with a warning. The workflow installs no
packages and needs only `contents: write`.

Create `stable` at `v4.4.1` before the marketplace change merges. Use
`claude --plugin-dir <checkout>` for local development.

## Consequences

### Positive

- A failed or unapproved npm release cannot change the marketplace plugin version.
- Approval needs no further release or commit to update the plugin channel.
- Tests verify branch updates, rollback, outages and concurrent-push protection without GitHub.

### Negative

- A missed dispatch adds up to an hour before the channel moves. GitHub scheduling delays can extend this.
- A missing `stable` branch breaks installation, so rollout order matters.
- Writers can move `stable` by hand. The maintainer should restrict it with a repository ruleset.

### Neutral

- Users receive the plugin at their next marketplace update check.
- Pi, OpenCode and the npm package keep their existing release behaviour.
- A local marketplace path still fetches the GitHub plugin source.

## Alternatives Considered

| Option                               | Rejected because                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Keep the relative source             | `main` can name a version that npm never published.                                                   |
| Pin a release tag in the marketplace | Each approval needs another reviewed commit to `main`.                                                |
| Use an npm plugin source             | The package ships no lockfile, so Claude Code installs no dependencies for the runnable `dist/` copy. |
| Move a tag                           | Git clients cache tags and expect them to stay fixed.                                                 |
| Add a second marketplace             | Every user must replace their marketplace configuration.                                              |

## References

- [Release pipeline](004-release-pipeline.md)
- [Channel script](../../scripts/sync-claude-plugin-channel.sh)
- [Channel workflow](../../.github/workflows/claude-plugin-channel.yml)
- [Channel tests](../../tests/claude-plugin-channel.test.ts)
- [Claude Code adapter](../claude-code-adapter.md)
- [Release runbook](../ci.md#release-runbook)
- [OpenSpec design](../../openspec/changes/archive/2026-10-03-claude-plugin-stable-channel/design.md)
