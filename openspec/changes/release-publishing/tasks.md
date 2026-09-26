# Tasks

## 1. Package metadata and guards

- [x] 1.1 Reorder every `exports` entry to `types`, `import`, `default`; add `engines.node: ">=22.14"`, `author`, `homepage` and `bugs`; verify `npx publint` reports no errors and `npx @arethetypeswrong/cli --pack --profile esm-only` reports no problems
- [x] 1.2 Set `declarationMap: false` in `tsconfig.json`, rebuild, and verify with `npm pack --dry-run --json` that no `.map` files ship and `dist/web` is still included
- [x] 1.3 Add `scripts/verify-package.mjs` (checks `dist/plugin.js`, `dist/v2/plugin.js`, `dist/adapters/pi/extension.js`, `dist/web/index.html`, and at least one `dist/web/assets/*.js`) as `prepublishOnly`; verify it passes after `bun run build` and fails with a clear message after `rm -rf dist/web`
- [x] 1.4 Extend `scripts/smoke-test.mjs` to assert that the installed package contains `dist/web/index.html` and that the web server, started on a free port with a temporary HOME, serves `/` with HTTP 200 and the `omms Memory Explorer` title; verify locally by packing, installing into a scratch project, and running the script
- [x] 1.5 Remove the token line from `.npmrc` (keep the file only if other settings remain) and verify `bun install --frozen-lockfile` still works
- [x] 1.6 Add `publint` and `attw --pack` steps to the Quality `check` job and verify they pass on the pull request

## 2. release-please

- [x] 2.1 Add `release-please-config.json` (`release-type: node`, `include-v-in-tag: true`, `include-component-in-tag: false`, changelog sections feat/fix/perf/deps/docs with refactor/test/ci/chore hidden) and `.release-please-manifest.json` (`{ ".": "3.0.0" }`), and give Dependabot `deps` (packages) and `ci` (actions) commit prefixes so dependency updates are released; verify both files validate against the release-please config schema. The release history starts at the `v3.0.0` tag created in 6.2, not at a `bootstrap-sha`
- [x] 2.2 Rewrite `.github/workflows/release.yml`: trigger on `push` to `main`; job `release-please` (GitHub App token via `actions/create-github-app-token` from `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY`, outputs `release_created`, `tag_name`, `version`); job `smoke` calling `platform-smoke.yml` when `release_created`; job `publish` (`needs: smoke`, environment `npm-publish`, `id-token: write`, Node 24, npm ≥ 11.15.0, install, build, `npm stage publish` with no token, then add the staged version and approval link to the GitHub Release body); verify with `actionlint` and a dry-run review of the job graph
- [x] 2.3 Delete `.github/release.yml` and the `softprops/action-gh-release` step (release-please creates the GitHub Release); verify no workflow references them

## 3. `next` channel

- [x] 3.1 Add `.github/workflows/publish-next.yml` (switched on by repo variable `NPM_NEXT_ENABLED`; skips commits that change `.release-please-manifest.json`) (runs when Quality succeeds on `main`, skips release-please release commits, sets a `-next.<run_number>` prerelease version, builds, runs `verify-package`, runs `npm publish --tag next` with OIDC in environment `npm-next`, then asserts `dist-tags.latest` is unchanged); verify with `actionlint`
- [ ] 3.2 After the first `next` publish, verify that `npm view om-memory-system dist-tags` shows `latest` unchanged, and record whether Pi reports an update for an `npm:om-memory-system@next` install and whether OpenCode's `opencode plugin check` does for `om-memory-system@next`; document the channel for users only if at least one host notifies

## 4. Docs

- [x] 4.1 README: add an "Install and update" section (Pi: `pi install npm:om-memory-system`, `pi update`; OpenCode v2: `opencode plugin add om-memory-system`, `opencode plugin check`, `opencode plugin update`; pinning with `@x.y.z`; the web UI address); verify with `bun run format:check` and a read-through against the spec scenarios
- [x] 4.2 `docs/ci.md`: replace the manual runbook with the release-please flow, the first-publish checklist (D4), trusted-publisher settings (repo `cmdaltctr/omms`, workflows `release.yml` and `publish-next.yml`, environment `npm-publish`), lockdown steps, and the failed-smoke recovery path; verify the event/job tables match the new workflows

## 5. Verification before merge

- [x] 5.1 Run `bun run ci:local`, then `npm pack` and install the tarball into a scratch project, run `native-deps-smoke`, `verify-libsql-vector` and the extended `smoke-test`; verify all pass
- [x] 5.2 Dispatch Platform Package Smoke on this branch and verify all six platforms pass with the extended smoke test
- [x] 5.3 Run `openspec validate release-publishing --strict` and verify the change is valid

## 6. Maintainer setup and first release (manual, after merge)

- [x] 6.1 In GitHub: enable "Allow GitHub Actions to create and approve pull requests", create the private `omms-release` GitHub App (omms icon; Contents and Pull requests read and write; no webhook; "Only on this account"; installed only on `cmdaltctr/omms`), save `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` as repo secrets, and create the `npm-publish` environment and the `npm-next` environment (deployment branches: `main` only), add CODEOWNERS for `.github/` and require review on `main`, then set repo variable `RELEASE_PLEASE_ENABLED=true`; verify by pushing to `main` and seeing a release PR that triggers Quality
- [x] 6.2 First publish (D4): `npm login` with 2FA, a clean checkout of `main`, build, then `npm publish --access public` at `3.0.0`, then create tag `v3.0.0` and a GitHub Release at that commit so release-please counts commits from there; verify `npm view omms version dist.tarball` and install it with `pi install npm:om-memory-system` and `opencode plugin add om-memory-system` in sandboxes
- [x] 6.3 On npmjs.com, add two trusted publishers: `release.yml` with environment `npm-publish` set to **stage-only**, and `publish-next.yml` with environment `npm-next`; verify the settings page shows both with the right modes, then set repo variable `NPM_NEXT_ENABLED=true`
- [ ] 6.4 Merge the next release PR, verify the version appears in npm's Staged tab and is not installable, approve it with 2FA, then verify it is `latest` with a provenance badge; then set "Require two-factor authentication and disallow tokens", delete the `NPM_TOKEN` secret, and verify a token-based `npm publish --dry-run` is rejected

## Notes from setup (2026-09-25)

- 6.1: CODEOWNERS and required review on `main` were skipped on purpose. With a single maintainer, GitHub does not allow approving your own pull requests, so required review would block every merge. The `npm-next` environment is still limited to `main`. The GitHub App (`omms-release`, id 5074085) was created through the manifest flow, and its secrets were stored without being displayed.
- 6.2: npm rejected the unscoped name `omms` (too similar to `ms`/`os`), so the package was renamed `om-memory-system` (PR #11; plugin id stays `omms`). `om-memory-system@3.0.0` was published from `c52de81`, tagged `v3.0.0`, and given a GitHub Release.
- 6.3: `npm trust list om-memory-system` shows `release.yml`/`npm-publish` as stage-only (`createStagedPackage`) and `publish-next.yml`/`npm-next` as `createPackage` + `createStagedPackage`. `RELEASE_PLEASE_ENABLED` and `NPM_NEXT_ENABLED` are set to `true`.
