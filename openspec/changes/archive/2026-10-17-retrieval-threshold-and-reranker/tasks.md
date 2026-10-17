# Tasks

Work in the `omms-feat-retrieval-threshold-reranker` worktree. Install first: `bun install --frozen-lockfile` and `(cd web && bun install --frozen-lockfile)`. For every behaviour task, write the test first, watch it fail, then make it pass. Run one test file with `bash scripts/run-tests-isolated.sh tests/<file>.test.ts`.

## 1. Make room in `src/config.ts`

- [x] 1.1 Move `CONFIG_TEMPLATE` to `src/config-template.ts` and import it where it is used (`src/config.ts`, `src/services/global-config-writer.ts`). Keep the text identical.
- [x] 1.2 Lower the `src/config.ts` entry in `tests/file-size-ceiling.test.ts` to the new line count, and add a ceiling entry only if the new file passes 500 lines.
- [x] 1.3 Run `bun run check` and the config and global-config-writer tests. Nothing else changes in this group.

## 2. Threshold default, range and reset

- [x] 2.1 Write failing tests for `defaultSimilarityThreshold`: `qwen3-embedding:0.6b` and its listed aliases give 0.5, any case; `Xenova/nomic-embed-text-v1`, an empty name and an unknown name give 0.6.
- [x] 2.2 Add `src/utils/threshold-default.ts` as a pure module that never imports `CONFIG`.
- [x] 2.3 Write failing tests: a file without the key uses the embedder default; a file with `0.6` keeps 0.6 on every embedder; 0.45 is accepted; -0.1, 1.1, `null` and a string are refused with the setting name; the template has no active `similarityThreshold` line.
- [x] 2.4 Add the `similarityThreshold` rule (decimal, 0 to 1 inclusive, computed default) to `src/utils/memory-limits.ts`. Wire it through `getMemoryLimitRule` so `global-config-writer.ts` and `settings-snapshot.ts` accept it. Make `src/config.ts` use `fileValue ?? defaultSimilarityThreshold(embeddingModel)` with the new rule for validation, keeping its project-override behaviour.
- [x] 2.5 Make the settings snapshot return the embedder-aware default for the threshold row. Replace the template line with a comment.
- [x] 2.6 Write failing tests for reset: a request with `null` for a memory-limit key removes that key; for `chatMessage.maxMemories` only the leaf goes and the other `chatMessage` properties and comments stay; an absent key is a no-op; a conflict is refused without writing; a project file is untouched. Then let the writer and its validation accept `null` for the six limit keys only.
- [x] 2.7 Add a `kind` field (`integer` or `decimal`) to `MEMORY_CONTROLS` in `web/src/lib/memory-controls.ts`, a sixth row for `similarityThreshold`, and make `parseMemoryValue` accept decimals only for decimal rows. The Default column reads the default from the snapshot, not from a constant. Update `MEMORY_SETTINGS_MESSAGES`.
- [x] 2.8 Update the Memory card component and its spec: six rows, the decimal input, the threshold validation message, a **Reset to default** button per row (disabled when the key is absent), and the **Differs from default** marker. Add the translations and keep the parity test green.
- [x] 2.9 Add regression tests: integer rows still refuse 2.5; the threshold row accepts 0.45; switching the embedder in the snapshot changes the threshold row's default.

## 3. Reranker client

- [x] 3.1 Write failing tests for `src/services/reranker.ts` using a fake `fetch`: request shape (`POST <url>/rerank`, `model`, `query`, `documents`, `top_n`, bearer key), documents cut at 4,000 characters, ordering by score with id tie-break, timeout taken from the argument (test 2000 and 6000), HTTP error, short reply, duplicate index, out-of-range index, `NaN` score, and key redaction in errors.
- [x] 3.2 Implement `rerankDocuments` and `rerankSettingsFrom` as pure functions that never import `CONFIG`. Resolve `env://` and `file://` keys with `src/services/secret-resolver.ts`.
- [x] 3.3 Add `RERANKER_TIMEOUT_DEFAULT_MS = 2_000`, `RERANKER_TIMEOUT_MIN_MS = 500`, `RERANKER_TIMEOUT_MAX_MS = 30_000` and `RERANKER_POOL_SIZE = 50` to `src/services/request-timeouts.ts`.
- [x] 3.4 Confirm each test fails when the code under test is broken: remove the duplicate-index check, the timeout and the key redaction one at a time, and see a test fail each time.

## 4. Search wiring

- [x] 4.1 Write failing tests: reranker off gives byte-identical results to today; reranker on lifts a candidate below the threshold; a failing reranker returns the threshold result; `maxMemories` of 6 returns 6; a metadata-only log record with a code is written and holds no query or memory text.
- [x] 4.2 Add `src/services/retrieval-rerank.ts` as designed (decision 7). Change `memoryClient.searchMemories` to use it only when the reranker is on. Snapshot the settings, including the timeout, at the start of the search, as `maxMemories` is.
- [x] 4.3 Add one test for each host path that prompt retrieval uses the reranker: `buildRetrievalSection` (Pi and OpenCode V2) and the Claude Code hook retrieval. Add one test that the manual `memory` search uses it and the recent-memory list does not.
- [x] 4.4 Check `src/services/turso/vector-search.ts` is unchanged and still passes the file-size test.

