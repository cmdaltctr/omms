## 1. Snapshot note shape (core)

- [x] 1.1 Update the snapshot expectations in `tests/memorisation-core.test.ts`. Cover the title line, the `## Done`/`## Doing`/`## Next` sections, a regression test for the label-line bug (a `done` value of `- a\n- b` gives `## Done` on its own line and both bullets below it, never `Done: - a`), no topic, and empty fields left out. Run `bash scripts/run-tests-isolated.sh tests/memorisation-core.test.ts` and confirm that it fails on the current `snapshotText`.
- [x] 1.2 Change `snapshotText` in `src/core/memorisation.ts` to the new shape. Make the 1.1 tests pass.
- [x] 1.3 Update the stored-text expectations in `tests/memory-operations-memorise.test.ts`, `tests/cli-memory.test.ts` and `tests/memorisation-routes.test.ts`. Run each file through the isolated runner, and confirm that each passes.

## 2. Note length presets (core)

- [x] 2.1 Add tests to `tests/memorisation-core.test.ts` for `noteLengthFor` and preset validation. Cover these cases:
  - the default (`medium`, 2000 characters)
  - each default preset in each unit
  - a custom value (3000 characters)
  - an edited Short of 1000 matched as 1000 characters and as 250 tokens
  - out-of-range values (99, 20001, 1.5)
  - presets out of order

  Confirm that the tests fail before 2.2.

- [x] 2.2 Add the preset rules, the token conversion (`Math.ceil(chars / 4)`) and `noteLengthFor` to `src/core/memorisation.ts` as pure code with no `CONFIG` import. Make 2.1 pass.
- [x] 2.3 Add tests for the three new settings. Cover `settingsFrom` defaults and invalid config, a refused edit in `checkMemorisationSettingsEdits` that keeps the previous values, the project-config drop in `removeMemorisationProjectOverrides`, the config writer and the settings snapshot. Use the existing memorisation settings test files. Confirm that the tests fail before 2.4.
- [x] 2.4 Add `memorisationShortSize`, `memorisationMediumSize` and `memorisationLongSize` to the following, with defaults 800, 2000 and 5000. Make 2.3 pass.
  - `MEMORISATION_KEYS` and `MEMORISATION_DEFAULTS`
  - `settingsFrom` and `checkMemorisationSettingsEdits`
  - `src/config.ts`, `src/config-template.ts` and `src/config-writer.ts`
  - `src/services/settings-snapshot.ts` and `src/services/settings-editable-keys.ts`

  Grep `docs/` and `README.md` for each touched default.

- [x] 2.5 Add a help-mode test. Use a config stub with a cap of 800 characters. Assert that `help` returns `memorisation: { length: "short", maxSize: 800, unit: "characters" }`. Add a CLI case for `om-memory-system memory help` in `tests/cli-memory.test.ts`. Add a case with an edited Short of 1000 and a cap of 1000 characters, which must report `short`. Confirm that all of them fail before 2.6.
- [x] 2.6 Add the `memorisation` object to the `help` case in `src/core/memory-operations.ts`. Read the settings through `settingsFrom` in `src/core/memorisation-settings.ts`, the way `memorise` reads them, on each call. Make 2.5 pass, and confirm that `tests/modularity-ratchets.test.ts` still passes.

## 3. Memorisation page

