## 1. OpenCode footer and update notice

- [x] 1.1 Add `src/adapters/opencode/tui-status.ts` and `opencode/tui.tsx`; export `./tui` and ship `opencode` in `files`. Tests in `tests/opencode-tui-status.test.ts`.
- [x] 1.2 Check npm `latest` at start and every 6 hours; add `· <version> available` and one toast; honour `OMMS_DISABLE_UPDATE_CHECK=1`.
- [x] 1.3 Check the footer live in OpenCode 2.0.22 through Orca: `omms:connected`, and `omms:connected · 4.2.0 available` with a faked older version.

## 2. Login item

- [x] 2.1 Add `preferredPackageRoot` and `itemPackageRoot` to `src/services/web-autostart.ts`; keep the newest valid copy. Tests in `tests/web-autostart.test.ts`.

## 3. Settings wording

- [x] 3.1 Singular "1 session" in Directory maps and Import; whole-number confidence on the profile page.

## 4. Docs and checks

- [x] 4.1 Add `UPDATES.md`; link it from `README.md` and `docs/upgrading.md`; update `docs/opencode-adapter.md` and `docs/web-ui.md`.
- [x] 4.2 Run `bun run check`, `bun run check:package`, and `bun run ci:local`.
