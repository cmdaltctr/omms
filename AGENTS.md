# Repository Instructions

OMMS (npm `om-memory-system`) is a memory plugin for AI coding agents. One shared engine runs behind three hosts: the OpenCode plugin, the Pi extension, and the Claude Code hooks. All hosts use one store per project.

## GitHub Flow

- Never make code, documentation, dependency, lockfile, or generated-file changes directly on `main`.
- Do each change in its own sibling worktree. Never switch the main checkout to a feature branch. See [Worktrees](#worktrees).
- Keep `main` as the integration branch that only receives reviewed changes through pull requests.
- Do not commit, amend, rebase, or push unless the user explicitly asks for that git action.
- Write commit messages as Conventional Commits. release-please derives versions from them: `feat:` is minor, `fix:`, `deps:`, `perf:`, and `docs:` are patch, and `!` is major.
- `ci:`, `chore:`, `refactor:`, and `test:` commits are hidden from the changelog. On their own they do not start a release, so use `chore:` when a docs-only change needs none. A hidden commit that lands while a release is pending goes out with it. A `docs:` commit does start a patch release.
- Never edit `version` in `package.json` or `.claude-plugin/plugin.json`. release-please sets both.
- Before a push to a pull request, run `bun run ci:local` and confirm that it passes. Each push starts GitHub CI.
- Do not dispatch `gh workflow run` smoke workflows unless the user asks.

## Worktrees

The main checkout is the folder you cloned the repository into, wherever it is on your machine. It stays on `main` and is for pulls and reading. Each change gets a worktree in the same parent folder, never inside the checkout. These examples assume the checkout folder is named `omms`.

```text
<parent folder>/
├── omms/                      # main checkout, always on main
└── omms-<branch-with-dashes>/ # one worktree per change, removed after merge
```

1. Before you change a file, run `git rev-parse --show-toplevel`, `git branch --show-current`, and `git worktree list`. Run commands only in the worktree you checked.
2. If the main checkout is on a branch other than `main`, tell the user before you do anything else. Offer to move that branch into its own worktree.
3. Start a change from the main checkout: `git fetch`, then `git worktree add ../omms-feat-<name> -b feat/<name> origin/main`. Name the folder `omms-` plus the branch with `/` replaced by `-`.
4. A new worktree has no `node_modules`. Run `bun install --frozen-lockfile` and `(cd web && bun install --frozen-lockfile)` in it first.
5. Run installs, builds, tests, `ci:local`, and `claude --plugin-dir` in the worktree. Never run them for a change in the main checkout.
6. Never create a worktree inside the repository or inside a tool folder such as `.claude/` or `.opencode/`.
7. Before you remove a worktree, copy out any gitignored files you still need: `docs/plans/`, `docs/design-preview/`, `docs/memory-workspace-evidence/`, `experiments/**/output/`, `experiments/**/corpus/`, `experiments/**/eval_results.json`, `experiments/**/ground-truth.json`, and `graphify-out/`. `git worktree remove` deletes ignored files without a warning. Check the copy first. Never copy `.env`. Keep large copies in `/Users/aizat/Development/DATA/omms/` and record each copy's SHA-256 checksum. Do not upload them to a public host.
8. After the pull request merges, remove the worktree with `git worktree remove ../omms-<name>`, delete the branch locally and on GitHub, then run `git pull --ff-only` in the main checkout.

## Architecture

| Path                                     | Responsibility                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/core/`                              | Host ports (`host.ts`), capture pipeline, extraction schema, retrieval, `memory` tool operations   |
| `src/services/`                          | Storage (Turso/libSQL), embeddings, privacy, deduplication, project tags, profiles, web backend    |
| `src/services/ai/live-model-choice.ts`   | The live-model rule for every host. Pure functions; callers pass `CONFIG`.                         |
| `src/importer/`                          | History import: shared option parser (`import-args.ts`), runner (`run-import.ts`), ledger, readers |
| `src/adapters/opencode/`, `src/index.ts` | OpenCode V1 plugin hooks, OpenCode model code, profile learning, and the OpenCode import command   |
| `src/v2/`                                | OpenCode V2 plugin adapter over the V1 plugin                                                      |
| `src/adapters/pi/`                       | Pi extension, Pi model bridge, Pi import command                                                   |
| `src/adapters/claude-code/`              | Claude Code hook client (`claude-hook <event>`). The web app does the memory work                  |
| `src/cli/`                               | `om-memory-system` terminal command for every host, and the `memory` command                       |
| `web/`                                   | Web UI (Vite). It has its own `package.json`.                                                      |

Keep these boundaries:

- `src/core/` and `src/services/` must not import `@opencode-ai/*`, `@earendil-works/*`, or `src/adapters/*`. Hosts register their models through `registerHostProfileModel` and `registerOpencodeHostModels`.
- `src/importer/` must not import `src/adapters/*`. Each host's history reader lives in `src/importer/`, and adapters import from it.
- `tests/host-neutral-capture-boundary.test.ts` and `tests/pi-adapter-boundary.test.ts` enforce that rule.
- An adapter must not import the other host's adapter modules.
- Load host SDKs and heavy modules with dynamic `import()`. `tests/plugin-bundle-boundary.test.ts` checks the plugin bundle.
- The `claude-hook` and status commands in `src/adapters/claude-code/` print one JSON result to stdout. Send logs and warnings to stderr. `status.ts` redirects `console.log` for this reason.

Read `docs/shared-core.md` before you change a port or move code between layers.

## Host parity

Pi and OpenCode must have the same user capabilities.

- When you add or change a feature for one host, add the same feature to the other host in the same change.
- Put shared behaviour in `src/core/`, `src/services/`, or `src/importer/`. Keep adapters thin.
- Live capture and profile learning choose a model in this order:
  1. The host model: `opencodeProvider`/`opencodeModel` or `piProvider`/`piModel`. `"inherit"` means the session model.
  2. The external API: `memoryModel`, `memoryApiUrl`, and `memoryApiKey`.
  3. The session model.
- Claude Code uses step 2 only. Its hooks cannot call the session model, so it has no host model and no session model.
- Change that order only in `live-model-choice.ts`.
- In-session history imports use the session model, or `--model provider/id`. Only the CLI uses `--provider`, `--api-url`, and `--api-key-env`.
- Known refactor, not started: about 29 lines outside `src/adapters/` branch on the host name with `if (host === "pi")` or `case "claude-code"`. Most are in `src/importer/`, and `import-sources.ts` has the most. A host registry would replace them. Each host would register its reader, default source path, backfill-model key, and readiness check. A new host now means editing every branch. Do not start the registry inside an unrelated change. Before you add a fourth host, propose it as an OpenSpec change.

## OpenSpec workflow

Plan behaviour changes with OpenSpec (spec-driven schema, CLI `openspec`) before you write code.

Use a change for a new feature, a change to user-visible behaviour, a breaking change, or work across both hosts. Skip it for typo fixes, docs-only edits, dependency bumps, and bug fixes that restore specified behaviour.

1. If the scope is unclear, investigate first with the `openspec-explore` skill. Do not edit code in this step.
2. Create the change with the `openspec-propose` skill. It writes `proposal.md`, `design.md`, `tasks.md`, and `specs/<capability>/spec.md` under `openspec/changes/<name>/`.
3. Run `openspec validate <name> --strict` and fix every finding. If a finding comes from a wrong baseline spec in `openspec/specs/`, fix the baseline. Do not work around the validator.
4. Stop and ask the user to approve the proposal. Do not implement in the same turn as the proposal.
5. Implement with the `openspec-apply-change` skill. Mark each task `- [x]` in `tasks.md` when it is done and tested.
6. If the plan changes during work, update the change artifacts with the `openspec-update-change` skill.
7. Before you report completion, run the `openspec-verify-change` skill.
8. Before you create the pull request, archive the completed change with the `openspec-archive-change` skill. Archiving moves it to `openspec/changes/archive/` and syncs its spec deltas into `openspec/specs/`. Archive only when every task is done and step 7 passes.

Use `openspec list` for active changes and `openspec status --change <name>` for artifact status.

Commit OpenSpec artifacts with the code change they describe. Commit the archive move in the same pull request as the change. A change that is only a proposal stays active until it is implemented.

## Code graph

`graphify-out/` holds a local knowledge graph of the code. Git does not track it, so a fresh clone or worktree has none until someone builds it.

- When `graphify-out/graph.json` exists, use `graphify query "<question>"` for architecture and relationship questions. Use `graphify path "<A>" "<B>"` and `graphify explain "<concept>"` for focused ones. Read `graphify-out/GRAPH_REPORT.md` only for a broad review.
- For "where is X defined", use grep or glob. The graph favours documentation nodes over source symbols for these questions.
- If `query_graph` output says `TRUNCATED`, run it again with `token_budget: 8000` before you decide the graph has no answer. If 8000 also truncates, narrow with `context_filter` or `depth`.
- After you change code, run `graphify update .`. It reads the syntax tree only and makes no API calls.

## Commands

Run all commands from the repository root. Bun and Node 24 are required; the package supports Node 22.14 or later.

```bash
bun install --frozen-lockfile
(cd web && bun install --frozen-lockfile)
bun run check      # format check, lint, typecheck (about 11 seconds)
bun run build      # clean build of dist/ and the web UI
bun run ci:local   # check, build, then every test file in its own process
```

`bun run check:package` checks the published package shape. Run it after `bun run build` when you change `package.json`, entry points, or `files`.

## Testing

- Use `bun run ci:local` as the required gate before a merge.
- For a focused check, run one file through the runner: `bash scripts/run-tests-isolated.sh tests/<file>.test.ts`. A plain `bun test` refuses to run, so tests never touch your real `~/.omms` store.
- The Claude Code module files (`hooks/*.jsx`, `hooks/*.js`) have their own tests, `hooks/*.test.ts`. Bun does not run them. Run `bash scripts/test-claude-mod.sh`. It needs the `claude` command (2.1.295 or later). `ci:local` does not run it.
- Some tests import `dist/`. If a focused test fails on missing `dist/` files, run `bun run build` first.
- The first embedding test downloads a model from Hugging Face. It needs network access once.
- Many tests replace `../src/config.js` with a partial stub through `mock.module`. A new export from `src/config.ts` is missing in those stubs. Put new pure logic in its own module and pass `CONFIG` as an argument. This applies to new code in `src/core/` and `src/services/` as well as to tests: do not import `CONFIG` there. `src/services/ai/live-model-choice.ts` is the pattern.
- Add a regression test for each bug fix. Do not weaken or delete an existing test to make a change pass.
- Report test failures with the command and its output.

## Code style

- Write TypeScript in strict mode as ES modules. Use `.js` extensions in relative imports.
- Prettier formats code and Markdown. ESLint runs with `--max-warnings=0`.
- The pre-commit hook runs `bun run typecheck` and `lint-staged`. The pre-push hook runs `bun run check`.
- Match the comment density and naming of the surrounding code.
- Keep each `.ts` and `.tsx` file in `src/` and `web/src/` at 500 lines or fewer. `tests/file-size-ceiling.test.ts` enforces it. 19 older files are over the limit and listed in that test. They may shrink but not grow. When you split one, remove its entry. Translation tables in `web/src/lib/i18n/` are exempt.
- Use British English in documentation, comments, and commit messages. Code identifiers keep their existing spelling.

## Error handling

- A failed capture or profile step must not block manual `memory` operations.
- Throw from a `CaptureSummaryProvider` to defer or skip a work unit. Do not return partial data.
- The history importer records each work unit in `import-ledger.db`. Keep reruns idempotent and failed units retryable.
- Never write to OpenCode's database or its `-wal`/`-shm` files, or to Pi session files.

## Security

- Never write raw model replies or prompts to the log. Log sizes, identifiers, and codes; every capture attempt logs one metadata record.
- Prompts and replies may be written only to the capture trace, only when the user turns on `captureTrace` in the global config, and only after `<private>` and secret redaction. A project config can turn tracing off but never on.
- The one exception is the capture retry queue (`capture_retry_queue` in `user-prompts.db`, see ADR-012). It stores a turn only after a retryable live capture failure, only after `<private>` removal and trace secret redaction, and never inside a project folder. It deletes each turn on the final outcome or after `captureRetryRetentionHours` (global only, default 72, 0 turns it off).
- Accept secrets as `env://NAME` or `file://path`. Redact API keys from error messages.
- Keep `webServerHost` on loopback by default. A non-loopback host requires `webServerApiToken`.
- Strip text inside `<private>` tags before storage. Use `stripPrivateContent` and `isFullyPrivate` from `src/services/privacy.ts`.

## Documentation

- Keep `README.md` short: what OMMS is, setup, and links. Put detail in `docs/`.
- When you change user-visible behaviour, update the matching guide in `docs/` in the same change.
- When you change a default in `src/config.ts`, grep `docs/` and `README.md` for the old value and update every hit in the same change. No test checks this.
- `docs/README.md` indexes the guides. Add each new guide to it.
- Record architectural decisions in `docs/adr/` and implementation fixes in `docs/tdr/`. Add each new record to the folder's index file.
- Keep `CONTRIBUTING.md` in step with the commands and workflow in this file.
- Read `docs/ci.md` before you change a workflow, hook, test runner, or release step.
