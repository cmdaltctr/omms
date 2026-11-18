# Design: unify profile learning

## Context

See `proposal.md` for the why. The step-by-step gap list is in `openspec/changes/modularity-follow-ups/design.md`, "Task 2.1 inventory". Code facts checked on 2026-11-18 at `a112296c`:

| Host        | Trigger                                                                                      | Loop                                                                 | Prompt source                                   |
| ----------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| OpenCode    | `src/v2/session-events.ts` idle, then `performUserProfileLearning(directory)`                | `src/adapters/opencode/profile-learning.ts` (824 lines, ceiling 832) | `user-prompts.db`, newest first (`recentFirst`) |
| Pi          | `src/adapters/pi/extension.ts` `agent_settled`, in-memory list `promptsSinceProfileAnalysis` | `performPiProfileLearning` in `src/adapters/pi/profile.ts`           | memory only; Pi never calls `savePrompt`        |
| Claude Code | `src/importer/claude-hook-api.ts` after capture, `learnClaudeProfile`                        | `src/importer/claude-profile-learning.ts`                            | `user-prompts.db`, newest first                 |
| Catch-up    | page or `profile-catch-up` command                                                           | `drainProfileBacklog` in `src/importer/profile-backlog.ts`           | `user-prompts.db`, oldest first, batches of 50  |

Other facts that shape the design:

- `analyzeProfile` (`src/core/profile-analysis.ts`) ignores `ModelPort.completeStructured` today. It always calls `complete()` and checks the reply with the shared schema.
- OpenCode's external path calls `executeToolCall` with `createUserProfileToolSchema` and does not check the reply. Pi and Claude Code use `selectImportModel({}).profile` from `src/importer/model-selection.ts`, which checks it.
- `saveMergedProfile` (`src/services/user-profile/merge-and-save.ts`) already makes 3 attempts and re-reads with `getProfileById`.
- Both `getPromptsForUserLearning` and `drainProfileBacklog` mark prompts as learned only after the save. Nothing stops two processes from taking the same batch. This is true today for two OpenCode processes, for OpenCode beside the Claude Code web app, and for a live pass beside a catch-up run.
- `user-prompt-manager.ts` sits at its ratchet ceilings: 39 raw SQL sites, 3 storage imports, 1 `CONFIG` import. `config.ts` is 923 lines against a ceiling of 927. `claude-hook-api.ts` is 523 against 525.
- Claude Code docs: `systemMessage` is a common hook output field and `UserPromptSubmit` accepts every JSON output field. A deferred notice on the next prompt hook is therefore possible.
- The live model rule in `host-neutral-memory-core` already says the user "SHALL be notified" when a host model falls back. OpenCode profile learning did not do this, so the OpenCode notice restores specified behaviour.

## Goals / Non-Goals

**Goals:**

- One learning pass in `src/core/profile-learning/`, used by all three hosts.
- Adapters keep only the host model port, the trigger and the notice display.
- No `CONFIG` import in the new core files, no host-name comparison in shared code.
- `src/adapters/opencode/profile-learning.ts` leaves the ceiling list.

**Non-Goals:**

- The catch-up run and the history import keep `drainProfileBacklog`. They gain the batch claim only. Their prompt input stays "numbered prompts" because they run in bulk and their spec is unchanged.
- No change to the live model order, the merge rules, decay maths, or the automatic cleanup.
- No per-host settings.
- No new storage engine and no move of SQL out of `user-prompt-manager.ts` (that is part 1 of `modularity-follow-ups`).

## Decisions

### D1. The shared pass and its ports

`src/core/profile-learning/` holds four files, each under 300 lines:

| File             | Holds                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `settings.ts`    | Keys, defaults, `profileLearningSettingsFrom(file)`, `removeProfileLearningProjectOverrides`, edit checks. No imports of config.  |
| `model-input.ts` | The full input (moved from OpenCode `buildUserAnalysisContext` and `buildCategorySummary`), the prompts-only input, the byte cut. |
| `validation.ts`  | The validation task text and `applyValidations` (moved from OpenCode).                                                            |
| `pass.ts`        | `runProfileLearningPass(input)`: the steps in the spec, the notice text and the history text.                                     |

`runProfileLearningPass` takes:

