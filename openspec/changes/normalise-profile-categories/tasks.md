# Tasks

## 1. Key, label, and profile-wide rules

- [x] 1.1 Write `tests/profile-category.test.ts` for `categoryKey`: "Communication_Style", "communication-style", " Communication style " and "Communication Style" share one key; "UI/UX" keeps its slash; "tooling" and "testing" differ; a blank gives "general". Verify the tests fail because the module does not exist.
- [x] 1.2 Add tests for `tidyCategory`: "writing_standards" gives "Writing standards"; "UI/UX", "OpenSpec conventions", "Communication Style" and "Anti-over-engineering" stay as written; "" and " " give "General"; "explicit" stays "explicit"; the function is idempotent. Verify they fail.
- [x] 1.3 Add tests for `canonicaliseCategories` on a profile: 3 "Communication Style" and 2 "Communication style" all become "Communication Style"; a 2 to 2 tie of "communication_style" and "Communication style" gives "Communication style"; a tie between "communication-style" and "Communication style" gives the spaced one; counts run across preferences and patterns together; 50 "Communication style" plus one new "communication_style" gives all "Communication style"; workflows, item order, item count and every other field stay unchanged; a second call changes nothing. Verify they fail.
- [x] 1.4 Add `src/services/user-profile/profile-category.ts` with the three functions and no imports. Verify tasks 1.1 to 1.3 pass.

## 2. Merge comparison

- [x] 2.1 Write tests in `tests/profile-category-merge.test.ts`, modelled on `tests/profile-workflow-merge.test.ts`: a new "Communication style" preference with a similarity of 0.85 to a stored "communication_style" item merges into it (frequency 2). A pair under different categories ("tooling" against "testing") with a similarity of 0.75 does not merge, because 0.75 is below the cross-category weak threshold (0.8). Do not use 0.85 for this case: it falls in the weak band, which is a random draw. Verify the first test fails on current code.
- [x] 2.2 Extract candidate matching from `mergeItems` into a focused helper, as approved by the user for the third edit. Verify existing merge tests pass before changing comparison behaviour. Replace category-identity comparisons with a key comparison, preserving workflow safeguards and the special `explicit` check. Verify the category merge tests and `tests/profile-workflow-merge.test.ts` pass.

## 3. Save path

- [x] 3.1 Write tests: `createProfile` and `updateProfile` store one label per key, tidy new labels, keep "UI/UX" and "explicit", store "General" for a blank category, and leave workflows untouched. Verify they fail on current code.
- [x] 3.2 Call `canonicaliseCategories` in `createProfile` and `updateProfile`. Verify the tests pass.
- [x] 3.3 Write a test that `handleUpdateProfileItem` changing one item to "git_workflow" stores "Git workflow", and that a change to a new spelling of an existing key stores the existing label. Verify it passes through the save path with no change to the handler. If it fails, fix the handler and say so in the report.

## 4. Category list in the prompts

- [x] 4.1 Write tests in `tests/profile-category-list.test.ts`: `buildCategoryList` shows one visible label per key with its count; sorts by count; stops at 40 labels for 100 categories; returns an empty string for an empty profile. Verify the tests fail because the function does not exist.
- [x] 4.2 Add `buildCategoryList` and the "use these exact names when your observation fits" wording to `src/core/extraction.ts`. Verify the tests pass.
- [x] 4.3 Write a test that the shared analysis prompt holds the list when an existing profile is given and holds none when it is not. Verify it fails on current code. Pass the existing profile's categories into the prompt in `src/core/profile-analysis.ts`. Verify it passes.
- [x] 4.4 Write a test that the OpenCode prompt holds the same list text as the shared prompt for one profile. Verify it fails on current code. Make `buildCategorySummary` in `src/adapters/opencode/profile-learning.ts` call the shared builder for its category section, and leave the rest of its summary as it is. Verify it passes and that `tests/profile-workflow-prompt.test.ts` still passes.

## 5. Repair command

- [x] 5.1 Write `tests/profile-normalise-categories-command.test.ts`, modelled on `tests/profile-catch-up-command.test.ts`: a preview lists each rename with its count and writes nothing; `--dry-run --yes` writes nothing; `--yes` applies the renames, keeps the item count, changes no other field, and adds one changelog entry; a second `--yes` run reports 0 changes and adds no entry; an unknown option is refused. Verify the tests fail because the command does not exist.
- [x] 5.2 Add `src/cli/profile-normalise-categories-command.ts` and the dispatch and usage line in `src/cli/index.ts`. Verify the tests pass.

## 6. Documentation and gate

- [x] 6.1 Update `docs/using-memory.md` (how categories are matched, labelled and listed) and `docs/cli.md` (the new command, with the preview step first).
- [x] 6.2 Add a TDR in `docs/tdr/` for the spelling-variant finding, with the live counts (754 categories for 760 preferences, 1,573 labels in total, 77 with acronyms or proper names) and the reason lower case was rejected. Add it to the folder index.
- [x] 6.3 Run `openspec validate normalise-profile-categories --strict`. Verify no findings.
- [x] 6.4 Run `bun run ci:local` and capture its real exit code. Verify it is 0.

- [x] 6.5 Add failing regressions for a rare readable spelling against frequent hyphenated and underscore variants, counted across preferences and patterns. Change label selection to prefer existing spellings without `_` or `-` before frequency. Verify frequency and tie rules within each preference class, preservation of lone hyphenated labels, idempotence, save paths, prompts and repair-command tests.
- [x] 6.6 Update the category guide and record the approved rule revision in a new TDR that supersedes TDR-041. Preserve the original decision as history.
- [x] 6.7 Rerun focused tests, package checks and strict validation, then `bun run ci:local` with its real exit code. Check that no import is running before rebuilding `dist/`.
- [x] 6.8 Fix the reserved `explicit` label defect found in verification. Add failing regressions for tied and more frequent "Explicit" variants across preferences and patterns, the creation and update save paths, and the repair command with its idempotent second run. Make `canonicaliseCategories` label the reserved key `explicit` before normal winner selection. Keep `mergeItems` and its `explicit` discriminator unchanged. Verify the regressions fail first, then pass.

## 7. Repair the live profile (after the fix is built and installed)

- [x] 7.1 Take a snapshot of `~/.omms/data/user-profiles.db` with `sqlite3 .backup`. Run `profile-normalise-categories` without `--yes`. Read every rename in the list. Verify nothing is written, and that no rename turns a good label into a slug or hyphenated form.
- [x] 7.2 Run it with `--yes`. Verify the item counts are unchanged and the distinct categories fall to the number shown in the preview.
- [x] 7.3 Read the profile through the web API. Verify one "Communication style" category remains in preferences and in patterns, and that no category holds `_`.
- [x] 7.4 Run it with `--yes` a second time. Verify it reports 0 changes.
- [ ] 7.5 Run one profile rebuild (the OpenCode import is the natural one). Count distinct categories against items again, and record the result in the TDR. This decides whether the experiment in `evaluate-memory-decision-models` is worth running.
