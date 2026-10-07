# TDR-038: Resume the release approval after npm shows the version

- **Date:** 2026-10-07
- **Status:** Proposed
- **Deciders:** OMMS maintainer
- **Tags:** release, npm, Claude plugin, scripts

## Context

Release 4.13.0 reached npm `latest` after the maintainer ran `bun run release:approve`. The Claude plugin channel did not move. `stable` stayed at the 4.12.0 commit, so `claude plugin update omms@omms` found nothing new. The channel moved only after a manual `gh workflow run claude-plugin-channel.yml`.

The same symptom happened on 4.5.0 (see TDR-032).

### Root Cause Analysis

The terminal output of the 4.13.0 run is not available, so the exact exit point is not confirmed. The channel workflow log shows no dispatch run between a scheduled run at 16:34 UTC and the manual dispatch at 19:42 UTC. The script therefore stopped before it dispatched the workflow, or the approval was made another way.

The code shows two defects that make any such stop permanent:

- The script exited with an error when the release was already on npm ("Nothing is waiting for approval"). A second run could not finish the channel step. A test pinned that exit.
- Two exits told the maintainer that the hourly channel run would finish the rest. The schedule is not hourly in practice. From 2026-10-04 to 2026-10-07 the scheduled runs came 3 to 9 hours apart.

Possible causes of the stop, none confirmed: npm took longer than the 150-second wait to show the version, the approval was made with `npm stage approve` directly, or the channel run did not appear in the run list within 150 seconds.

## Decision

- When the newest release is already on npm, skip the approval and go on to move the channel. Never call `npm stage approve` in that case.
- When the release is on npm and `stable` is already at its tag, print that nothing is left to do and exit 0.
- When npm does not show the version after the approval, or the channel run does not start, tell the maintainer to run `bun run release:approve` again. Remove the promise of the hourly run.
- Keep the 150-second wait, the stage ID lookup and the final check that `stable` is at the tag.
- Describe the schedule in `docs/ci.md` as a backstop with the observed gaps.

## Consequences

One command finishes a release whichever way the approval was made or wherever an earlier run stopped. A repeat run after success does nothing and exits 0. A repeat run never approves twice, because it does not call `npm stage approve` once npm shows the version.

The script now exits 0, not 1, when the release is on npm and `stable` is at its tag. A caller that relied on exit 1 for "nothing to approve" sees a change. No such caller is known.

## Alternatives Considered

- Wait longer for npm. This helps one cause only, and the confirmed defect is that a stopped run cannot be resumed.
- Make the channel workflow retry until npm shows the version. This moves the wait into GitHub and still leaves a stopped script that cannot resume.
- Trigger the channel when npm publishes. npm approval happens outside GitHub and sends no event.
- Rely on the schedule. Observed gaps of 3 to 9 hours rule this out.
