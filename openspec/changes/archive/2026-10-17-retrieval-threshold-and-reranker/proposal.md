# Proposal

## Why

The default `similarityThreshold` of 0.6 hides relevant memories. In Experiments 24, 25 and 26 (60 prompts, then 60 fresh prompts), 21 to 22 of every 60 prompts got no memory at 0.6. A threshold of 0.50 lifted recall@10 from 0.36 to 0.60 on the first set and from 0.54 to 0.88 on the fresh set, at a cost of 1.2 to 1.9 more irrelevant memories per prompt. The setting has no recorded justification and no place in the web UI.

Experiment 24 also tested a reranker. It added little over a lower threshold (0.02 recall on one answer key, 0.10 on the other, neither significant) and took 2.5 seconds per prompt. Some users may still want it, so it should be a switch they choose, off by default.

## What Changes

- Make the default `similarityThreshold` follow the active embedder: 0.5 for `qwen3-embedding:0.6b`, the only embedder measured, and 0.6 for every other embedder, including the built-in one. A value saved in the file always wins.
- Stop the config template from writing a `similarityThreshold` line, so new files follow the embedder default.
- Add `similarityThreshold` as a sixth editable row in the Memory limits card, with validation (a number from 0 to 1) in the file, the settings writer and the page. The row shows the default for the current embedder.
- Add a **Reset to default** action to every Memory limits row. It removes the key from the file, so the value follows the default again. The card shows when a saved value differs from the default.
- Add an opt-in reranker. When on, the memory search takes the 50 best memories by score, asks a user-supplied reranker server to order them, and keeps the top `maxMemories`. When off, nothing changes.
- Add five settings for it: `rerankerEnabled` (default false), `rerankerApiUrl`, `rerankerModel`, `rerankerApiKey` (an `env://` or `file://` reference, optional) and `rerankerTimeoutMs` (default 2000, from 500 to 30000).
- Add a **Reranker** card to the Memory page with the switch, the connection fields, the timeout and a **Test** button.
- If the reranker is off, unreachable, slow (over the timeout), or returns a bad reply, the search falls back to the normal threshold result and logs only an error code.
- The reranker runs in the shared search, so OpenCode, Pi and Claude Code get it together.
- Document the new default, the new settings, how to run a reranker server, and that the evidence comes from one embedding model.

Nothing is **BREAKING**. A file that sets `similarityThreshold`, including every file made from the old template with its `0.6` line, keeps its value. A file without the key gets 0.5 with `qwen3-embedding:0.6b` and 0.6 with any other embedder, which is the old behaviour for those users. Anyone with the old `0.6` line can select **Reset to default** in the card.

## Capabilities

### New Capabilities

- `memory-reranker`: the opt-in reranker stage in memory search, its settings, its fall-back rules and its privacy limits.

### Modified Capabilities

- `memory-context-controls`: the embedder-dependent default and the accepted range of `similarityThreshold` join the configurable memory limits.
- `web-settings`: the Memory limits card gains the `similarityThreshold` row and a Reset to default action on every row, and the Memory page gains the Reranker card.

## Impact

- **Code**: `src/config.ts` (default, keys), `src/utils/memory-limits.ts` (a rule that allows decimals), a new `src/utils/threshold-default.ts` (the embedder default table), `src/services/global-config-writer.ts`, `src/services/settings-snapshot.ts`, `src/services/client.ts` (search path), a new reranker client module, `web/src/lib/memory-controls.ts`, a new Settings card, the translation files and `src/services/request-timeouts.ts`.
- **Size ceiling**: `src/config.ts` is at its 500-line ceiling in `tests/file-size-ceiling.test.ts` (1,207 lines now) and cannot grow. The config template moves to its own module first.
- **APIs**: new Settings routes for the Reranker card and its test. One outgoing call to a user-chosen URL per search when the switch is on.
- **Privacy**: with the switch on, the prompt and the 50 candidate memories go to the reranker URL. The documentation says so and recommends a server on the same machine.
- **Docs**: `docs/configuration.md`, `docs/web-ui-settings.md`, `docs/web-ui-memory.md`, one ADR for the opt-in reranker.
- **Evidence limits**: `experiments/24`, `25` and `26` used `qwen3-embedding:0.6b`, one project and AI-made answer keys. Only that embedder gets 0.5. Other embedders keep 0.6 until someone measures them and adds a line to the default table.
