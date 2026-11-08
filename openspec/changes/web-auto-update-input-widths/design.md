# Design

## Context

The standalone web app already owns a complete update pipeline: a 10-minute npm check with a 60-second status-driven recheck (`src/services/web-update.ts`), a loopback+token `POST /api/web/update` route, a guarded install (`npm install -g`, version verify, 5-minute timeout), and a restart through the OMMS launcher that hands the port to the new copy. The Update button and `om-memory-system web update` both end in the same install. Only the trigger is manual. See proposal.md for motivation.

The hosts' self-update (ADR-045) runs a detached host command and polls a marker file. The web app needs none of that: its install runs inside the serving process and its state is already in memory.

Settings width rules live in the shared `Select` module: `compactField` (`w-72 max-w-full`, about 18rem capped) wraps short-option dropdowns; long-value inputs keep full width. The listed controls simply join the compact group.

## Goals / Non-Goals

**Goals:**

- One code path for automatic and manual installs; the automatic path only picks the moment.
- No new ports, routes, commands, config keys, or files on disk.
- The four listed Settings controls share the Provider dropdown's compact width.

**Non-Goals:**

- Global CLI auto-update.
- A separate off switch beyond `OMMS_DISABLE_UPDATE_CHECK`.
- Changing the check cadence, the button, the dialog, or `web update`.
- A marker file or cross-restart backoff state.

## Decisions

1. **Trigger inside the update class, after a successful check.** The check paths (start, interval, status-driven recheck) all funnel through one private `read()` that sets the available release. The automatic trigger sits directly after it, so every discovery path behaves the same. Alternative: a separate timer like the OpenCode service's 6-hour check — rejected, it would duplicate the cadence and race the existing check.

2. **The automatic path calls the same `requestInstall()` the route calls.** The gates (release available, npm beside the runtime, restart possible, no install already running) and the single-flight join come without new code. A failure of an automatic attempt sets an in-memory `autoRetryAt = now + 30 min`; while `now < autoRetryAt` the automatic trigger stays quiet. Manual requests never consult the backoff. Alternative: copy the install logic — rejected, the paths would drift.

3. **In-memory backoff, no marker file.** The hosts need `~/.omms/<host>-plugin-update.json` because their update runs detached; the web app's install is in-process, so memory is the natural home. A restart clears the backoff, which is acceptable: a restart means an install usually succeeded, and the worst case (persistent npm failure) is bounded by the 10-minute check plus the 30-minute backoff, about two installs per hour at most. Alternative: a retire-marker-style file — rejected as machinery for a rare case.

4. **No new config key.** `OMMS_DISABLE_UPDATE_CHECK=1` already stops the check, and with it the automatic install. The hosts have no per-host switch either; one switch keeps parity with ADR-045.

5. **Page reload on instance change in the shared status poll.** `web/src/lib/web-status.ts` applies every `/api/web/status` reply; it learns the served `instance`. When a reply carries a different non-null instance than the last applied one, the page reloads once. This covers the unattended restart with no dialog open; the dialog's existing wait-and-reload keeps working, and a power-button restart now also lands the page on the new instance. The store skips the reload before the first answer and while the status call fails, so a brief outage during handover does not reload the page.

6. **Widths through the existing `compactField` wrapper.** The API URL and Model inputs and each host's Model choice dropdown get the same `<div className={compactField}>` wrapper the Provider dropdown uses; the inputs keep their own `w-full` and fill the wrapper. The key-source group's bordered fieldset carries the width itself, so the box hugs its compact contents instead of stretching across the card around them. The manual model picker and the typed provider/model input keep full width, as the spec keeps long values full width. No CSS file or shared component changes, no new strings.

7. **A short ADR records the policy.** ADR-046 (the web app updates itself) extends ADR-045 to the fourth surface and records the gates, the backoff, and the single-switch decision.

## Risks / Trade-offs

- [An automatic restart lands while a user works in the page] → The page reloads onto the same route; every mutation is an API call that has already completed or fails visibly. This matches the existing button flow, which restarts the same way.
- [Persistent npm failure causes repeated installs] → The 30-minute backoff plus the check cadence bound automatic attempts; a failed install never stops the old version from serving.
- [The backoff is lost on restart] → Accepted (decision 3); bounded by the check cadence.
- [Compact inputs hide long URLs and model names] → The value scrolls inside the input and is fully editable; this follows the existing compact-width direction already applied to Provider and other short dropdowns.

## Migration Plan

One pull request; no stored state and no schema changes. Rollback is a revert. The first release that carries this change is itself installed manually once, then maintained automatically.
