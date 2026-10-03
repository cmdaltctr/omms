# TDR-025: Run the Claude Code mod test from a small plugin folder

- **Date:** 2026-10-02
- **Status:** Proposed
- **Deciders:** OMMS maintainers
- **Tags:** Claude Code, plugin, tests

## Context

The status line module has tests written for `claude plugin test`. The change plan said to run `claude plugin test hooks`.

### Root Cause Analysis

`claude plugin test [dir]` treats `dir` as a plugin root. It looks for `dir/hooks/hooks.json` naming a module, then runs every `*.test.ts` and `*.test.tsx` under `dir`. It has no file filter.

- `claude plugin test hooks` fails: `no hooks module to load`.
- `claude plugin test .` loads the repository root as the plugin and tries to run all 233 Bun test files. They fail because they import `bun:test`.

## Decision

`scripts/test-claude-mod.sh` copies `hooks/omms-status.js` and `hooks/omms-status.test.ts` into a temporary plugin folder, adds a one-line `hooks/hooks.json` and a minimal `.claude-plugin/plugin.json`, and runs `claude plugin test` there. The module under test is the real file.

Bun's isolated runner ignores `hooks/`, because it runs only `tests/*.test.ts`. `bun run ci:local` does not run the module test. Run it by hand when you change the module.

## Consequences

### Positive

- The module test is repeatable and does not touch the Bun suite.
- No symlink, so it works on every platform that has Bash and Claude Code.

### Negative

- `ci:local` and GitHub CI do not run the module test, and CI would need Claude Code installed.
- The script rebuilds the plugin folder shape. If the module gains a second file, update the script.

## Alternatives Considered

| Option                                         | Rejected Because                      |
| ---------------------------------------------- | ------------------------------------- |
| Run `claude plugin test .` at the root         | Runs every Bun test file and fails.   |
| A checked-in test plugin folder with a symlink | Symlinks break on Windows checkouts.  |
| A checked-in test plugin folder with a copy    | Two copies of the module drift apart. |

## How to Recognise / Handle This Again

- Symptom: `no hooks module to load` from `claude plugin test`, or hundreds of `cannot import "bun:test"` failures.
- Run `bash scripts/test-claude-mod.sh`.
- Stand-ins in the test return `{ value }` or `{ deny }`, except `session.start`, which returns `{ cwd }`. Register every stand-in before the first call on `$`, so one test builds one world.

## Revisit Triggers

- `claude plugin test` gains a file filter or a plugin-root option.
- CI installs Claude Code.

## References

- `scripts/test-claude-mod.sh`, `hooks/omms-status.test.ts`
- [ADR-019](../adr/019-claude-code-status-line-through-a-plugin-module.md)
