## Context

The current platform workflows run broad macOS, Linux, and Windows matrices on
pull requests. Quality checks run on pull requests and pushes to `main`. See
proposal.md for motivation.

## Goals / Non-Goals

**Goals:**

- Run the full routine validation gate on the maintainer's Apple Silicon Mac.
- Keep the GitHub quality check automatic for pull requests only.
- Retain native and package verification as manual `macos-15` workflows.

**Non-Goals:**

- Validate Windows, Linux, Intel macOS, or macOS 26 in routine CI.
- Add Docker, a self-hosted runner, or automatic version management.
- Push branches or create pull requests.

## Decisions

- Add a Bun local-CI script and call it from `.husky/pre-push`. A single command
  makes the local release gate easy to run and stops pushes on failure.
- Retain `quality.yml` for pull requests, but remove its `main` push trigger.
  It gives an independent remote check without duplicate post-merge runs.
- Replace platform matrix triggers with `workflow_dispatch` and one `macos-15`
  runner. Manual dispatch avoids routine minute use while preserving a hosted
  Apple Silicon verification path.
- Document the policy in a tracked CI guide. Create the ADR locally, then ignore
  `docs/adr/` as requested so it remains unavailable to repository users.

## Risks / Trade-offs

- [Local checks depend on maintainer discipline] → Pre-push hook runs them by default.
- [No Windows or Linux coverage] → Dispatch or restore platform coverage when native dependencies change.
- [Mac runner minutes remain for manual checks] → Use them only for native or package-risk changes.

## Migration Plan

1. Add scripts, hook, workflow changes, documentation, ADR, and ignore rule.
2. Run the local macOS CI command and manually dispatch both macOS workflows.
3. Restore automatic triggers if the local gate proves unreliable.
