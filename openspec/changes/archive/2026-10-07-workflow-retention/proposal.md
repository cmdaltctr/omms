## Why

The profile keeps only 4 workflows, although 4,164 history prompts went through profile learning between 28 September and 7 October 2026. Decay removes any item older than `userProfileStaleDays` (default 2) with fewer than `userProfileMinEvidenceForRetention` (default 3) evidence entries. The analysis schema gives workflows no `evidence` field, so every workflow has 0 evidence and is removed 2 days after it was last seen. The source prompts are gone too: the prompt store deletes old prompts, and the import ledger marks each `#profile` unit as done, so a rerun skips them.

## What Changes

- Workflows get their own retention rule. Decay counts a workflow's support as the larger of its evidence count and its `frequency`, and uses a new stale window `userProfileWorkflowStaleDays` (default 30). Preferences and patterns keep the current rule.
- `--force` on a history import also reprocesses profile prompts that the ledger marks as done. It records each prompt again as waiting and sends it to profile learning. `--force --skip-memories` rebuilds the profile from history without new memory work. This applies to the OpenCode, Pi and Claude Code imports, in the terminal, in session, and on the web import page.
- A dry run with `--force` reports the profile prompts it would reprocess.
- Docs: configuration, the three history import guides and the CLI guide describe the new key and the new `--force` scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `profile-learning`: adds a workflow retention requirement and a requirement that a forced history import re-analyses profile prompts.

## Impact

- `src/services/user-profile/user-profile-manager.ts` (`decayItems`), `src/config.ts` (new key, default and config template).
- `src/importer/profile-import.ts`, `src/importer/run-import.ts`, `src/importer/import-args.ts` help text, `src/services/user-prompt/user-prompt-manager.ts` (mark an existing prompt as waiting again).
- Tests for decay and profile import.
- Behaviour change for users who already pass `--force`: the run now also re-sends profile prompts, which costs model calls and raises the `frequency` of matched profile items. `--skip-profile` keeps the old memory-only behaviour.
- No host adapter changes. Both hosts use the shared parser and importer, so parity holds.
