## Context

Automatic import is on by default and does not stop. The page models it as a single run: a live run gets **Pause**, anything else gets **Run now**. `hostStatus()` in `web/src/lib/components/memory/host-status.ts` makes this choice. The card line comes from `cardLine()` in the same file.

`BackfillControls.pause()` already saves the paused flag and aborts a live run. `resume()` clears the flag and starts a run. Neither needs a change. `auto-backfill.ts` already skips a paused host at start-up.

`ImportSection.tsx` loads `/api/settings/imports/current` on mount and stores whatever job it returns. The server keeps the last job after it finishes, so a reload shows it again.

## Goals / Non-Goals

**Goals:**

- Healthy host reads **Running** with **Pause**. A Play button means paused, stopped with work pending, or failed.
- A reload does not bring back a finished import panel.

**Non-Goals:**

- No change to when the server starts a backfill.
- No change to the server, the ledger or the API.
- No new host registry (see the known refactor in `CLAUDE.md`).

## Decisions

1. **"Running" means automatic import is on, not that a run is in progress.** The state follows the setting and the paused flag. A live run still shows progress in the details and the sentence. The alternative, showing "Idle" with Pause, was rejected: the user reads any non-running word as a fault.
2. **Pause on an idle host only saves the flag.** The existing `pause()` does this. No server code changes.
3. **Remove the `run` action and the `done` and `idle` states from `host-status.ts`.** A run that ended with `state: "done"` maps to `running`. A run with `state: "stopped"` and pending work keeps `stopped` with **Resume**. A stopped run with nothing pending maps to `running`. `Resume` after a stop calls the same control as today's resume path, which clears the flag and starts a run. This needs `runNow` to be reachable while the flag is already clear. The page calls `backfill.control(host, "run")` for that case, so the control stays and only the label changes.
4. **The card line becomes `Running · last import <date>`** when a date is known, and `Running` when none is. Paused, failed, stopped and not-set-up lines stay as they are.
5. **Restore only active jobs.** A pure function `restorableJob(job)` in `import-job-view.ts` returns the job for `queued`, `preparing`, `running` and `cancelling`, and `null` otherwise. `ImportSection` applies it only to the job loaded on mount. A job that ends while the page is open stays in state, so the finish dialog and results keep working.

## Risks / Trade-offs

- A host with `autoBackfill: false` in the global config does not run automatic imports, yet the page would say Running. Mitigation: treat `autoBackfill: false` like paused in `use-host-statuses.ts` if the value is already available to the page. If it is not, record it as an open question and leave it out of this change.
- A stopped run with nothing pending now reads Running. That matches "nothing to do, still listening".
- Removing **Run now** loses a manual trigger for a not-yet-started host. The host is Running and starts by itself at the next host start. Mitigation: record this in the docs.

## Migration Plan

Web UI only. No data or config migration. Rollback is a revert.

## Open Questions

- Does the page already receive `autoBackfill`? Check `use-host-statuses.ts` while implementing.
