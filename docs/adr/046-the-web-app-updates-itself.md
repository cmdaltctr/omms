# ADR-046: The web app updates itself

- **Date:** 2026-11-08
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Change:** [`web-auto-update-input-widths`](../../openspec/changes/web-auto-update-input-widths/proposal.md)

## Context

ADR-045 gave Pi and OpenCode a self-update: each host runs its own update command and asks the user to restart. The web app stayed manual. The sidebar **Update** button and `om-memory-system web update` install a release, but only when someone acts. A release approved while nobody watches leaves the web app on the old version.

The standalone web app already owned the whole pipeline: a 10-minute npm check, the guarded install (`npm install -g` with a version check), and a restart through the OMMS launcher that hands the port to the new copy. Only the trigger was manual. The hosts need a detached process and a marker file (ADR-045) because a restart would end open sessions. The web app needs neither: its install runs inside the serving process, and its restart already hands the port over.

## Decision

1. **The web app starts the install by itself.** When the existing npm check finds a newer release that is not a prerelease, the standalone web app starts the same install the **Update web app** action starts. One code path serves the button, `om-memory-system web update`, and the automatic trigger; the trigger only picks the moment. No new check cadence, route, command, or config key.
2. **The automatic install obeys the same gates as the button.** It does not run when `OMMS_DISABLE_UPDATE_CHECK=1` turns the check off, when no npm sits beside the web app's Node.js, when no restart path exists, or while an install already runs. A web app that serves inside a Pi or OpenCode session never updates itself.
3. **A failed automatic attempt waits 30 minutes, in memory.** The backoff covers automatic attempts only: the **Update** button and `om-memory-system web update` work at any time. A restart clears the backoff. That is acceptable: a restart means an install usually succeeded, and the worst case, a persistent npm failure, is bounded by the 10-minute check plus the 30-minute wait, about two automatic installs per hour.
4. **An open page reloads onto the new instance.** The restart hands the port to the new copy, and the page's status call answers with a new `instance`. The page then reloads itself, also when no update dialog is open. The reload skips the first answer and failed calls, so a brief outage during the handover does not reload the page.

## Alternatives Considered

| Option                                          | Rejected Because                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Notice only (the button, the earlier behaviour) | A release approved while nobody watches leaves the web app on the old version                    |
| A second timer for the automatic install        | It duplicates the check cadence and races the existing check                                     |
| A marker file for the backoff                   | The install runs inside the serving process, so memory is the natural home and no file is needed |
| A new config key for the off switch             | `OMMS_DISABLE_UPDATE_CHECK` already stops the check, and with it the automatic install           |

## Consequences

Positive:

- A release approved while nobody watches reaches the web app without a typed command or a pressed button.
- An open page lands on the new version by itself.
- The manual paths keep their exact earlier behaviour.

Negative:

- An automatic restart can land while someone works in the page. The page reloads onto the same route; every mutation is an API call that has already completed or fails visibly. The button flow restarts the same way.

Neutral:

- The backoff lives in memory, so a restart forgets it.
- Web apps inside a host session keep the host-managed update path.
- `OMMS_DISABLE_UPDATE_CHECK` stays the only switch, on par with the hosts in ADR-045.

## References

- [ADR-045](./045-hosts-update-omms-with-their-own-command.md)
- [Updating and upgrading](../upgrading.md#updating-omms)
- [Web UI: Update button](../web-ui.md#update-button)
- `src/services/web-update.ts`, `web/src/lib/web-status.ts`
