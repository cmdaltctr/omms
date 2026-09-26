# Repository Instructions

OMMS (npm `om-memory-system`) is a memory plugin for AI coding agents. One shared engine runs behind two hosts: the OpenCode plugin and the Pi extension. Both hosts use one store per project.

## GitHub Flow

- Never make code, documentation, dependency, lockfile, or generated-file changes directly on `main`.
- Before changing files, check the current branch. If it is `main`, create or switch to a focused feature branch first.
- Keep `main` as the integration branch that only receives reviewed changes through pull requests.
- Do not commit, amend, rebase, or push unless the user explicitly asks for that git action.
- Write commit messages as Conventional Commits. release-please derives versions from them: `feat:` is minor, `fix:` and `deps:` are patch, and `!` is major.
- Before a push to a pull request, run `bun run ci:local` and confirm that it passes. Each push starts GitHub CI.
- Do not dispatch `gh workflow run` smoke workflows unless the user asks.

## Architecture

| Path                                     | Responsibility                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/core/`                              | Host ports (`host.ts`), capture pipeline, extraction schema, retrieval, `memory` tool operations   |
| `src/services/`                          | Storage (Turso/libSQL), embeddings, privacy, deduplication, project tags, profiles, web backend    |
| `src/services/ai/live-model-choice.ts`   | The live-model rule for both hosts. Pure functions; callers pass `CONFIG`.                         |
| `src/importer/`                          | History import: shared option parser (`import-args.ts`), runner (`run-import.ts`), ledger, readers |
| `src/adapters/opencode/`, `src/index.ts` | OpenCode V1 plugin hooks and the OpenCode import command                                           |
| `src/v2/`                                | OpenCode V2 plugin adapter over the V1 plugin                                                      |
| `src/adapters/pi/`                       | Pi extension, Pi model bridge, Pi import command                                                   |
| `src/cli/`                               | `om-memory-system` terminal command for both hosts                                                 |
| `web/`                                   | Web UI (Vite). It has its own `package.json`.                                                      |

Keep these boundaries:

- `src/core/` and `src/services/` must not import `@opencode-ai/*`, `@earendil-works/*`, or `src/adapters/*`.
- `tests/host-neutral-capture-boundary.test.ts` and `tests/pi-adapter-boundary.test.ts` enforce that rule.
- An adapter must not import the other host's adapter modules.
- Load host SDKs and heavy modules with dynamic `import()`. `tests/plugin-bundle-boundary.test.ts` checks the plugin bundle.

Read `docs/shared-core.md` before you change a port or move code between layers.

## Host parity

Pi and OpenCode must have the same user capabilities.

- When you add or change a feature for one host, add the same feature to the other host in the same change.
- Put shared behaviour in `src/core/`, `src/services/`, or `src/importer/`. Keep adapters thin.
- Live capture and profile learning choose a model in this order:
  1. The host model: `opencodeProvider`/`opencodeModel` or `piProvider`/`piModel`. `"inherit"` means the session model.
  2. The external API: `memoryModel`, `memoryApiUrl`, and `memoryApiKey`.
  3. The session model.
- Change that order only in `live-model-choice.ts`.
- In-session history imports use the session model, or `--model provider/id`. Only the CLI uses `--provider`, `--api-url`, and `--api-key-env`.

## OpenSpec workflow

Plan behaviour changes with OpenSpec (spec-driven schema, CLI `openspec`) before you write code.

Use a change for a new feature, a change to user-visible behaviour, a breaking change, or work across both hosts. Skip it for typo fixes, docs-only edits, dependency bumps, and bug fixes that restore specified behaviour.

1. If the scope is unclear, investigate first with the `openspec-explore` skill. Do not edit code in this step.
2. Create the change with the `openspec-propose` skill. It writes `proposal.md`, `design.md`, `tasks.md`, and `specs/<capability>/spec.md` under `openspec/changes/<name>/`.
3. Run `openspec validate <name> --strict` and fix every finding.
4. Stop and ask the user to approve the proposal. Do not implement in the same turn as the proposal.
5. Implement with the `openspec-apply-change` skill. Mark each task `- [x]` in `tasks.md` when it is done and tested.
6. If the plan changes during work, update the change artifacts with the `openspec-update-change` skill.
7. Before you report completion, run the `openspec-verify-change` skill.
8. After the pull request merges, archive the change with the `openspec-archive-change` skill. Archiving moves it to `openspec/changes/archive/` and updates `openspec/specs/`.

Use `openspec list` for active changes and `openspec status --change <name>` for artifact status.

Commit OpenSpec artifacts with the code change they describe. Commit the archive move in the pull request that archives a change.

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
- Do not use `bun test` for the whole suite. It runs all files in one process, and about 48 tests fail from shared module state. Those failures are not regressions.
- For a focused check, run one file: `bun test tests/<file>.test.ts`.
- Some tests import `dist/`. If a focused test fails on missing `dist/` files, run `bun run build` first.
- The first embedding test downloads a model from Hugging Face. It needs network access once.
- Many tests replace `../src/config.js` with a partial stub through `mock.module`. A new export from `src/config.ts` is missing in those stubs. Put new pure logic in its own module and pass `CONFIG` as an argument.
- Add a regression test for each bug fix. Do not weaken or delete an existing test to make a change pass.
- Report test failures with the command and its output.

## Code style

- Write TypeScript in strict mode as ES modules. Use `.js` extensions in relative imports.
- Prettier formats code and Markdown. ESLint runs with `--max-warnings=0`.
- The pre-commit hook runs `bun run typecheck` and `lint-staged`. The pre-push hook runs `bun run check`.
- Match the comment density and naming of the surrounding code.

## Error handling

- A failed capture or profile step must not block manual `memory` operations.
- Throw from a `CaptureSummaryProvider` to defer or skip a work unit. Do not return partial data.
- The history importer records each work unit in `import-ledger.db`. Keep reruns idempotent and failed units retryable.
- Never write to OpenCode's database or its `-wal`/`-shm` files, or to Pi session files.

## Security

- Never log raw model replies or prompts. Log sizes and identifiers only.
- Accept secrets as `env://NAME` or `file://path`. Redact API keys from error messages.
- Keep `webServerHost` on loopback by default. A non-loopback host requires `webServerApiToken`.
- Strip text inside `<private>` tags before storage. Use `stripPrivateContent` and `isFullyPrivate` from `src/services/privacy.ts`.

## Documentation

- Keep `README.md` short: what OMMS is, setup, and links. Put detail in `docs/`.
- When you change user-visible behaviour, update the matching guide in `docs/` in the same change.
- Record architectural decisions in `docs/adr/` and implementation fixes in `docs/tdr/`. Add each new record to the folder's index file.
- Keep `CONTRIBUTING.md` in step with the commands and workflow in this file.
- Read `docs/ci.md` before you change a workflow, hook, test runner, or release step.
