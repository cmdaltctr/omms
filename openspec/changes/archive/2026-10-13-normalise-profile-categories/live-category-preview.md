# Live category repair preview

The first preview failed the label safety check. The user approved option 2, then separately approved applying the corrected preview. Tasks 7.1 to 7.4 passed. The forced import has not run.

## Backup and unchanged-state checks

- SQLite backup: `/Users/aizat/.omms/backups/user-profiles-before-normalise-20261009-193228.db`.
- Backup integrity check: `ok`.
- Full preview: `/Users/aizat/.omms/backups/user-profiles-before-normalise-20261009-193228.preview.txt`.
- Verification evidence: `/tmp/omms-live-category-preview.6EzcFa/verification.json`.
- The preview used the built worktree command implementation with no arguments, bypassing runtime hand-off registration.
- Configured storage matched the backed-up live store.
- Preview real exit code: `0`.
- Database file hash, all profile rows and all changelog rows were unchanged after preview.

## Counts

| Type        | Items | Categories before | Proposed categories after |
| ----------- | ----- | ----------------- | ------------------------- |
| Preferences | 819   | 813               | 724                       |
| Patterns    | 833   | 826               | 761                       |
| Workflows   | 137   | Not applicable    | Not applicable            |

The full list contains 544 distinct renames affecting 587 items. No proposed label contains an underscore.

## Label safety failure

The most-used-spelling rule selects hyphenated winners for five existing spaced labels:

| Old label            | Proposed label       | Items |
| -------------------- | -------------------- | ----- |
| `git workflow`       | `Git-workflow`       | 1     |
| `Git workflow`       | `Git-workflow`       | 1     |
| `Decision style`     | `Decision-style`     | 1     |
| `Process discipline` | `Process-discipline` | 1     |
| `decision style`     | `Decision-style`     | 1     |

The original design anticipated this cost. The user chose to prefer existing labels without `_` or `-` before frequency. The proposal, design and spec were updated, and TDR-042 supersedes the old label priority. This first preview is historical evidence and must not be applied.

## Corrected preview

- Fresh SQLite backup: `/Users/aizat/.omms/backups/user-profiles-before-normalise-readable-20261009-195943.db`.
- Backup integrity check: `ok`.
- Full corrected preview: `/Users/aizat/.omms/backups/user-profiles-before-normalise-readable-20261009-195943.preview.txt`.
- Verification evidence: `/tmp/omms-readable-live-preview.LBJ00e/verification.json`.
- Real preview exit code: `0`.
- Database bytes, all profile rows and all changelog rows were unchanged during the preview.
- New underscore labels: `0`.
- Existing plain labels changed to separator spellings: `0`.
- Proposed distinct renames: `539`, affecting `582` items.

| Type        | Items | Categories before | Proposed categories after |
| ----------- | ----- | ----------------- | ------------------------- |
| Preferences | 822   | 816               | 727                       |
| Patterns    | 838   | 831               | 766                       |
| Workflows   | 136   | Not applicable    | Not applicable            |

The live profile changed between the two snapshots. Each preview separately left it unchanged. These counts describe the corrected preview's snapshot.

The two new regression tests failed on the old comparator, then passed with readable spelling ranked first. All 46 focused category/workflow tests passed. Revised local CI returned real exit `0`: `/tmp/omms-readable-category-ci.jSSyo4`. Package checks and strict validation passed. A bounded read-only check of option 2 found no defects; it was not a repo-wide security review.

## Confirmed repair and verification

The user approved `--yes` after reviewing the corrected preview. A fresh backup was taken immediately before repair:

- `/Users/aizat/.omms/backups/user-profiles-before-normalise-apply-20261009-200320.db`.
- Integrity check: `ok`.
- Profile and changelog rows still matched the approved preview before repair.
- Repair real exit code: `0`.
- Renamed items: `582` in `539` rename groups.
- The active profile version changed from `297` to `298`.
- Item order, item counts, workflows, all other item fields and unrelated profiles stayed unchanged.
- Preference categories fell from `816` to `727`, across `822` items.
- Pattern categories fell from `831` to `766`, across `838` items.
- Workflows stayed at `136` items.

One new changelog entry was added. The configured retention count is `5`, so the oldest entry expired. The earlier profile snapshot (version `297`) and repaired snapshot (`298`) remain available. The initial verification assertion expected the total changelog count to grow; correcting that assertion to account for retention confirmed the saved state.

The loopback web API returned HTTP `200` and profile version `298`. Preferences and patterns each have one visible "Communication style" label, covering four items per type. Neither type contains underscores. API counts match the repaired database.

The second `--yes` run returned real exit `0`, printed `Changes: 0`, and left the database file, all profile rows and all changelog rows unchanged.

Aggregate verification evidence:

- `/tmp/omms-live-category-apply.4q8i_6pq/verification.json`
- `/tmp/omms-live-category-apply.4q8i_6pq/web-api-verification.json`
- `/tmp/omms-live-category-apply.4q8i_6pq/second-run-verification.json`

Tasks 7.1 to 7.4 are complete. The user separately approved task 7.5, then paused the forced OpenCode profile-only import after five completed batches. Its full measurement is incomplete. See `live-opencode-rebuild.md` for the run evidence and completion checks. No experiment, archive, commit or push has run.
