# Proposal

## Why

OMMS limits memory counts and background input sizes, but users cannot see or change those controls in Settings. Automatic memory injection has no shared size budget, so a few long memories can fill much of the agent's context.

## What Changes

- Add a **Memory** card to Settings and a **Memory** child in the Settings sidebar tree, using the integrated heading hierarchy and preserving host-specific Directory maps navigation.
- Show an editable table with **Setting**, **Value**, **Default**, **Unit**, and **Affects** columns. Keep each effect visible beside its control.
- Expose the four existing settings without changing their defaults:

  | Setting                      | Default       | Affects                                                                                                                    |
  | ---------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
  | `maxMemories`                | 10            | Maximum memory search results; a manual search can request fewer.                                                          |
  | `chatMessage.maxMemories`    | 3             | Recent memories added at session start in OpenCode V1 and Claude Code. Pi and OpenCode V2 use prompt-based search instead. |
  | `autoCaptureMaxContextBytes` | 131,072 bytes | Conversation input sent to the memory-summary model through the shared capture pipeline.                                   |
  | `userProfileMaxContextBytes` | 32,768 bytes  | OpenCode profile-learning input. This setting does not currently limit the other hosts' profile input.                     |

- Add `retrievalMaxTokens`, default **2,000 approximate tokens**, to bound automatic memory context, including profile text, formatting, and retrieval wrappers. Cover prompt retrieval, recent-memory injection, and session-memory restoration after compaction where each host supports them.
- Use one documented, host-neutral token estimate. State that the setting does not impose an exact provider token limit or a spending limit.
- Support all five settings in `~/.config/omms/omms.jsonc` without using the web UI. Retain project overrides through `<project>/.opencode/omms.jsonc`.
- Preserve safe Settings saves, including nested writes to `chatMessage.maxMemories`, comments, sibling keys, validation, and stale-file rejection.
- Correct OpenCode's profile input limiter to count UTF-8 bytes rather than JavaScript characters, including its truncation marker within the limit.
- Document effects, host coverage, units, defaults, valid values, and when changes take effect.

## Capabilities

### New Capabilities

- `memory-context-controls`: Validated file configuration for memory limits, a shared approximate budget for automatic memory injection, and accurate byte limits for OpenCode profile input.

### Modified Capabilities

- `web-settings`: Add the Memory card, its editable effects table, nested config saves, and sidebar navigation.

## Impact

- Config: `src/config.ts`, its generated template, and a small pure validation helper if needed.
- Settings backend: `src/services/settings-snapshot.ts`, `src/services/global-config-writer.ts`, and the existing `/api/settings` routes.
- Shared formatting: `src/services/context.ts`, `src/core/retrieval.ts`, and a pure budget helper using the existing UTF-8 utilities.
- Hosts: existing injection paths in `src/index.ts`, `src/v2/memory-bridge.ts`, `src/adapters/pi/extension.ts`, and `src/importer/claude-hook-api.ts`. Keep the Claude Code hook's existing added-context safety limit.
- Profile input: the existing limiter in `src/adapters/opencode/profile-learning.ts`; retain current host coverage.
- UI: a new Memory section component, `SETTINGS_SECTIONS`, Settings composition, translations, and existing table styles. Build on `features-fixes` at `1997c05`, which includes the archived directory-map controls and status-navigation/heading changes plus the release-approval cache fix. Reuse the integrated typography roles and preserve the existing host links and disclosure state.
- Guides: `docs/configuration.md` and `docs/web-ui-settings.md`.
- Tests: config, save API, formatting, Unicode limits, host integration, sidebar navigation, and localisation.
- No new dependency, store migration, re-embedding, Graphify integration, manual-search truncation, provider output cap, or spending cap.

This change is a proposal only. Implementation requires approval in a later turn.
