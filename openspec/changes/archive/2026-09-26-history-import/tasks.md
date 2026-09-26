# Tasks

## 1. Capture fix (prerequisite)

- [x] 1.1 In `src/core/extraction.ts`, default `summary`/`tags` to `""`/`[]` and refine so a non-skip reply needs a non-empty `summary`; verify with new `tests/core-extraction.test.ts` cases: bare `{"type":"skip"}` → skip; `{"type":"feature"}` without a summary → null; fenced and embedded JSON still parse
- [x] 1.2 Log `{provider, modelId, reply: first 500 chars}` when `parseCaptureSummary` fails in `src/adapters/pi/provider.ts` and the OpenCode fallback path; verify with a test that asserts the logged reply is truncated to 500 characters and that the API key never appears

## 2. Shared importer core

- [x] 2.1 Rename `PiImportLedger` → `ImportLedger` (keep the `PiImportLedger` export alias) and accept any `<host>:` key prefix; verify that `tests/pi-import-ledger.test.ts` passes unchanged and that a new test round-trips an `opencode:` key
- [x] 2.2 Generalise `src/importer/importer.ts` to a host-agnostic core that takes a source iterable `{sessionId, directory, units}` and a host label; re-express `importPiHistory` on top of it; verify that `tests/pi-importer.test.ts` and `tests/pi-import-command.test.ts` pass unchanged
- [x] 2.3 Move the profile analyser to `src/core/profile-analysis.ts` over a `ModelPort`; make `performPiProfileLearning` delegate to it; verify that `tests/pi-profile.test.ts` passes unchanged and that the boundary tests still pass (core does not import adapters)
- [x] 2.4 Add the shared profile step `importProfileFromHistory` in `src/importer/profile-import.ts`: record prompts during the pass (marked captured for auto-capture, unanalysed for learning, deduplicated by `<key>#profile` ledger rows), then build in batches until none remain; verify with tests for first profile creation, update of an existing profile, rerun without duplicates, a batch failure stopping with the remaining count, and dry-run writing nothing

## 3. OpenCode reader and project resolution

- [x] 3.1 Add `src/importer/opencode-reader.ts`:
  - `node:sqlite`, `file:…?immutable=1`, read-only
  - a schema check that stops with a clear message
  - top-level sessions only, with child sessions counted
  - unit windows from user and assistant messages; excludes reasoning/step/patch/file/compaction parts and synthetic user parts; truncates tool input

  Verify with a small fixture DB built in the test (V1 tables): the expected windows and exclusions, and child sessions never producing units

- [x] 3.2 Add project resolution in the order directory → `--map` → `project.worktree` (not `/`) → unresolved; verify with fixture tests covering a deleted worktree resolving to its repository, a map override, a root worktree being ignored, and unresolved sessions being listed with counts
- [x] 3.3 Verify immutability: a test copies a fixture DB with WAL, runs a full import, and checks that the DB, `-wal` and `-shm` files are unchanged (checksums) and no new `-shm` file was created

## 4. OpenCode import command

- [x] 4.1 Add `importOpencodeHistory` (reader + core + profile step, provenance `host=opencode`, `sourceType=history-import`, keys `opencode:<session>:<userMsg>:<lastAssistantMsg>`); verify with tests for imported/skipped/failed units, crash reconciliation through the stored `importId`, and filters (`--since/--until/--session/--project/--max-sessions`) applied before any model call
- [x] 4.2 Add model selection for the CLI:
  - flags merged over the `memory*` config
  - key via `--api-key-env`/secret resolver, never printed
  - a real run validates settings up front

  Verify with tests for the flag override, a missing model stopping before processing, the saved config staying unchanged, and the key being absent from all output

- [x] 4.3 Add `src/cli/index.ts` with `import-opencode-history` (`parseArgs`; flags `--dry-run --db --map --since --until --session --project --max-sessions --skip-memories --skip-profile --profile-batch --provider --model --api-url --api-key-env --force`), a per-project summary, and non-zero exit on fatal errors. Add `"bin": {"om-memory-system": "dist/cli/index.js"}` and ensure the built file keeps its shebang and is executable. Verify with a CLI test in dry-run against a fixture DB (exact counts, nothing written), plus `--help` output

## 5. Pi importer parity

- [x] 5.1 Add the profile steps to `/memory-import-pi-history` (on by default, `--skip-profile`, counts in the dry-run report); verify with an extension of `tests/pi-import-command.test.ts` covering prompts recorded, profile created, and dry-run writing nothing
- [x] 5.2 Add `--model <provider/id>` to the Pi command via `ctx.modelRegistry.find`, stopping with "model not found" if absent; verify with tests for the override used for all calls and the active model unchanged

## 6. Docs

- [x] 6.1 Write `docs/opencode-history-import.md`: quick start (dry-run first), flags, how projects resolve, cost, a cheaper-model example, the old-script mapping (3 scripts → 3 steps), rerun/recovery, undo; verify with `bun run format:check`
- [x] 6.2 Update the README (a short "Import past history" section linking both importers) and `docs/pi-history-import.md` (profile steps, `--model`); verify with `bun run format:check`

## 7. Decision records (local only, not committed)

