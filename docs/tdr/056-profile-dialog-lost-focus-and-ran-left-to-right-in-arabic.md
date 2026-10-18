# TDR-056: The profile evidence dialog lost focus and ran left to right in Arabic

- **ID:** TDR-056
- **Date:** 2026-10-18
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Tags:** web-ui, react, radix, focus, rtl

## Context

The evidence dialog (`ProfileEvidenceDialog.tsx`) passed unit tests. A browser check on fixture data found two faults. The same two patterns can affect any new dialog.

### Root Cause Analysis

1. **Focus did not return to the opener.** `ProfileView.tsx` defines its card component inside its render function. Every state change makes a new component type, so React remounts all cards. The button that opened the dialog no longer exists when the dialog closes, and Radix has nothing to focus. A first fix read the key from state, but closing clears that state before Radix runs `onCloseAutoFocus`.
2. **The list ran left to right in Arabic.** The Radix scroll area sets its own direction and ignores the page direction.

## Decision

- Each evidence button carries `data-evidence-key` (`<section>-<index>`). The dialog keeps the last key in a ref and, in `onCloseAutoFocus`, focuses the button with that key.
- The dialog passes `dir` to the scroll area from the interface language, and each evidence line uses `dir="auto"` so English text reads correctly on an Arabic page.

## Consequences

**Positive**

- Escape returns focus to the button, and Arabic lays out right to left.

**Negative**

- The data attribute is a small coupling between the button and the dialog.

**Neutral**

- Defining the card component inside the render function is still there. Moving it out is a larger refactor.

## Alternatives Considered

| Option                                        | Rejected because                       |
| --------------------------------------------- | -------------------------------------- |
| Move the card component out of `ProfileView`  | Larger change, outside this work       |
| Read the key from state in `onCloseAutoFocus` | State is already cleared at that point |

## How to Recognise / Handle This Again

- Open a dialog from a card with the keyboard, press Escape, and check where focus lands (`document.activeElement`).
- Switch to Arabic and check that numbers sit on the right.
- Unit tests that render to static markup do not catch either fault. Check in a browser on the synthetic fixture (`web/tests/visual`).

## Revisit Triggers

- `ProfileView` is refactored so cards keep their identity between renders.

## References

- `web/src/lib/components/explorer/ProfileEvidenceDialog.tsx`, `ProfileEvidenceButton.tsx`, `ProfileView.tsx`
- [Archived change](../../openspec/changes/archive/2026-10-18-profile-evidence-popup/tasks.md) (verification notes)