```ts
interface ProfileLearningPassInput {
  host: MemoryHost;
  directory: string;
  config: ProfileLearningConfig; // Pick<OmmsConfig, ...>, passed in by the adapter
  model: () => ModelPort | null | Promise<ModelPort | null>;
  notify?: (n: {
    title: string;
    message: string;
    variant: "success" | "warning" | "error";
  }) => void | Promise<void>;
  cleanupModel?: ProfileCleanupModel; // the pass starts cleanup itself, with this model
}
```

It returns `{ outcome: "saved" | "skipped" | "failed"; reason?: ProfileFailureCode }` and never throws. The re-entry flag and `profileBackoff` live in `pass.ts`, one per process, as today. The adapter calls `refreshConfigIfChanged(directory)` and passes `CONFIG` (D5 of `modularity-follow-ups`).

History text and notice text use `HOST_INFO[host].label` only. `recordProfileFailure(host, ...)` keeps the per-host log record. This passes `tests/host-branch-boundary.test.ts`.

Alternative considered: extend `drainProfileBacklog` to serve live passes. Rejected: it loops until the queue is empty and owns catch-up lease hooks. A live pass takes one batch.

### D2. Model calls go through `analyzeProfile`

`analyzeProfile` uses `completeStructured` when the port has it, and `complete()` otherwise. It checks the reply with the shared schema in both cases. The system prompt stays `buildProfileAnalysisSystemPrompt`, so the category list stays the same for every host (existing requirement "The profile prompt lists the existing categories"). The pass builds the user message with `model-input.ts`. The error and log texts lose their `pi ` prefix; `profileFailureCode` still finds `timeout` and `invalid profile payload`.

### D3. Host model ports

- **OpenCode:** new `src/adapters/opencode/profile-model.ts`. `completeStructured` calls `generateStructuredOutput` through `getOpencodeProfileHost()` with a 120 s limit, as today. This keeps the V2 sessionless structured-output rule in `opencode-v2-adapter`.
- **Pi:** `createPiLiveModels(...).profile`, unchanged.
- **Claude Code:** `selectImportModel({}).profile`, unchanged.
- **Fallback:** new `src/core/profile-learning/fallback.ts`, `withExternalFallback(host, primary, external, notify)`. When the primary call throws and the external API is ready, it shows "Using fallback provider" / "<Host> model failed (<reason, 100 chars>); using configured fallback." and calls the external port. OpenCode uses it. Pi's profile port moves to it too, so the text comes from one place. Pi capture keeps its own `withFallback` in `live-model.ts`; the visible text is the same.

### D4. Pi records prompts in the store

Pi calls a new `recordPiPrompt(sessionId, userEntryId, directory, text)` in `src/adapters/pi/` after each settled turn. It mirrors `recordUserPrompt` for OpenCode: skip a fully private prompt, strip `<private>`, `savePrompt`, then `markAsCaptured`. Pi keeps the trivial-prompt and embedding-error checks in its trigger, then calls the pass. The in-memory list goes away.

The session id and entry id are the ones the Pi history reader uses (`unit.userEntryId`), so `savePrompt`'s `(session_id, message_id)` guard stops a second copy at import time.

Alternative: keep Pi's memory list and pass it in as a "prompt source" port. Rejected. Pi would lose the batch at every restart, would not see the claim, and the catch-up run would never see Pi prompts. One prompt source is also simpler.

### D5. Batch claims

Add `user_learning_claimed_at INTEGER` to the column list in `user-prompt-manager.ts` (no new SQL site; the loop already adds columns).

- `getPromptsForUserLearning` gains `claim: true`. Its two `SELECT` statements become `UPDATE … SET user_learning_claimed_at = ? WHERE id IN (SELECT id … AND (user_learning_claimed_at IS NULL OR user_learning_claimed_at < ?) … LIMIT ?) RETURNING *`. libSQL supports `RETURNING`. The site count stays at 2.
- `markMultipleAsUserLearningCaptured` also clears the claim (same statement).
- `markForUserLearning(promptId)` becomes `markForUserLearning(promptIds[])` and clears the claim. It serves as the release. Same site count.
- Claim lifetime: 10 minutes, the same as the catch-up lease and the backoff. The longest pass is 120 s for the model plus three saves.
- `drainProfileBacklog` claims and releases the same way.