## 5. Reranker settings

- [x] 5.1 Write failing tests for validation: `rerankerEnabled` boolean; `rerankerApiUrl` http(s) only; `rerankerModel` non-empty; `rerankerApiKey` secret reference only; `rerankerTimeoutMs` an integer from 500 to 30000, refusing 499, 30001, 2000.5, `null` and a string; enabling with no URL or model is treated as off; error messages hold no value.
- [x] 5.2 Add the five keys to the config types, the file reader, the writer's editable list and `isValidEdit`. Put them in `globalOnly` in `src/services/settings-snapshot.ts` and ignore them in project files.
- [x] 5.3 Add a test that a project file with `rerankerApiUrl` or `rerankerTimeoutMs` is ignored and the global value stays in force.

## 6. Reranker card

- [x] 6.1 Add a Settings route to test a candidate reranker (two fixed sample documents, success or failure code only, using the drafted timeout) beside the embedding test route, with the same authentication and origin rules. Add route tests.
- [x] 6.2 Add the **Reranker** card to the Memory page: switch, URL, model, key, timeout, Test, Save, Cancel, the privacy text, the remote-host notice, and a note beside the timeout that a value over 5000 may make OpenCode V2 send the request with no memory. Save through the existing safe global save and refresh the shared revision.
- [x] 6.3 Add component tests for the scenarios in the web-settings delta: default state, switch on with a blank URL, plain-text key, timeout out of range, remote notice, test success and failure.
- [x] 6.4 Add the translations for every language in `web/src/lib/i18n` and keep the translation parity test green. Check the narrow Arabic layout in a browser at phone width.

## 7. Documents

- [x] 7.1 Update `docs/configuration.md` (the embedder-dependent default, the five reranker keys, the endpoint contract, an example `llama-server --reranking` command for Qwen3-Reranker-0.6B), `docs/web-ui-settings.md`, `docs/web-ui-memory.md` (Reset to default, the marker) and `docs/using-memory.md` if it names the threshold. Grep `docs/` and `README.md` for `0.6` and fix every hit that names the threshold.
- [x] 7.2 State in the docs that 0.5 comes from tests with `qwen3-embedding:0.6b` only, that other embedders keep 0.6, and that an existing file with `0.6` is not changed and can be reset in the card.
- [x] 7.3 Add `docs/adr/031-opt-in-memory-reranker.md` and its entry in the ADR index. Link the Experiment 24 to 26 reports.
- [x] 7.4 Update the `experiments/` reports only if a number in them changed. Do not edit their results. (No number changed; no edit needed.)

## 8. Verify

- [x] 8.1 Run `bun run ci:local` and report the command and its result.
- [x] 8.2 Run `openspec validate retrieval-threshold-and-reranker --strict` and the `openspec-verify-change` skill.
- [x] 8.3 Start a local reranker server (Qwen3-Reranker-0.6B, `llama-server --reranking`) and run one real search on this machine with the switch on and off, at the default timeout and at 6000. Record the elapsed time and whether each timeout held.
  - Server: llama.cpp b11510 `llama-server --reranking`, `qwen3-reranker-0.6b-q8_0.gguf`, 127.0.0.1:8791. Call: `rerankedSearch` with the real HTTP rerank call; the vector read was stubbed with a 50-memory pool (about 400 characters each), `maxMemories` 10. Three runs per case.
  - Off: 0 ms added, order unchanged.
  - On, default 2000 ms: 846 to 983 ms, reranked every run. Timeout held.
  - On, 6000 ms: 845 to 852 ms, reranked every run. Timeout held.
  - On, 500 ms (minimum): 502 to 503 ms, fell back every run (server needs about 850 ms for 50 documents). Timeout fired as designed and search still returned results.
  - The reranked top result was the memory about the query topic in every reranked run.
  - Real CLI search (`memory search`, scratch HOME with a clone of the real store, same server, 50 real candidates, `maxMemories` 10): off 653 ms; on at the default 2000 ms 2244 and 2375 ms (reranked, order changed); on at 6000 ms 2371 and 2368 ms (reranked). The rerank call took about 1.6 s. The first default-timeout run after the server started hit `reranker_timeout` at 2003 ms and fell back to the threshold result; every later run held. The default has little headroom on this machine with real memory text, so 6000 is the safer value for a cold server.
- [x] 8.4 Open the Memory page in a browser, reset the threshold on a test config, and confirm the marker and the default follow the embedder.
- [x] 8.5 Run `graphify update .` after the code changes.
- [x] 8.6 Archive the change with `openspec-archive-change` before the pull request. Do not commit or push until the maintainer asks.
