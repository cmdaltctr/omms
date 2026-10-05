# Design

## Context

See `proposal.md` for motivation and the spec deltas for the behaviour contract. This design is needed because the confirmation flow changes draft ownership and save timing across settings components.

Observed owners:

| Owner                                                      | Current behaviour                                                                                                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/lib/components/settings/DirectoryMapsSection.tsx` | Owns global source-keyed drafts, pending removals, settings revision, and saving. `smartResolve` only updates drafts. Its current reload clears all drafts. |
| `web/src/lib/directory-maps.ts`                            | `applySuggestions` selects suggested rows. `selectWithTargets` preserves edited targets. Neither persists data.                                             |
| `web/src/lib/external-api-settings.ts`                     | `mapsToSave` merges saved maps and accepted draft decisions by source.                                                                                      |
| `src/importer/map-suggestions.ts`                          | Supplies existing-directory suggestions and filters saved sources out of unresolved rows.                                                                   |
| `web/src/lib/components/explorer/MemoryCard.tsx`           | Renders memory types and LINKED with neutral outline badges. Memory and paired cards render keyword tags separately.                                        |
| `web/src/lib/components/explorer/KeywordBadge.tsx`         | Derives a stable hue from a trimmed, case-insensitive keyword and renders a coloured tag button.                                                            |
| `web/src/lib/components/ui/tooltip.tsx`                    | Clones its child with `aria-describedby` and shows a bubble on hover or focus within.                                                                       |

The existing `PATCH /api/settings` accepts a revision and validated edits. Directory maps remain global. The UI already has dialog, tooltip, badge, and status-success colour primitives.

## Goals / Non-Goals

**Goals:**

- Separate reviewed proposals from mutable page drafts until confirmation succeeds.
- Reuse existing save validation, global source keys, and presentation primitives.
- Apply the same modal flow to Pi, OpenCode, and Claude Code without adapter changes.
- Keep type and tag labels distinct, deterministic, and accessible in both themes.

**Non-Goals:**

- No automatic import request, model call, host-history mutation, or directory recreation.
- No label registry, capture prompt change, data migration, new dependency, or general redesign.
- No persistent duplication of memory types into keyword tags.

## Decisions

### 1. Review proposals without mutating drafts

Replace Smart resolve's selection callback with a review action. Build an immutable proposal for the chosen host in the pure directory-map helper module. Use a draft target when present, including an explicitly empty target; otherwise use the server suggestion. Exclude the no-directory sentinel from maps. Preserve accepted edited choices and show rows without targets separately.

Keep the pending host and proposal with the settings owner. Put the bounded dialog markup in a dedicated settings component so `DirectoryMapsSection.tsx` keeps responsibility for state and persistence. Use the existing dialog exports for its title, description, scrollable body, and footer. The body shows paths and session counts only. Confirm is disabled when there are no maps or a save is pending.

Alternative considered: keep Smart resolve as a checkbox action and add more feedback. The user has already found that insufficient. A separate review step makes the intended save visible before it happens.

### 2. Confirm saves only the displayed proposal

Build the submitted `importPathMaps` from the latest loaded saved maps plus the reviewed proposal, keyed by source. Do not include pending removals or unrelated page decisions. Use the existing revision-checked settings PATCH. Keep the ordinary Save maps flow for manual bulk selections and removals.

On a successful PATCH, treat persistence as complete before refreshing. Reload the settings snapshot and map view while retaining unrelated draft decisions and pending removals. Retire only decisions for confirmed sources; a shared source has the same global outcome on every host. The current unconditional `load()` reset must be limited to the normal manual-save path rather than reused unchanged for confirmation.

Keep save and refresh failures distinct. A save failure keeps the dialog and reviewed proposal available. A revision conflict refreshes the revision but requires another explicit confirmation after review; never retry automatically. A successful save followed by a refresh failure reports the saved outcome and offers a refresh without sending another PATCH. Prevent duplicate submissions while saving. Block dismissing the pending confirmation until its outcome is known.

After a successful save, explain that the maps apply to the next import or backfill. Filtering a saved source out of this view does not mean its sessions have already been imported.

Alternative considered: reuse the current `save()` without changes. It would commit every selected host's drafts and pending removals, then clear unrelated edits. That exceeds what the modal displays and the user confirms.

### 3. Reuse deterministic colour identities for type labels

Use the existing hue calculation for colour identity rather than introducing random colours or stored palette records. Share that small pure calculation between keyword tags and type presentation if needed. Preserve existing keyword colour output. Memory type labels use `Badge` with transparent background and theme-readable coloured text and border. Unknown stored type strings use the same deterministic fallback.

Apply type presentation at both existing type-badge call sites in `MemoryCard.tsx`. Keep the type in its existing header position and preserve the actual keyword row. Rendering a label does not add it to the memory's `tags` field. Use existing semantic success colours for LINKED text and outline at both memory and prompt call sites.

Alternative considered: merge types into keyword tags or create a persistent label catalogue. Neither is needed for coloured role labels, and either would change stored data and filtering semantics.

### 4. Tooltips explain roles without changing actions

Use the current Tooltip primitive for the exact English role texts **Memory type** and **Tags**, with real Chinese and Arabic translations. Give type badge triggers keyboard focus so their explanation is available without a pointer. Keep keyword badges as buttons with their existing filter callback and `aria-pressed` state.

If Tooltip wraps `KeywordBadge`, forward its supplied `aria-describedby` to the rendered button; the current component does not accept that prop. Test the association on the actual trigger. Do not add a second competing native title tooltip. Retain the keyword's literal text and the filter action's accessible name.

Use `useI18n` keys for explorer messages and the existing settings translation helper for dialog messages. Preserve literal type identifiers, tags, paths, and Arabic technical-text direction.

Alternative considered: change only the native `title` strings. That would not supply the existing styled, keyboard-accessible tooltip contract.

## Risks / Trade-offs

- Unrelated drafts could be lost during refresh. Preserve them explicitly and test another host's edits and pending removals.
- Concurrent settings edits can invalidate the revision. Retain the proposal, show the conflict, and require a reviewed retry.
- A refresh failure can obscure a completed save. Record save success independently and offer refresh-only recovery.
- Hash-derived colours can share similar hues. Require stable identities and measured contrast, without promising a unique colour per value.
- Tooltips can clip or lose their accessible description. Forward trigger attributes and verify edge-of-viewport hover and keyboard focus.
- Saved maps can hide rows before imports finish. Keep success wording about saved maps and the next import, with no claim that session processing completed.

## Migration Plan

No storage migration is required. Deploy the frontend change with the existing package build after implementation and verification. Existing maps and memory metadata remain compatible. Rolling back the UI restores select-only Smart resolve without deleting any maps saved through confirmation.

## Verification Approach

Add regression tests before implementation and show they fail on the old behaviour. Pure helper tests cover proposal generation and host-isolated merge decisions. Rendered interaction tests cover dialog opening, cancellation, explicit saving, duplicate submission, conflicts, refresh recovery, and retained drafts.

Badge tests cover both type call sites and both existing LINKED call sites, transparent type backgrounds, stable hues, role tooltips, unchanged tag filtering, and no writes during rendering. Deliberately remove the colour or tooltip behaviour to prove the new tests detect it.

Use the existing synthetic visual preview and fixture API. Add long path, missing target, save failure, `analysis`, `bug-fix`, unknown type, and linked/unlinked fixtures. Verify the affected settings and explorer views against the local design skill's theme, language, narrow-width, zoom, contrast, and keyboard matrix. Do not connect tests to the shared backend or real memory store.

Update `docs/web-ui-settings.md` for review and confirmation, and `docs/web-ui.md` for memory type, tags, and link-status presentation. Run focused tests in separate processes, web checks, and strict OpenSpec validation. Obtain permission before dependency installs or the full `bun run ci:local` gate. Record PASS, FAIL, NOT RUN, or BLOCKED honestly before OpenSpec verification.
