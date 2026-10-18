## Context

`ProfileView.tsx` (430 lines, limit 500) renders the card footer at about lines 235-253. The evidence part is a `<span>` with a native `title` tooltip built by `evidenceTitle()`. The word "evidence" is hard-coded English. `ProfileItem.evidence` is `string[] | string` (`src/shared/api/schemas.ts:58`). Profile learning writes free-text strings, at most 10 per item, plus the marker `manual-write` for manual memory writes. Evidence items carry no prompt id, session id, or date.

`web/src/lib/components/ui/dialog.tsx` (Radix) and `scroll-area.tsx` exist. `ProfileItemDialog.tsx` is the nearest example.

## Goals / Non-Goals

**Goals:**

- One accessible dialog per card, opened from the evidence count.
- No API or storage change.

**Non-Goals:**

- Links from an evidence item to its source prompt or session. Evidence has no ids today. Adding them is a profile-learning change.
- Editing or deleting single evidence items.
- Cleaning private text out of evidence already stored. The privacy fix covers new prompts only.

## Decisions

1. **Dialog, not popover.** Ten items of up to a few hundred characters do not fit a popover. A dialog also gives focus trapping and Escape handling from Radix. Alternative: `InfoPopover`. Rejected for size and touch use.
2. **New component `ProfileEvidenceDialog.tsx`.** It keeps `ProfileView.tsx` under 500 lines and is testable alone. `ProfileView` holds one piece of state: the open item with its section and a focus key, or null. The count button is its own component, `ProfileEvidenceButton.tsx`, so it can be tested alone. Alternative: one dialog per card. Rejected because it mounts many dialogs.
3. **Pure helper for evidence items.** `evidenceItems(item)` returns a list of `{ kind: "text" | "manual-write", text }`. It replaces `evidenceTitle()` and `evidenceCount()` and handles the single-string form. A unit test covers it.
4. **Button style.** A ghost `xs` button with the existing `Info` icon and the translated count label, so the footer keeps its current look. It gets an `aria-label` such as "Show evidence (10)", a pointer cursor, and a primary text colour on hover and focus.
5. **Plain text only.** React escapes text by default. The dialog does not use `dangerouslySetInnerHTML` or a Markdown renderer.

6. **Focus return by key.** `ProfileView` defines its card component inside its render function, so every state change rebuilds the cards and the button that opened the dialog no longer exists when it closes. Each button carries `data-evidence-key` (`<section>-<index>`), and the dialog focuses the button with that key on close. Alternative: move the card component out of `ProfileView`. Rejected here as a larger refactor outside this change.
7. **List direction.** The Radix scroll area defaults to left to right, so the dialog passes the page direction to it, and each evidence line uses `dir="auto"` so English evidence reads correctly on an Arabic page.

## Risks / Trade-offs

- [Existing evidence can hold OpenCode `<private>` text saved before the fix] → Merge the privacy fix first. Note the gap in the docs. A one-off cleanup can follow if the user asks.
- [Evidence strings are model-written paraphrases, not exact quotes] → The dialog explains that evidence is what the profile analysis noted, not a verbatim transcript.
