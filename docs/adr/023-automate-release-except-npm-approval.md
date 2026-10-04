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
   run passes. It acts only on `release-please--` branches in this repository
   and merges the tested commit (`--match-head-commit`). It uses the release
   GitHub App token, so the merge starts the Release workflow. Other pull
   requests still need the maintainer to merge them.
2. After `npm stage publish`, the Release workflow opens an issue assigned to
   the repository owner: `Approve om-memory-system@X.Y.Z on npm`. It holds the
   stage ID and the approve command. The assignment sends a GitHub
   notification.
3. If smoke or publish fails before npm stages the version, the
   `report-failure` job marks the GitHub Release "not published to npm" and
   opens an issue.
4. `bun run release:approve` reads the stage ID from the issue, runs
   `npm stage approve` (2FA prompt), waits for npm `latest`, dispatches the
   Claude plugin channel, and checks that `stable` is at the release tag.
5. The Claude plugin channel closes the approval issue when npm `latest`
   matches its version. An approval made on npmjs.com is covered by the hourly
   run.

## Consequences

### Positive

- The maintainer acts once per release: approve with 2FA.
- A staged or failed release always produces a notification.

### Negative

- Every `feat:`, `fix:` or `deps:` merge ships soon after. Changes can no
  longer be held back in an open release pull request.
- The release App token can now merge pull requests from a workflow.

### Neutral

- Notification delivery depends on the maintainer's GitHub notification
  settings for assigned issues.

## Alternatives Considered

| Option                              | Rejected Because                                   |
| ----------------------------------- | -------------------------------------------------- |
| Direct npm publish without staging  | Removes the 2FA proof of presence                  |
| GitHub auto-merge on the release PR | Needs a repository setting; ignores `test-windows` |
| Faster channel cron only            | Still no notice that a version waits for approval  |

## References

- `.github/workflows/release-auto-merge.yml`
- `.github/workflows/release.yml`
- `.github/workflows/claude-plugin-channel.yml`
- `scripts/release-approve.sh`
- [ADR-021](./021-claude-plugin-stable-channel.md)
- [docs/ci.md](../ci.md)