- [x] 7.1 Write ADR-002 "Replace the backfill scripts with a built-in 3-in-1 history importer" in `docs/adr/002-built-in-history-importer.md` using the s-adr template (Status: Proposed). Cover: a terminal CLI for OpenCode and a Pi slash command over one shared core, profile analysis moved into core, a separate model option, and the old scripts superseded. Add a row to `docs/adr/ADR_README.md`; verify both files exist and the index row links correctly
- [x] 7.2 Write ADR-003 "Publish on npm as om-memory-system with a fixed plugin id" in `docs/adr/003-npm-name-om-memory-system.md` (Status: **Accepted**, since it is already implemented). Cover:
  - npm's typosquat rejection of `omms` (similar to `ms`/`os`)
  - options weighed: `@cmdaltctr/omms`, `omms-memory`, `opencode-omms`, an npm support appeal
  - why an unscoped name was chosen
  - the plugin id pinned to `omms` (OpenCode only needs a non-empty id, and it scopes plugin storage and disable rules by it)
  - that the product, config and data folders stay `omms`
  - references: PR #11, `src/plugin.ts`, OpenCode `readPluginId`

  Add the index row; verify the file and the row

- [x] 7.3 Write ADR-004 "Release pipeline: release-please, trusted publishing, staged approval, and a next channel" in `docs/adr/004-release-pipeline.md` (Status: **Accepted**). Cover:
  - tokenless OIDC trusted publishing: `release.yml` stage-only, `publish-next.yml` direct to the `next` tag only
  - maintainer 2FA approval before users get a release
  - release-please with the private `omms-release` GitHub App token, so release PRs run required checks
  - publishing in the same run from the tagged `sha`, because tags created by the action do not trigger workflows
  - the six-platform smoke gate
  - `RELEASE_PLEASE_ENABLED`/`NPM_NEXT_ENABLED` switches and environments limited to `main`
  - CODEOWNERS/required review skipped for a single maintainer
  - npm's token deprecation (the 2026-07-08 changelog) as context

  Alternatives: stored `NPM_TOKEN`, a PAT, tag-push publishing, installing from GitHub, direct publish without staging. References: PR #10, `docs/ci.md`. Add the index row; verify the file and the row

- [x] 7.4 Bootstrap `docs/tdr/` (`README.md` index and `TEMPLATE.md` from the s-tdr bootstrap templates), and add `docs/tdr/` to `.gitignore` next to `docs/adr/`; verify with `git check-ignore docs/tdr/README.md` and inspect only decision-record paths with `git status --short -- .gitignore docs/adr docs/tdr` to confirm `.gitignore` is the only tracked change in that scope
- [x] 7.5 Write TDR-001 "Read OpenCode's live SQLite database with node:sqlite immutable read-only mode" (why libSQL cannot, WAL/-shm behaviour, Node ≥ 22.13, ExperimentalWarning handling, how to recognise a broken read, revisit triggers such as OpenCode moving to V2 storage) and TDR-002 "Capture accepts bare skip replies and logs unparseable ones" (root cause from the live `zai/glm-5.3` failure, schema change, 500-char log, how to diagnose from `~/.omms/omms.log`); add both to `docs/tdr/README.md`; verify both follow the template sections
- [x] 7.6 After section 8 passes, set ADR-002, TDR-001 and TDR-002 to Accepted (ADR-003 and ADR-004 are already Accepted) and update both indexes; verify the statuses match

## 8. Verification (local first; one push)

- [x] 8.1 Run `bun run ci:local` and `bun run check:package`, and verify zero failures
- [x] 8.2 Pack and install the tarball into a scratch project; run `npx om-memory-system import-opencode-history --help` and a `--dry-run --db <fixture>`; verify that the `bin` works from the installed package under Node
- [x] 8.3 Real dry-run against the maintainer's `~/.local/share/opencode/opencode.db` (read-only; no model, no writes); report per-project unit counts, profile prompt count, folded child sessions, unresolved directories, and a checksum showing the DB unchanged. Stop there: the real import happens only after the maintainer approves the counts and chooses the model
- [x] 8.4 Run `openspec validate history-import --strict`, then push once and open one PR

## 9. Follow-up from review (PR #12)

- [x] 9.1 Address the CodeRabbit review: read WAL-mode databases through a consistent temporary copy, log only the reply length, require `--api-url` for a different `--provider`, group Pi windows by session, restore test state
- [x] 9.2 Add `/memory-import-opencode-history` for OpenCode V1 and V2 and move both hosts onto one option parser and runner (`import-args.ts`, `run-import.ts`); default both in-session imports to the session model with `--model provider/id`
- [x] 9.3 Add the `import-pi-history` terminal command and `--skip-memories` for Pi
- [x] 9.4 Skip OMMS's own internal sessions when reading OpenCode history
- [x] 9.5 Apply one live-model rule to both hosts (`live-model-choice.ts`), with the external-API fallback for Pi
- [x] 9.6 Record ADR-005, ADR-006, TDR-003 and TDR-004; update the user guides, README, CONTRIBUTING.md and AGENTS.md
- [x] 9.7 Run `bun run ci:local` and `openspec validate history-import --strict`
