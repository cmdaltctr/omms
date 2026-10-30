# Design

## Context

See proposal.md for the motivation. `useAiCleanupJob(open)` reads the job when `open` turns true and polls every 2 seconds while the job runs. It stops when `open` turns false. The dialog is mounted once in `App.tsx`, and its open flag lives in `useUserProfile`. Category cleanup already has a page banner for a closed dialog, so it is out of scope.

## Goals / Non-Goals

**Goals:**

- Show the state of a running AI Cleanup outside the dialog, on any page of the web app.
- Reuse the existing job endpoint and polling rules.

**Non-Goals:**

- Keep the pill after a page reload. Opening AI Cleanup again still shows the progress, as today.
- A pill for category cleanup. Its banner already covers this case.
- Stop or Apply from the pill. Those stay in the dialog.

## Decisions

- **Minimised flag next to the open flag.** `useUserProfile` holds `aiCleanupMinimised`. Minimise sets it and closes the dialog. Opening the dialog clears it. This keeps one source of truth for which of the two is on screen.
- **The pill has its own `useAiCleanupJob` instance.** It passes `true` while mounted, so it reads the job once and polls while the job runs, with the same rules as the dialog. The dialog instance is closed at the same time, so only one poll runs. Alternative: lift the job hook into `App.tsx` and share it. Rejected: it changes the dialog's data flow for a small gain.
- **The hook reports when it has read the job.** A new `checked` flag turns true after the first successful read. The pill uses it to tell "not read yet" from "no job", so it does not vanish on mount.
- **Pure view function.** `pillView(job, checked)` in `ai-cleanup-job-state.ts` maps the job to `running`, `ready`, `failed`, `checking` or `null`. Bun tests cover it, as they cover `dialogView`.
- **Placement.** The pill is a fixed button at the top right (`top-3 end-3`), below the dialog layer (`z-40`). Toasts sit at the bottom right, so they do not collide. The Minimise button sits left of the close button with the same ghost icon style.

## Risks / Trade-offs

- [The pill covers page content at the top right] → It is small and only shows while minimised. Selecting it removes it.
- [A failed read keeps the last state] → This matches the dialog: a running job stays on screen and the next poll tries again.