- [x] 3.1 Add title cases to `web/tests/memorisation-routes.spec.ts`: a heading line, bold text, inline code, a link and a list marker are stripped; the legacy `Topic:` line still wins; the new snapshot shape gives its first line. Confirm that the new cases fail before 3.2.
- [x] 3.2 Add a plain-text stripper to `memorisationTitle` in `web/src/lib/memorisation-model.ts`. Make 3.1 pass.
- [x] 3.3 In `web/tests/memorisation-view.spec.tsx`, replace the `<pre>` assertion. Assert that the opened panel has the `markdown-content` class and that its sanitised HTML holds an `<h2>` and `<li>` items for a structured note, and no `<script>` for unsafe input. Confirm that the test fails before 3.4.
- [x] 3.4 In `MemorisationRow.tsx`, render the full text with `renderMarkdown` and `.markdown-content`, the way `MemoryCard.tsx` does. Keep the box, `dir="auto"`, the height cap and the aria label. Make 3.3 pass.
- [x] 3.5 Add form tests for the preset choice. Cover these cases:
  - Short fills 800.
  - A typed 3000 selects Custom.
  - A saved 500 tokens opens as Medium and Tokens.
  - A unit switch on Long gives 1250.
  - Presets from the snapshot (Short 1000) show 1000 and 250.

  Add a test that the web token rule matches the core rule. Confirm that the tests fail before 3.6.

- [x] 3.6 Add the preset helpers to `web/src/lib/memorisation-model.ts`. They read the preset values from the settings snapshot. Add the Short/Medium/Long/Custom radio group with values to `SizeCapForm.tsx`, styled like the unit choice. Make 3.5 pass.
- [x] 3.7 Add tests for the preset editor. Cover these cases:
  - Edit presets opens the three boxes with token estimates.
  - Saving an edited selected preset also writes the cap.
  - Saving another preset leaves the cap unchanged.
  - Out-of-order values show the rule and send no request.
  - Reset presets fills 800, 2000 and 5000 without a request.
  - Cancel closes the boxes without a request.

  Confirm that the tests fail before 3.8.

- [x] 3.8 Add the preset editor as its own component in `web/src/lib/components/memorisation/` and wire it into the Size cap card. Add every new string in English, Chinese and Arabic. Make 3.7 pass. Keep each file at 500 lines or fewer.
- [x] 3.9 Run `bun run check` and confirm that it passes. Check the page in a browser at desktop and mobile width (Chrome DevTools MCP, else Orca). Use one new snapshot, one structured note, one legacy `Topic:` record, each preset and the open preset editor. Include the Arabic layout. Save the screenshots in the scratchpad.

## 4. omms-remember skill

- [x] 4.1 Add `toContain` checks to `tests/claude-plugin-assets.test.ts` for the new skill text. Cover the `help` call before writing, the four length rules, the medium fallback, bullet fields, the title-line-and-sections note shape, and dictated text kept unchanged. Confirm that they fail before 4.2.
- [x] 4.2 Update `skills/omms-remember/SKILL.md`. Add a "Check the note length" step that calls `help`, with the length rules. Write snapshot fields as bullet lists. Add a "Write a note" section with one short example: a title line, `## Decision`, `## Why` and `## Plan`. Keep dictated text unchanged. Make 4.1 pass. Run `tests/package-skills.test.ts` and `tests/opencode-skills.test.ts` and confirm that both pass.

## 5. Documentation and ADR

- [x] 5.1 Update `docs/using-memory.md` (the memorisation section) and `docs/web-ui-memory.md` (the Memorisation page). Describe the note shape, the Markdown view, the length presets, the preset editor and its three settings, and the `help` output. Run Prettier on both files.
- [x] 5.2 Set ADR-054 (`docs/adr/054-memorisations-are-markdown-notes-of-a-chosen-length.md`) to Accepted after the user approves. Confirm that the ADR index row matches.

## 6. Verification

- [x] 6.1 Run `bash scripts/test-claude-mod.sh` and confirm that it passes (the skill is part of the plugin assets).
- [x] 6.2 Live check in a scratch HOME with its own port and store. Edit Short to 1000 on the page, choose Short and save. Run `om-memory-system memory help` and confirm that it reports `short` with cap 1000. Save one snapshot through the CLI with a bullet list in `--done`, and one composed note with `content`. Open the page and confirm that both render as Markdown with plain titles. Record the IDs.
- [x] 6.3 Run `bun run ci:local` and confirm the exit line shows exit 0.
- [x] 6.4 Run `graphify update .`.

## Workflow follow-up

- Run the `openspec-verify-change` skill, then archive the change before the pull request.
- Ask the user before commit, push or pull request.
