## Why

The OMMS log has no levels. Every one of the 324 `log()` calls writes `[time] message: {data}`, so a failed embedding call looks the same as a routine capture record. The Settings log box shows the last 200 lines as plain text and refreshes only on demand. A user who opens it to find out why memory writes fail has to read every line. OMRG's log page shows the same kind of data with a coloured level badge, a level filter and live updates, and the user wants OMMS to work the same way.

## What Changes

- The shared logger records a level on every line: `info`, `warn` or `error`. `log(message, data)` stays `info`. A third argument sets `warn` or `error`.
- Each new line has the form `[time] LEVEL message: {data}`.
- Call sites that report a failure are tagged `error`. Call sites that report a fallback, a skip, a retry or a degraded state are tagged `warn`.
- The log API returns parsed records (time, level, message, data text) instead of raw strings. Lines written before this change get a level guessed from their message text and are marked as guessed.
- The Settings log section shows each record with its time and a coloured level badge. It has level chips (All, Warning, Error), the existing capture-attempts filter, Pause and Resume, a copy action for the visible lines and the existing copy-path action. It checks for new lines every 5 seconds while it is on screen and not paused.

## Capabilities

### New Capabilities

- `log-levels`: the shared logger's levels, line format and the rule for guessing the level of an older line.

### Modified Capabilities

- `web-settings`: the requirement "The page shows the OMMS log" changes to level badges, level filter, automatic updates, Pause and Resume, and copying the visible lines.

## Impact

- `src/services/logger.ts`: optional level argument and the new line format.
- About 220 call sites across `src/` get a level argument. No call site changes its message text.
- `src/services/settings-log.ts`: parses lines into records and applies the level filter.
- `src/services/web-server.ts`: `/api/settings/log` takes a `level` query value. The file is over the 500-line ceiling, so the handler stays a few lines and the work stays in `settings-log.ts`.
- `web/src/lib/components/settings/LogSection.tsx` and a new `LogPanel.tsx`; new strings in `web/src/lib/i18n/settings.ts`.
- `docs/web-ui-settings.md` (Log section).
- No change to log rotation, retention or file location. No new dependency. Same behaviour for all three hosts, because they share one logger.
