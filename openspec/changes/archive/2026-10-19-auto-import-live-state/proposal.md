## Why

Automatic import runs all the time. The Memory page does not show that. After a run ends, the host card says "Imported 19 Oct" and the host header offers a Play button labelled **Run now**. A Play button tells the user the import is off, so a healthy host looks broken. Play should mean "something is wrong or paused".

A second fault sits on the OpenCode view. After a manual import finishes and the page reloads, the old "Import · done" panel and its long counts line stay on screen for ever, because the page restores the finished job from the server on load.

## What Changes

- A host that is set up, not paused and not failed shows the state **Running** with a **Pause** button. This includes the time after a run ends with nothing pending.
- **Resume** (Play) shows only while the host is paused. **Retry** shows after a failure. A stopped run with items still pending keeps a Play button.
- The state **Stopped** shows only when a run was cut short. A finished run is no longer shown as stopped or done in the header.
- The host card line reads **Running** while the host is on. The date of the last import stays as a second detail.
- Pause with no live run saves the paused flag, so no automatic run starts for that host until the user resumes.
- **Run now** is removed as a label. Starting a stopped run with pending items uses **Resume**.
- On page load, the Import section restores only an active job (queued, preparing, running or cancelling). A finished, failed or cancelled job is not shown after a reload.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-memory-hosts`: the host card status line and the status header state and main action.
- `multi-host-import`: what the page shows when the user returns to or reloads Memory.

## Impact

- `web/src/lib/components/memory/host-status.ts`, `HostStatusHeader.tsx`, `HostCard.tsx`: new state rules and labels.
- `web/src/lib/components/memory/ImportSection.tsx` and `import-job-view.ts`: restore rule for the current job.
- `web/src/lib/i18n/settings.ts`: new strings, and removal of unused ones.
- Tests for `host-status` and the restore rule.
- No server or storage change. `pause` and `resume` already save the paused flag.
- Pi, OpenCode and Claude Code share this code, so host parity holds.
- Docs: the matching guide in `docs/` that names **Run now**.
