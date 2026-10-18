# Tasks

## 1. Evidence helper

- [x] 1.1 Write a failing unit test for `evidenceItems()` in `web/tests/`: list form, single-string form, empty, and the `manual-write` marker. Verify: the test fails before 1.2.
- [x] 1.2 Add `evidenceItems()` to `web/src/lib/profile-utils.ts`. Verify: the 1.1 test passes, and it fails again when the marker branch is removed.

## 2. Evidence dialog

- [x] 2.1 Add the translation keys for the button label, the `aria-label`, the dialog title, the hit count explanation, the evidence note, and the manual write label to English, Chinese, and Arabic in `web/src/lib/i18n/translations.ts`. Verify: `bun run check` passes.
- [x] 2.2 Write a failing render spec for `ProfileEvidenceDialog`: it lists every item in order, shows the manual write label, and shows `<b>bold</b>` as text. Verify: the spec fails before 2.3.
- [x] 2.3 Create `web/src/lib/components/explorer/ProfileEvidenceDialog.tsx` with `Dialog` and `ScrollArea`. Verify: the 2.2 spec passes.

## 3. Card footer

- [x] 3.1 Write a failing spec: a card with evidence renders a button with the translated label, and a card without evidence renders none. Verify: the spec fails before 3.2.
- [x] 3.2 In `ProfileView.tsx`, replace the evidence `<span>` and its `title` tooltip with the button, open `ProfileEvidenceDialog` for that item, and remove `evidenceTitle()` and `evidenceCount()`. Verify: the 3.1 spec passes, and `ProfileView.tsx` stays at 500 lines or fewer (`tests/file-size-ceiling.test.ts`).
- [x] 3.3 Update the "User profile page" section of `docs/web-ui.md` to describe the evidence dialog and say that evidence is model-written. Verify: Prettier passes on the changed docs.

## 4. Check

- [x] 4.1 Browser check against synthetic fixture data at desktop width and 390px width, in light and dark themes and in Arabic. Check the pointer, the keyboard (Enter, Escape, focus return), and the scrolling of a 10-item list. Verify: screenshots, with each check reported as PASS, FAIL, or NOT RUN.
- [x] 4.2 Run `bun run ci:local`. Verify: exit 0.

## Verification notes

- 4.1 browser check, synthetic fixture on port 5179 (no real store), Chrome:
  - PASS desktop 1280 px, dark theme: dialog opens with Enter, lists 10 items, the list scrolls, `manual-write` shows as a label, `<b>` shows as text.
  - PASS 390 px, light theme: dialog fits, no horizontal page scroll.
  - PASS Escape closes the dialog and focus returns to the button. The first run FAILED: `ProfileView` rebuilds its cards when state changes, so the opener was gone. Fixed by finding the button again by `data-evidence-key`.
  - PASS Arabic: labels translated, dialog and list right to left, English evidence still reads left to right. The first run FAILED: the Radix scroll area defaulted to left to right. Fixed by passing the page direction.
  - PASS pointer cursor on the button. Hover colour checked through its class and the keyboard focus colour; a real mouse hover was NOT RUN.
