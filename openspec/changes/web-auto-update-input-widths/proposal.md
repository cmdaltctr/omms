# Proposal

## Why

The host self-update change (PR #249, ADR-045) left the web app manual: a release approved while nobody is watching leaves the web app on the old version until someone runs `om-memory-system web update` or presses the Update button. In the same Settings area, field widths are inconsistent: the Provider dropdown is compact while the API URL and Model inputs and the key-source controls beside it stretch across the full card, and the host model cards mix both widths.

## What Changes

- The standalone web app installs a newer npm release by itself. When the existing 10-minute npm check finds a newer plain release, the web app starts the same install the Update button starts (`npm install -g`, version check, restart through the launcher). No new check cadence, no new route, no new command.
- The automatic install obeys the same gates as the button: `OMMS_DISABLE_UPDATE_CHECK=1`, no npm beside the runtime, or no restart path means no automatic install. Web apps started inside a Pi or OpenCode session never update themselves (unchanged).
- After a failed automatic install, the web app waits 30 minutes before trying again automatically. The Update button keeps working for a manual retry at any time.
- The page shows the same installing/restarting progress the button flow shows, and an open page reloads itself when the restarted web app answers with a new instance, also when no dialog is open.
- Settings field widths follow the Provider dropdown's compact width (about 18rem, capped at the row): **API URL** and **Model** in the External API card, the key-source group (its bordered box, Environment variable / Key file / **Save key to a private file** and their inputs), and the **Model choice** dropdown in each host's model card. Long-value controls keep the full width: the manual model picker with model IDs and the manual provider/model input.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `web-update`: adds a requirement that the web app installs a newer release by itself, with the button's gates, a 30-minute failure backoff, and a page reload after an unattended restart.
- `web-visual-design`: the compact-width requirement extends from short-option dropdowns to the listed Settings inputs and control groups, and the Model choice dropdowns become compact while long-value model pickers keep the full width.

## Impact

- `src/services/web-update.ts`: auto-install trigger after a successful check, failure backoff, one log record per automatic start.
- `web/src/lib/web-status.ts`: reload the page when the status answers with a new instance.
- `web/src/lib/components/settings/ExternalApiSection.tsx`, `web/src/lib/components/settings/ModelsSection.tsx`: compact-width wrappers.
- Tests: `tests/web-update-check.test.ts` (or a new `tests/web-auto-update.test.ts`), web UI specs for the reload and the widths.
- Docs: `UPDATES.md`, `docs/upgrading.md`, `docs/web-ui.md`, a new ADR (web app self-update) with its index entry.
