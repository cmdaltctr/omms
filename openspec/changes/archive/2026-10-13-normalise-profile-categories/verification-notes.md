# Verification notes: normalise-profile-categories

## Status

The static implementation/spec review found one correctness defect. This change is not ready for archive or submission. Task 7.5's import was stopped after five completed batches, with real exit `143` and measurement exit `0`. Its full measurement remains incomplete.

The user approved recovery after tracked changes were reverted and this change directory was removed. Source and planning files have been restored from the earlier session records. The retained `dist/` was left unchanged. The user requested no further security checks; this is a correctness review only.

## Finding: reserved explicit label

`canonicaliseCategories` chooses a winner before calling `tidyCategory`. A count tie between `explicit` and `Explicit` selects the capitalised spelling. `tidyCategory` preserves that winner's capital, so both items become `Explicit`.

The delta spec requires the reserved `explicit` category to stay `explicit`. The existing literal-only test does not cover a competing spelling.

Parent reproduction used the built pure module without touching a store:

```json
{
  "input": {
    "preferences": [{ "category": "explicit" }],
    "patterns": [{ "category": "Explicit" }],
    "workflows": []
  },
  "expected_labels": ["explicit", "explicit"],
  "actual_labels": ["Explicit", "Explicit"]
}
```

A read-only live check found two items under `explicit` and none under other spellings of that key at the time of the check. The defect was reproduced with synthetic data; it was not observed in that live check.

## Fix: reserved explicit label (task 6.8)

`canonicaliseCategories` now labels the reserved key `explicit` as `explicit` before normal winner selection (`src/services/user-profile/profile-category.ts`). `mergeItems` and its `explicit` discriminator are unchanged. The spec delta states the rule and has a new scenario for the capitalised variant.

Red, before the fix (isolated runner, real exit `1` for each file):

- `tests/profile-category.test.ts`: tied, more frequent and lone `Explicit` cases failed with `Explicit` labels.
- `tests/profile-category-save.test.ts`: creation and update paths stored `Explicit`.
- `tests/profile-normalise-categories-command.test.ts`: the preview proposed `"explicit" -> "Explicit"`.

Green, after the fix: `profile-category` 13 pass, `profile-category-save` 3, `profile-normalise-categories-command` 6, `profile-category-merge` 2, `profile-category-manual-edit` 1, `profile-category-list` 4, `profile-category-prompt` 3, `profile-candidate-matching` 9, `profile-workflow-merge` 9. Every file exited `0`. A guard test confirms that "Explicit rules" and "explicitly" keep their own labels.

No live repair is needed: the earlier read-only live check found only `explicit`. Re-check read-only before the import resumes.

## Required before the import resumes

1. Write regressions before changing the helper, and confirm they fail on the current code.
2. Cover tied and more frequent capitalised variants across preferences and patterns.
3. Preserve the reserved `explicit` key as the canonical lower-case label before normal winner selection.
4. Verify creation, updates and repair preview/confirmation through their shared save path.
5. Check item order, other fields and second-run idempotence.
6. Rebuild and rerun focused tests, local CI and strict validation after every import has stopped.
7. Preview any live label repair needed after the fix and seek separate approval before applying it.

The repair must preserve normal capitalised labels and the approved readable-label priority. Keep `mergeItems` and its special `explicit` discriminator unchanged.

## Static coverage

| Requirement                            | Reviewed implementation and tests                                           |
| -------------------------------------- | --------------------------------------------------------------------------- |
| Hidden key matching                    | Candidate helper, exact match and neighbour fold; matching/merge tests      |
| Readable label priority                | Pure category helper; frequency, capital, lone-hyphen and idempotence tests |
| Creation and update saves              | Shared canonicalisation calls; category-save tests                          |
| Manual edits                           | Real handler/save-path regression                                           |
| AI cleanup saves                       | Shared update path; coverage is indirect                                    |
| Shared bounded category prompt lists   | Core builder and both callers; list/prompt parity tests                     |
| Repair preview, confirmation and no-op | Command, CLI dispatch and isolated command tests                            |

No other defects were reported within the read-only subagent's scope. It read source and tests, but did not execute tests, inspect git diff, access live stores or perform security checks. Parent test results remain separate evidence.

Saved review: `/Users/aizat/.pi/agent/omps/runs/01a121c2-1102-74a9-b7fe-c4d2051c0716/75fa5f04-cb5b-4c63-a10e-4b12668c7dd5/output.md`.

## Recovery verification

- Before recovery, nine of ten focused test files failed. Real runner exit: `1`; log: `/tmp/omms-readiness-tests.b80YA1`.
- The six restored source modules produce JavaScript identical to the retained build when transpiled in memory. No build files were written.
- After recovery, 60 tests passed across 14 isolated files. Real runner exit: `0`; log: `/tmp/omms-recovery-tests.s4PlVe`. This covers category rules, candidate matching, merge/save/manual-edit paths, lists, prompt parity, the repair command, Pause, the conflict cap, workflow safeguards and host boundaries.
- `bun run check` passed with real exit `0`; log: `/tmp/omms-recovery-check.3eT4DI`.
- `openspec validate normalise-profile-categories --strict` passed. The recovered task list records 26 of 27 tasks complete; task 7.5 stays unchecked.
- `graphify update .` passed and found no code-graph topology changes.
- A fresh full `ci:local` run has not been started. The historical exit `0` remains separate evidence.
- Backup of the pre-recovery checkout and retained build modules: `/tmp/omms-before-recovery.XXXXXX.tar.gz`.

The reserved `explicit` defect remains unchanged. No import, live repair, Jev integration, security scan, archive, commit or push was started during recovery.
