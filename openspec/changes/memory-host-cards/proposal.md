## Why

The Memory page puts every host's state in seven long sections. A user who asks one question about one host, such as "why is OpenCode paused?", has to read Import chat history, Automatic import and Resolve missing project folders, and still finds no answer. On 18 October 2026 this happened in practice:

- The OpenCode badge said Paused, but the Resume button sat greyed out in another section, and its reason was hidden.
- Run now finished at once with nothing to do, and the page said nothing.
- 21 OpenCode sessions had no folder, and no screen let the user map or ignore them.
- Host ticks reset on every refresh.
- The embedding server returned HTTP 500 for every request, so no memory was saved, and the page gave no sign of it.

## What Changes

- `/memory` becomes an overview of four cards of the same size: Pi, OpenCode, Claude Code and Shared. Each host card shows an avatar, a status line and a write-health warning when memories cannot be saved. An **Import all hosts** action sits under the cards.
- `/memory/pi`, `/memory/opencode` and `/memory/claude-code` show one host only:
  - a status header with one main action whose label follows the state, and a sentence that says what happened or why the action is unavailable;
  - the host's session list, with sessions that need a folder in the same list, each with a folder field, a suggestion, Ignore and **Ignore all**;
  - the host's own settings: backfill model, import model and automatic import.
- `/memory/shared` holds the settings that apply to every host: profile learning, memory limits, keyword matching, reranker, saved directory maps and ignored directories.
- Each host card has a **Change icon** menu: upload an image, choose an icon, or reset. Any image size is centre-cropped and stored at 128 × 128 px, so all avatars are the same size.
- A host whose history source is not on this machine shows a greyed **Not set up** card with setup steps.
- The sidebar lists Pi, OpenCode, Claude Code and Shared. Old Memory and Settings anchors open the view that now holds the section.
- The multi-host import form keeps its host ticks after a refresh.
- **BREAKING (UI only):** the seven-section Memory page goes away. No API, config key or CLI behaviour is removed.

## Capabilities

### New Capabilities

- `web-memory-hosts`: the host overview, host views, Shared view, status and main action, Not set up state, host avatars and the write-health warning.

### Modified Capabilities

- `web-memory`: the sidebar children, old-link routing, and host and scope choices in the multi-host import.
- `import-directory-maps`: unresolved directories now also come from an All projects session listing, and a host can ignore all its listed unresolved directories at once.

## Impact

- Web: `web/src/lib/components/memory/*` (view split, new overview, host view, shared view and avatar components), `web/src/lib/routes.ts`, `router.ts`, `memory-sections.ts`, `AppSidebar.tsx`, the i18n tables (`en`, `zh`, `ar`). `ImportSection.tsx` (454 lines) and `DirectoryMapsSection.tsx` (432 lines) are split to stay under the 500-line ceiling.
- Server: host appearance endpoints and storage under `~/.omms/host-appearance/`, a write-health endpoint that reuses the existing embedding and store checks, and unresolved-directory recording from All projects session listings.
- Docs: `docs/web-ui-memory.md`, `docs/web-ui.md`.
- No new dependency. Same behaviour for every host. The log page belongs to the separate `add-log-levels` change.