The count used for the interval stays `countUnanalyzedForUserLearning` (claimed prompts still count). A pass that finds only claimed prompts returns `skipped`.

Alternative: serialise live and catch-up batches through `CatchUpLease`. Rejected: its `beginBatch` makes the caller the newest owner, which would stop the catch-up run.

### D6. Settings

Four new keys plus two existing ones, all global only (the user said "same for all 3"):

| Row                   | Key                            | Options (first is default) | Type    |
| --------------------- | ------------------------------ | -------------------------- | ------- |
| No user email         | `userProfileWithoutEmail`      | `learn`, `skip`            | string  |
| Fade old items        | `userProfileDecayBeforeMerge`  | `false`, `true`            | boolean |
| Model input           | `userProfilePromptDetail`      | `full`, `prompts-only`     | string  |
| Check older items     | `userProfileValidationEnabled` | `false`, `true`            | boolean |
| Notice when done      | `showUserProfileToasts`        | `true`, `false`            | boolean |
| During a catch-up run | `userProfileDuringCatchUp`     | `learn`, `pause`           | string  |

Fixed rows, shown as text with no dropdown, because no second behaviour exists that the user would want: history entry ("<Host> analysis of N prompts"), host model fails (fall back with a notice), reply check (on), save clash (3 tries, then 10 minutes). The unchecked reply and the missing wait were defects, not options.

Wiring follows `src/core/memorisation-settings.ts`:

- `config.ts` adds one spread (`...profileLearningSettingsFrom(fileConfig)`), one type intersection and one `removeProfileLearningProjectOverrides(projectOverrides, log)` call. Net growth must stay within the 927-line ceiling. If it does not fit, move the two existing keys' parse lines into the new module.
- `settings-editable-keys.ts` `PAGE_KEYS`, `settings-snapshot.ts` `globalOnly`, `global-config-writer.ts` `isValidEdit` and `RESETTABLE_KEYS` (null removes the key).
- `web/src/lib/settings-catalogue-memory.ts` rows with anchor `shared-profile`; Chinese and Arabic pairs in `web/src/lib/i18n/settings-catalogue-memory-rows.ts`.

### D7. The web section

New `web/src/lib/components/memory/ProfileLearningSettingsSection.tsx` inside the existing `shared-profile` row of `SharedView.tsx`, above `ProfileCatchUpSection`. Pure option lists and save edits in `web/src/lib/profile-learning-controls.ts`, as `keyword-mode-controls.ts` does. The section follows `KeywordModeSection`: snapshot read, `onSettingsSnapshot`, one PATCH with the revision, `reloadSettingsSnapshot`, status line. Each dropdown row uses `SettingRow` and `Select`. Rows stack at narrow widths (omms-design "Settings rows"). **Reset to default** opens `SettingsConfirmDialog` and sends `null` for the six keys. `shared-summary.ts` profile line shows "Default settings" or "Custom settings".

### D8. Claude Code notice

- `claude-hook-notices.ts` keeps one pending profile line in memory, with key `claude-code-profile-updated`. The Claude adapter's `notify` sets it. A newer pass replaces it. A restart drops it.
- `retrieveForHook` adds it to `systemMessage` for `session-start` and `user-prompt-submit` when the request has `notices: true`. `confirmShownNotices` clears it on confirmation.
- `hook-client.ts` sends `notices: true` for `user-prompt-submit` too, and writes `systemMessage` for that event. Subagent hooks stay silent.
- Text: `OMMS: User profile updated. Analysed N prompts and updated your profile`.

`claude-hook-api.ts` is at 523 of 525 lines. The call change in `learnClaudeProfile`'s caller must stay within it; the notice code goes in `claude-hook-notices.ts`.

### D9. Test migration

Today the OpenCode tests start `performUserProfileLearning(directory)` in a `Bun.spawn` subprocess with `mock.module` stubs. After this change:

