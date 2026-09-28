## 1. Boundary test first

- [ ] 1.1 Add the check from D6 to `tests/pi-adapter-boundary.test.ts`: every file in `src/core`, `src/services`, and `src/types` has no `@opencode-ai/` or `@earendil-works/` specifier in any import form, and `src/importer` loads them only by dynamic `import()` in named reader modules; confirm it fails today and lists the current offending files

## 2. Move the OpenCode modules

- [ ] 2.1 `git mv` the seven `src/services/ai/opencode-*.ts` and `profile-llm-client.ts` modules into `src/adapters/opencode/`, and update every import and `mock.module` path; verify with `bun run typecheck` and the OpenCode capture, V2 plugin, and bundle-boundary tests
- [ ] 2.2 Split `internal-capture-sessions.ts`: titles to `src/importer/opencode-internal-sessions.ts` (D2), live tracking to the adapter; verify with the OpenCode reader tests and the internal-session capture tests
- [ ] 2.3 `git mv` `src/services/user-memory-learning.ts` to `src/adapters/opencode/profile-learning.ts` and update `src/index.ts` and its tests; verify with the existing profile learning tests

## 3. Ports for shared code

- [ ] 3.1 Add `adaptOpencodeProfileModel` in `src/adapters/opencode/`, matching `adaptPiProfileModel`; verify with a unit test that it calls OpenCode's structured output with the same prompt
- [ ] 3.2 Give `user-profile-manager.ts` and `ai-cleanup.ts` an optional `ModelPort` (D3) and remove their OpenCode imports; verify with tests that the port is called when passed and the external API is used when not, with the same prompt and output as before
- [ ] 3.3 Generalise the host registry in `backfill-controls.ts` (D4) to carry the backfill resolver, the import model factory, and the profile `ModelPort` factory; register them from the OpenCode adapter and the Pi extension; verify with registry tests on both hosts
- [ ] 3.4 Switch `web-import-jobs.ts` and `settings-health.ts` to the registered import models; verify the web import and Health tests, including the standalone web app reporting OpenCode models as unavailable
- [ ] 3.5 Move `src/services/settings-models.ts` to `src/importer/settings-models.ts` (D5); verify with the Settings models tests

## 4. Close out

- [ ] 4.1 Confirm the boundary test from 1.1 now passes with no allowances beyond the named importer readers
- [ ] 4.2 Update `docs/shared-core.md`, `docs/opencode-adapter.md`, and CLAUDE.md's architecture table; record the remaining follow-up (one profile learning loop for both hosts) in the change's design and the ADR-011 consequences
- [ ] 4.3 Run `bun run ci:local` and `bun run check:package`
- [ ] 4.4 Manual check in OpenCode V1 and V2: one live capture, one profile learning run, and one AI profile cleanup succeed, and the capture attempt log shows the host model
