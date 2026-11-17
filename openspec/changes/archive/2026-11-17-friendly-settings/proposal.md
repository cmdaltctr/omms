# Proposal

## Why

The settings work for someone who reads the docs, but they are hard on an ordinary user. The worst case: automatic memory cleanup is on by default. Once a day it deletes every unpinned memory not updated in 30 days, in every project, and no screen or guide says so. It also runs only on OpenCode, so the same setting acts differently per host.

Other problems from the settings audit, each checked in the code:

- The switches people look for first (capture, recall, visible recall, profile injection, default memory scope) can only be set in the config file.
- A typo in the config file makes the hosts fall back to defaults with only a log line, and the Settings page says "Config file cannot be parsed" with no line number. A value out of range stops OMMS from loading at all.
- Rows show raw config keys, raw provider ids and raw error codes such as `reranker_unreachable`.
- An API key is entered three different ways. The reranker accepts only a typed `env://` or `file://` reference.
- Each card saves differently. The External API **Test** checks the saved values, not the form. A URL or model cannot be cleared. `memoryApiUrl` accepts any text. Retry retention 0 deletes waiting turns with no confirmation.
- Settings live on five pages with no way to search them.
- Some messages and docs name only two hosts, and some docs are out of date.

## What Changes

- **New deletion switch, old one retired (BREAKING for users who relied on automatic deletion):** a new global-only key `autoDeleteOldMemories`, default `false`, is the only setting that lets OMMS delete memories by age automatically. `autoCleanupEnabled` no longer deletes anything. A file that still sets it, `true` or `false`, loads with no error. OpenCode users whose memories were deleted automatically keep every memory from now on, until they turn deletion on again on the Memory cleanup card. Nothing is lost by this. OMMS does not rewrite the user's file. `autoCleanupRetentionDays` keeps its meaning.
- After the update, no memory is deleted by age on any host unless the user turns deletion on after this change. A config file written by an older version never causes deletion.
- When deletion is on, it runs the same way on OpenCode, Pi and Claude Code (through the web app): at most once a day per OMMS process.
- The daily housekeeping that is not memory deletion (capture attempt records, the capture retry queue, cleanup undo records, database compaction) runs every day on all three hosts, whatever either key says. Today it runs only when cleanup is on, and only on OpenCode.
- A new **Memory cleanup** card on the Settings page shows the switch and the number of days, with a plain warning. Turning it on opens a confirmation that states how many memories it would delete now. When the file still has `autoCleanupEnabled: true` and no new key, the card shows one note: the old setting no longer deletes anything, and this switch turns deletion on.
- The template written on first run sets neither cleanup key. It shows `autoDeleteOldMemories` commented out under a warning.
- The manual **Cleanup** button on the memory list does not change. It keeps its own confirm and deletes memories older than `autoCleanupRetentionDays` when the user presses it.
- A new **Memory basics** card on the Settings page holds capture on or off, recall on or off, visible recall, profile injection and the default memory scope.
- A broken config file is reported in plain words. The Settings page shows a banner with the file, line, column and what is wrong. OpenCode and Pi show a notice at start, and Claude Code shows a message at session start. A value out of range names the key and the allowed range, and OMMS uses that key's default instead of failing to load.
- Every settings row shows a plain name, a one-line description, the default and what it affects. The config key stays as small secondary text. Reranker error codes become sentences. Provider ids get display names.
- One shared key-entry control (environment variable, key file, or paste to a private file) with the shell-variable warning, used by the External API, Embedding and Reranker cards. The reranker gains the paste choice.
- One save pattern for every card: edit, **Test** the values in the form, **Save**, plain result message. URL and model fields can be cleared. `memoryApiUrl` must start with `http://` or `https://`. Saving retry retention 0 asks for confirmation first.
- A search box on the Settings page finds any setting the web UI can change, on any page, and links to it. Pages do not move.
- Messages and docs name all three hosts. Doc drift is fixed.
- **Removed keys:** `maxProfileItems`, `userProfileDisplayPreferences`, `userProfileDisplayPatterns` and `userProfileDisplayWorkflows`. Nothing reads them. An old config file that still has them loads with no error.
- Settings cards follow the web UI rules: shared buttons, no emoji padlock, a confirm dialog instead of `window.confirm`.

