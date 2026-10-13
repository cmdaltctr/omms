# Approved OpenCode profile-only rebuild

## Approval and scope

The user separately approved task 7.5 after the live category repair and no-op checks passed. The forced OpenCode import was started from `/Users/aizat/Development/PROJECTS/omms-fix-workflow-merge` on `fix/workflow-merge`.

Command arguments:

```text
import-opencode-history --scope all-projects --force --skip-memories --profile-batch 50
```

The runner calls the built CLI's `runCli` with these arguments. Runtime hand-off is disabled so another installed copy cannot replace the revised code.

## Preview and safeguards

- Dry-run real exit: `0`.
- Pending profile prompts: `2,452`.
- Sessions loaded: `431` of `452`.
- Child sessions folded: `545`.
- Twenty-one sessions have unresolved directories and are skipped under the existing import rules. No directory mappings were changed.
- Model: saved external `openai-chat/deepseek-flash`.
- All three host import records were checked; none was running before launch.
- Fresh SQLite backups cover `user-profiles`, `user-prompts`, `import-ledger`, `ai-sessions` and `metadata`. Every integrity check returned `ok`.
- Embedding warm-up passed in the actual import process before model calls. A failed warm-up stops this runner.
- Native import ledgers and prompt flags checkpoint completed units and profile batches. Failed batches stay retryable.

## Baseline from the backup

| Type        | Items | Categories     |
| ----------- | ----- | -------------- |
| Preferences | 822   | 727            |
| Patterns    | 838   | 766            |
| Workflows   | 136   | Not applicable |

## Run evidence and completion conditions

Private run directory:

`/Users/aizat/.omms/runs/normalise-profile-categories/opencode-20261009-201404.ysHdtV/`

- Import PID at launch: `95875`.
- The user requested a pause. The profile-only pause path ignored its flag, so the owned process was stopped with SIGTERM after fresh snapshots.
- Recorded completed batches at stop: `5/46`.
- Real process exit: `143` (requested termination). Final snapshot/measurement exit: `0`.
- Partial snapshot: preferences `749` categories / `831` items; patterns `781` / `848`; workflows `135`. These are partial results, not a completed rebuild.
- `output/status.json` records setup state, PID and whether warm-up passed.
- `output/import.log` holds the CLI output; `output/omms.log` is the isolated private engine log.
- `output/exit-code` is written atomically after the import process exits and contains its real exit code.
- `output/after-import.json` and `backups/user-profiles-after-import.db` will hold the final measurement.
- `output/measurement-exit-code` records whether final measurement succeeded.
- `output/before-import.json` holds the baseline counts from the backup.

Task 7.5 remains unchecked. Verify the real exit code, the final report, the import-run record and the measured counts before recording a result in TDR-042. A live process or a successful background launch is not completion.

The importer is stopped and was not resumed. The user approved fixing Pause and the conflict-check budget here, without a new spec or worktree. Both fixes passed regression tests and the full local CI rerun, real exit `0`: `/tmp/omms-control-fixes-ci.quErVP`. See TDR-043. The original pause regression failed before the fix, and negative conflict answers previously allowed eight calls where three were expected.

No Jev integration, decision-model experiment, archive, commit or push has run. Task 7.5 remains incomplete until the remaining import work is resumed or its measurement scope is explicitly revised.
