# Proposal: unify profile learning

## Why

Profile learning (learning the user profile from recent prompts) runs three different loops today. OpenCode has its own 824-line loop in `src/adapters/opencode/profile-learning.ts`. Pi (`src/adapters/pi/profile.ts`) and Claude Code (`src/importer/claude-profile-learning.ts`) share `analyzeProfile`, but each has its own trigger, email rule, history text and notice. The same prompts give a different profile on each host. This breaks the host parity rule in `CLAUDE.md`, and the user cannot see or change the differences.

The modularity inventory (`openspec/changes/modularity-follow-ups/design.md`, "Task 2.1 inventory") lists 16 steps where the loops differ. The user has chosen one behaviour for each step. This change puts one loop in the shared core, uses it on all three hosts, and lets the user change the behaviours that have real alternatives on the Memory page.

## What Changes

- **One loop for all hosts.** A new shared loop in `src/core/profile-learning/` runs every live pass: skip trivial prompts, take a batch, build the model input, call the model, check the reply, merge, save with retries, mark the prompts, start the automatic cleanup, and send the notice. Adapters keep only the host model port, the per-turn trigger and the notice display.
- **Pi records its prompts.** Pi saves each settled user prompt in the prompt store, as OpenCode and Claude Code do, after `<private>` removal. Pi no longer keeps its batch in memory. A later Pi history import does not record the same prompt again.
- **Defaults change on some hosts.** The defaults below apply to every host.
  - No user email: learn anyway, under the id `unknown`. Pi and Claude Code skipped before.
  - No decay of old profile items before the merge. OpenCode decayed before.
  - The model gets OpenCode's full input: the prompts, a summary of the current profile, guidelines and examples, cut to `userProfileMaxContextBytes`. Pi and Claude Code sent numbered prompts only.
  - The check of older items (validation step) is available on every host and stays off (`userProfileValidationEnabled`). Only OpenCode had it.
  - History entry text is "<Host> analysis of N prompts" for every host, from the host registry label. OpenCode wrote "+N preferences…" before.
  - The same notice text on every host when learning ends. Claude Code shows it on the next prompt.
  - A failed host model falls back to the external API and shows a short notice, on OpenCode and Pi alike. OpenCode fell back without a notice.
  - Every external API reply is checked against the profile schema. OpenCode's external path did not check the reply.
  - A save clash retries 3 times, then waits 10 minutes, on every host. Pi did not wait.
  - Live learning continues while a profile catch-up run is active. Claude Code paused before. A claim on each batch stops two runs from taking the same prompts.
- **New Memory page controls.** The Profile learning row on `/memory/shared` gets a settings table with one row per behaviour. Six rows have a dropdown. Four rows are fixed and show their value as text. A **Reset to default** button restores the defaults. The settings are global only, saved through the existing settings API.
- **New config keys** (global only): `userProfileWithoutEmail` (`learn` or `skip`), `userProfileDecayBeforeMerge` (boolean), `userProfilePromptDetail` (`full` or `prompts-only`), `userProfileDuringCatchUp` (`learn` or `pause`). The existing `userProfileValidationEnabled` and `showUserProfileToasts` become global only and page-writable.
- **Removed:** OpenCode's own loop, its unchecked external tool call, and its unused learning-paths code (`buildLearningPaths`).
- **BREAKING (behaviour):** a project config can no longer set `userProfileValidationEnabled` or `showUserProfileToasts`. The value is ignored with a log line, as for other global-only keys.

This change replaces part 3 of `modularity-follow-ups` (tasks 2.2 to 2.4). That change's tasks stay unticked until this change merges.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `profile-learning`: one shared loop on every host, the new defaults, the four new settings, batch claims, and the same history text and notice. The save-conflict rule gains the 10-minute wait on every host.
- `web-memory-hosts`: the Shared view's Profile learning row holds the settings table and the reset.
- `claude-code-adapter`: the prompt hook can show the profile notice line, and the web app adds it only for hooks that ask.
- `pi-agent-adapter`: Pi records settled prompts in the prompt store for profile learning.

## Impact

- **Code:** new `src/core/profile-learning/` (loop, model input, validation, settings). Changed `src/core/profile-analysis.ts`, `src/services/user-prompt/user-prompt-manager.ts` (claims), `src/adapters/opencode/` (new model port, trigger), `src/adapters/pi/` (prompt record, trigger), `src/importer/claude-profile-learning.ts`, `src/importer/claude-hook-notices.ts`, `src/adapters/claude-code/hook-client.ts`, `src/config.ts`, `src/services/settings-editable-keys.ts`, `src/services/settings-snapshot.ts`, `src/services/global-config-writer.ts`. Removed most of `src/adapters/opencode/profile-learning.ts`.
- **Web:** new `ProfileLearningSettingsSection` in `web/src/lib/components/memory/`, catalogue rows, and Chinese and Arabic pairs.
- **Data:** one new nullable column, `user_learning_claimed_at`, in `user_prompts`. Pi prompts now enter `user-prompts.db`. No profile data changes shape.
- **Tests:** OpenCode learning tests move from `Bun.spawn` subprocess runs with `mock.module` to shared loop tests with injected stores and models, plus one V2 `setup` test. Assertions that change by the user's decision are listed in `tasks.md`.
- **Docs:** `docs/using-memory.md`, `docs/configuration.md`, `docs/web-ui-memory.md`, `docs/pi-adapter.md`, `docs/opencode-adapter.md`, `docs/claude-code-adapter.md`, `docs/shared-core.md`, and a new ADR.
- **Release:** `feat:` commits, so release-please makes a minor release.
