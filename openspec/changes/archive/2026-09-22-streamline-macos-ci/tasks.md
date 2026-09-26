## 1. Local macOS validation

- [x] 1.1 Add a local CI script for format, lint, typecheck, unit tests, and build; verify it exits successfully on macOS.
- [x] 1.2 Add a package command for the local CI script; verify `bun run ci:local` invokes it.
- [x] 1.3 Add a Husky pre-push hook that runs the deterministic local checks (format, lint, typecheck); verify a failing hook returns a non-zero status.

## 2. GitHub workflow policy

- [x] 2.1 Convert embedding backend verification to manual-only `macos-15`; verify the workflow has no pull-request trigger or OS matrix.
- [x] 2.2 Convert package smoke verification to manual-only `macos-15`; verify the workflow has no pull-request trigger or OS matrix.
- [x] 2.3 Restrict the quality workflow to pull requests; verify it has no `main` push trigger.

## 3. Documentation and local decision record

- [x] 3.1 Create the local GitHub and macOS CI ADR; verify it records the chosen coverage and trade-offs.
- [x] 3.2 Add the ADR directory to `.gitignore`; verify the ADR is ignored by Git.
- [x] 3.3 Add the public CI policy guide under `docs/`; verify it lists local, automatic, manual, and disabled checks.

## 4. Verification

- [x] 4.1 Run `bun run ci:local`; verify formatting, linting, typechecking, tests, and build pass.
- [x] 4.2 Run `git diff --check` and OpenSpec strict validation; verify both commands pass.

## 5. Follow-up reliability fixes

- [x] 5.1 Bundle dist entries through the `bun build` CLI in plugin-bundle-boundary; verify all three tests pass after a clean build.
- [x] 5.2 Run the ci:local suite through the per-file isolated runner; verify the full gate passes.
- [x] 5.3 Restore the README overwritten on main; verify it is byte-identical to the 5461552 version.
- [x] 5.4 Expand docs/ci.md into the full CI setup reference; verify `bun run check` passes.