## Capabilities

### New Capabilities

- `memory-cleanup`: automatic deletion of old memories: its default, when it runs on each host, the housekeeping that runs regardless, and the count shown before it is turned on.
- `config-problems`: how OMMS reports a config file it cannot read or a value it cannot accept, on every host and on the Settings page, and how it treats removed keys.

### Modified Capabilities

- `web-settings`: new Memory basics and Memory cleanup cards, the settings search, plain setting rows, the shared key-entry control, the shared save pattern, a confirmation before a save that deletes data, the UI rules, and changed External API, Embedding, Memory limits, Reranker and safe-save requirements.

## Impact

- Server: `src/config.ts`, `src/config-template.ts`, `src/utils/memory-limits.ts`, `src/services/cleanup-service.ts`, `src/services/global-config-writer.ts`, `src/services/settings-snapshot.ts`, `src/services/memory-key-source.ts`, `src/services/reranker-test.ts`, `src/services/web-server.ts` (lines move out, it must not grow), `src/services/web-route-modules.ts`, and new `src/services/config-problems.ts` and `src/services/settings-routes.ts`.
- Hosts: `src/v2/session-events.ts`, `src/v2/startup.ts`, `src/adapters/pi/extension.ts`, `src/adapters/claude-code/hook-client.ts`.
- Web: the Settings page, its cards and the shared Memory page cards (Memory limits, Keyword matching, Reranker, Memory injection, profile cleanup), with new shared components and a settings catalogue. New text in English, Chinese and Arabic.
- Docs: `docs/configuration.md`, `docs/web-ui-settings.md`, `docs/web-ui-memory.md`, `docs/upgrading.md`, the three host guides, ADR 051 (ADR 050 and TDR 081 belong to `modular-boundaries`).
- Claude Code session-start notices use the contract shared with `seamless-setup`: the hook sends `"notices": true`, the web app may reply with a `systemMessage` string, and the hook copies it to `systemMessage` in its stdout JSON.
- Size: about 90 files. Under the 100-file limit, so no follow-up change is needed for the brief's items. Not in this change, and left to their owners: the import page and host model pickers (`simpler-import`), the welcome panel, `setup` and `doctor` (`seamless-setup`), host-name type lists (`modular-boundaries`).

## Known small issues

Both scored 3 or below, so the code stays as it is.

- **A pasted key file can outlive a failed save.** The key route writes the key file before the config save. A config file that cannot be parsed, or a revision conflict, leaves the file behind, and the next try asks to replace it (`settings-routes.ts`, `embedding-change.ts`). Likelihood 3, Impact 1. Trigger: paste a key while the config file has a syntax error or another tab has just saved.
- **Two deletions at the same moment lower the shard count twice.** Two processes that delete the same memory at the same moment each lower the shard's vector count (`shard-manager.ts`). Likelihood 2, Impact 1. Trigger: OpenCode idle and the web app daily check run deletion in the same second with deletion on.

## Follow-up changes

- **Manual Cleanup button count** (about 4 files): the **Cleanup** button on the memory list deletes old memories with a generic `confirm()`. It should show the count from the same preview and use the confirm dialog.
- **Shared switch on the Memory page** (about 4 files): the Reranker, Memory injection and profile tidy cards keep a native switch, because the Shared view specs mock React context away and the shared Checkbox needs it. Move them to the shared control and rewrite those specs together.
- **Document the file-only settings** (about 3 files): 22 keys have no doc entry. Mark them as advanced in the template and the configuration guide.
- **Raw buttons on import and directory-map components** (about 6 files): `ImportSourcePicker`, `ImportSection`, `ImportOptions`, `HostSessionSelection`, `DirectoryMapsSection` and `ProfileCatchUpSection` still use raw `<button>`. They belong to the import flow (`simpler-import`).
