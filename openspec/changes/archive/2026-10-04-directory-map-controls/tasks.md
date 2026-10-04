# Tasks

## 1. Bulk decisions and feedback

- [x] 1.1 Add focused tests in `tests/web-directory-maps.test.ts` for bulk selection, clearing, empty edited targets, shared sources, and repeated Smart resolve; confirm new assertions fail before implementation.
- [x] 1.2 Implement bulk decision helpers and Smart resolve result counts in `web/src/lib/directory-maps.ts`; verify `bun test tests/web-directory-maps.test.ts` passes without weakening existing assertions.

## 2. Compact directory maps UI

- [x] 2.1 Add collapsed host sections and compact expandable target rows in `DirectoryMapsSection.tsx`, preserving draft state and existing anchors; verify interactive toggling retains edited targets and selections.
- [x] 2.2 Add per-host Select all with targets, Clear selection, summary counts, and accessible Smart resolve feedback; verify click behaviour for suggestions, missing targets, already selected rows, and shared sources.
- [x] 2.3 Translate new visible and accessible messages in the existing English, Chinese, and Arabic settings pairs; verify complete translation coverage and literal path direction.
- [x] 2.4 Add UI regression coverage using the existing web test conventions; confirm assertions fail when controls or required behaviour are removed and pass with the implementation.

## 3. Documentation and verification

- [x] 3.1 Update `docs/web-ui-settings.md` with bulk review, explicit saving, and the meaning of an empty Smart resolve result; verify the guide matches rendered controls.
- **3.2 Waived by the user on 4 October 2026:** remaining browser verification is not required for this change. Completed browser checks and unverified keyboard, zoom, and visual states remain recorded in `verification.md`. This waiver does not count skipped checks as passed.
- [x] 3.3 Run focused directory-map tests, Aikido on changed code, and `bun run ci:local` after approval to install dependencies and run the full suite; report every command and result without retrying failures into a pass.
- [x] 3.4 Run OpenSpec verification against all requirements and record any gaps before requesting commit or PR approval.
