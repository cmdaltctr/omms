# Design

## Context

See proposal.md for the motivation. `capture_attempts` in `user-prompts.db` already holds one row per capture attempt with `host`, `source_type` (`live-capture` or `history-import`), `outcome` (`saved`, `skipped`, `failed`) and `created_at`. Rows older than `captureAttemptRetentionDays` (default 30) are pruned. Dates in the web app are formatted in about 10 places, some through `formatDate` in `web/src/lib/format.ts` and some with inline `toLocaleString` calls. The page language and theme are stored in the browser through `web/src/lib/preferences.ts`.

## Goals / Non-Goals

**Goals:**

- Show the last live save per host without new tracking.
- One formatting module that every date and time call uses.

**Non-Goals:**

- Server-side or config storage of the date and time choice.
- Time zone selection. The browser's time zone stays.
- Live save times in the host view header. Only the overview card changes.

## Decisions

- **Last live save from `capture_attempts`.** `lastLiveSaves()` in `capture-attempt-store.ts` runs `SELECT host, MAX(created_at) FROM capture_attempts WHERE source_type = 'live-capture' AND outcome = 'saved' GROUP BY host`. The index on `(host, provider, model, created_at)` keeps it cheap for the row counts the store keeps. Alternative: a new per-host timestamp written by capture. Rejected: the records exist, and a second writer adds a path to keep in step.
- **New route** `GET /api/settings/last-saved` returns `{ hosts: { pi, opencode, "claude-code" } }` with milliseconds or `null`. It sits behind the same loopback and token rules as the other API routes, and fits in the five lines `web-server.ts` may still grow.
- **Card polling.** `use-host-statuses.ts` loads the route on mount, on a settings snapshot and every 60 seconds.
- **Format module.** `format.ts` gains `formatDateTime`, `formatDay` (day and month) and `formatTime`, built on `Intl.DateTimeFormat`. They read the stored choice. A date format choice maps to fixed options: `30 Oct 2026` uses `en-GB` order, `Oct 30, 2026` uses `en-US` order, `2026-10-30` is assembled from parts. Time maps to `hourCycle: "h23"` or `"h12"`. Automatic keeps today's options, so nothing changes for users who do not choose.
- **Re-render on change.** The choice lives in a small store with `subscribe`, like the language store. `useI18n` also subscribes to it, so every component that already reads `t` re-renders when the choice changes.
- **Relative day for the card.** `today` and `yesterday` come from comparing local calendar days, then `formatTime`. Older saves use `formatDay` and `formatTime`.
- **Compact dropdowns.** Use the existing pattern from Keyword mode: a `w-72 max-w-full` wrapper around a `w-full` Select. No change to the Select primitive.

- **Theme catalogue.** Copy `catalogue.ts`, `types.ts` and `themeData.ts` from OMRS v3. The data is generated from OpenChamber's theme files (MIT) and keeps its credit comment. `themeData.ts` goes in `.prettierignore`, as OMRS does, so each theme stays on one line.
- **Token mapping.** OMMS uses shadcn-style tokens. A theme sets `--background` (canvas), `--card` and `--popover` (elevated), `--secondary`, `--muted` and `--sidebar` (muted), the foreground tokens (text), `--muted-foreground` (secondary text), `--border`, `--border-hover`, `--primary`, `--primary-hover`, `--primary-active`, `--ring` and `--sidebar-primary` (accent), `--selection`, `--accent` and `--sidebar-accent` (selection), `--interactive-hover`, `--interactive-active`, `--destructive` and the three status colours. Labels such as `--primary-label` mix the colour with the text colour, as OMRS does. `--ring` uses the accent, not the theme's focus colour, because some focus colours are mostly transparent and would fail the visible-focus rule. `--brand-label` stays the OMMS green.
- **Where the rules apply.** OMMS sets a `dark` class on `<html>`. The light rule uses `:root:not(.dark)` and the dark rule `:root.dark`. Both are more specific than `:root` and `.dark` in `app.css`, so they win whatever the stylesheet order.
- **Mode.** The existing `omms-theme` key keeps `light` or `dark`. System removes the key, which is today's meaning of no key, so the sidebar button and the new card share one store.

## Risks / Trade-offs

- [The last save is missing once records pass the retention period] → The card then shows no `last saved` part, which is true for the kept window. Retention defaults to 30 days.
- [Arabic and Chinese with a fixed date format] → The fixed formats use Western digits and English month names. Automatic keeps each language's own format, so those users are not affected unless they choose.
