# ADR-004: Release pipeline with staged approval and a next channel

**Date:** 2026-09-25
**Status:** Accepted
**Deciders:** Project maintainer

## Context

A public npm release needs a reproducible build, native checks across supported systems and maintainer approval before it reaches users. npm deprecated legacy publish tokens in its 2026-07-08 changelog. GitHub Actions tags created by an action do not trigger another workflow, so tag-push publishing would miss release-please tags.

## Decision

Use release-please with the private `omms-release` GitHub App token. The App's release pull requests trigger required checks. On a release push to `main`, build and publish from the exact tagged `sha` in that same workflow. Wait for the six-platform smoke gate, then stage the npm package with tokenless OpenID Connect (OIDC) trusted publishing. The maintainer approves the staged version with two-factor authentication before users can install it.

Publish development builds directly to npm's `next` tag after Quality succeeds on `main`. Keep `latest` unchanged. Enable each workflow with `RELEASE_PLEASE_ENABLED` and `NPM_NEXT_ENABLED`. Limit publishing environments to `main`. Required review and CODEOWNERS gates are not used for the single-maintainer repository; required checks still run.

## Consequences

### Positive

- npm receives no long-lived publish token.
- Release checks and maintainer approval guard the public package.

### Negative

- Releases need GitHub App credentials, two npm trusted publishers and manual approval.
- Six-platform smoke checks add release time.

### Neutral

- The `next` channel is installable without staging approval.

## Alternatives Considered

| Option                                | Rejected Because                                     |
| ------------------------------------- | ---------------------------------------------------- |
| Stored `NPM_TOKEN`                    | Leaves a long-lived publishing secret in CI.         |
| Personal access token for release PRs | Ties automation to a person's credentials.           |
| Publish after a tag push              | Action-created tags do not trigger another workflow. |
| Install the package from GitHub       | Bypasses the npm installation and staging flow.      |
| Publish directly without staging      | Removes the maintainer's final approval gate.        |

## References

- [PR #10](https://github.com/cmdaltctr/omms/pull/10)
- `docs/ci.md`
- `.github/workflows/release.yml`
- `.github/workflows/publish-next.yml`
- `.github/workflows/platform-smoke.yml`