- Behaviour tests call `runProfileLearningPass` with fake prompt and profile stores and a fake `ModelPort`, injected through the input or a `deps` argument. No `mock.module` of `config.js`. Each host-specific old test becomes one shared test with the host as a parameter.
- One OpenCode test goes through V2 `setup` with a fake V2 context (`CLAUDE.md` "Host parity"): an idle event leads to one pass with host `opencode` and the OpenCode model port.
- `tests/profile-workflow-prompt.test.ts` and `tests/profile-category-prompt.test.ts` read `model-input.ts` instead of the adapter source.
- `tests/auto-cleanup-callers.test.ts` expects one caller, `pass.ts`, instead of three.

Assertions that change by the user's decision (each listed again in `tasks.md`):

| Test                                         | Old assertion                         | New assertion                                   |
| -------------------------------------------- | ------------------------------------- | ----------------------------------------------- |
| `opencode-profile-learning-conflict.test.ts` | decay runs on each retry              | no decay by default; decay with the setting on  |
| `user-profile-learning-error.test.ts`        | the pass rethrows the provider error  | the pass returns `failed` with the same reason  |
| `pi-profile-*` and `claude-profile-*`        | no email skips                        | no email learns into `unknown`                  |
| OpenCode notice                              | "Analyzed N of M pending prompts…"    | "Analysed N prompts and updated your profile"   |
| OpenCode history text                        | "+N preferences…"                     | "OpenCode analysis of N prompts"                |
| `user-profile-learning-confidence.test.ts`   | `createUserProfileToolSchema` maximum | the shared schema maximum (tool schema removed) |

## Risks / Trade-offs

Scores are Likelihood × Impact, 1 to 10 each.

- **Double analysis of one batch (L2 × I3 = 6).** A live pass and a catch-up run, or two host processes, take the same waiting prompts. Each item gains evidence twice and one paid call is wasted. → D5 claims. Fixed in this change because the score is 4 or more.
- **Profile under `unknown` (L3 × I2 = 6).** A user with no git email gets a profile named `unknown`, and a later email starts a second profile. → The Profiles card already merges profiles. `docs/using-memory.md` says how. The `skip` option stays available.
- **Pi prompts in `user-prompts.db` (L10 × I1 = 10).** Pi prompt text is now stored on disk, as it already is for OpenCode and Claude Code. → `<private>` removal before the save, fully private prompts never saved, the store stays in the storage path, and `deleteOldPrompts` applies. Document in `docs/pi-adapter.md`.
- **Model input grows for Pi and Claude Code (L8 × I2 = 16).** The full input adds the profile summary and about 3 KB of guidance to each call. Cost per call rises. → The byte cut caps it at `userProfileMaxContextBytes` (32 KB). `prompts-only` is one click away. Fixed by design; no further action.
- **Behaviour change for OpenCode users (L9 × I2 = 18).** Decay stops by default. Old items no longer fade at learning time. → The daily auto cleanup and the stale rules still remove weak items. Decay stays one setting away. Record the change in the ADR and the release notes.
- **Claude Code line shows in another session (L4 × I1 = 4).** The pending line goes to the next hook from any Claude Code session. → Accepted; the text names no session.
- **`config.ts` ceiling (L5 × I1 = 5).** The wiring may push the file past 927 lines. → D6 keeps parsing in the new module.

## Migration Plan

1. No data migration. The new column is added on first open, as other `user_prompts` columns are. Old rows have `NULL` claims.
2. Existing global configs keep working. Missing keys use the defaults. A project config value for a now global-only key is ignored with a log line.
3. Rollback: revert the `feat:` commits. The extra column is harmless to older code. Pi prompts already stored stay as waiting or learned prompts, and OpenCode or Claude Code passes learn them.

## Docs

Update in the same change:

- `docs/using-memory.md`: "How profile learning behaves", the six settings, the log lines.
- `docs/configuration.md`: the four new keys, and the two keys that become global only.
- `docs/web-ui-memory.md`: the Profile learning table and **Reset to default**.
- `docs/pi-adapter.md`: remove the "not ported" limitation (line 262), add prompt recording.
- `docs/opencode-adapter.md` and `docs/claude-code-adapter.md`: the shared pass, the fallback notice, the Claude Code notice line.
- `docs/shared-core.md`: the new `src/core/profile-learning/` folder and its ports.
- New ADR `docs/adr/052-one-profile-learning-pass-for-every-host.md`, added to `docs/adr/ADR_README.md`.

## Open Questions

None that change the specs or tasks. The decisions the user should confirm are in the report that came with this proposal.
