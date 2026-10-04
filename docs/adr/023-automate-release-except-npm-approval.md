# ADR-023: Automate the release except the npm approval

- **Date:** 2026-10-04
- **Status:** Proposed
- **Deciders:** OMMS maintainer

## Context

A release had five manual steps: merge the release pull request, watch the
Release workflow, approve the staged version on npm with 2FA, dispatch the
Claude plugin channel, and mark a failed GitHub Release. Nothing told the
maintainer when a version was staged, so approvals waited.

The npm approval is the only step that proves a person is present. It protects
users from a publish by a compromised workflow or account.

## Decision

1. `release-auto-merge.yml` merges the release pull request after its Quality
   run passes. The `release-please--` branch name is only a first filter,
   because anyone with write access can create such a branch.
   `scripts/release-pr-guard.mjs` merges only a pull request that the release
   App wrote:
   - the author is `omms-release[bot]`, from this repository, into `main`
   - every commit has the App as author and a GitHub (`web-flow`) signature;
     a person cannot push such a commit
   - it changes only `CHANGELOG.md` (additions only), `package.json`,
     `.claude-plugin/plugin.json` and `.release-please-manifest.json`
   - the JSON files change only the version, and all versions agree

   The guard runs from `main` and reads the pull request through the API; it
   never checks out its code. The merge uses the App token, so it starts the
   Release workflow, and `--match-head-commit` merges only the checked commit.
   Any other pull request waits for the maintainer.

2. After `npm stage publish`, the Release workflow comments on the merged
   release pull request and mentions the repository owner, with the stage ID
   and the approve command. GitHub emails the mention when the owner turns on
   email notifications. No issue is opened, so the issue list stays clear.
3. If smoke or publish fails before npm stages the version, the
   `report-failure` job marks the GitHub Release "not published to npm" and
   mentions the owner on the release pull request. The failed run also sends
   GitHub's failed-workflow notification.
4. `bun run release:approve` reads the stage ID from the newest GitHub Release
   note, runs `npm stage approve` (2FA prompt), waits for npm `latest`,
   dispatches the Claude plugin channel, and checks that `stable` is at the
   release tag. An approval made on npmjs.com is covered by the hourly channel
   run.

## Consequences

### Positive

- The maintainer acts once per release: approve with 2FA.
- A staged or failed release always produces a notification.

### Negative

- Every `feat:`, `fix:` or `deps:` merge ships soon after. Changes can no
  longer be held back in an open release pull request.
- The release App token can now merge pull requests from a workflow. The
  guard limits it to pull requests the App wrote itself.

### Neutral

- Email delivery depends on the maintainer's GitHub notification settings for
  mentions and failed workflows.

## Alternatives Considered

| Option                              | Rejected Because                                   |
| ----------------------------------- | -------------------------------------------------- |
| Direct npm publish without staging  | Removes the 2FA proof of presence                  |
| GitHub auto-merge on the release PR | Needs a repository setting; ignores `test-windows` |
| Faster channel cron only            | Still no notice that a version waits for approval  |

## References

- `.github/workflows/release-auto-merge.yml`
- `scripts/release-pr-guard.mjs`
- `.github/workflows/release.yml`
- `.github/workflows/claude-plugin-channel.yml`
- `scripts/release-approve.sh`
- [ADR-021](./021-claude-plugin-stable-channel.md)
- [docs/ci.md](../ci.md)
