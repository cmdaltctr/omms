# Tasks

## 1. Tests first

- [x] 1.1 Replace `tests/settings-toc.test.ts` with a test for the chip row. It checks that `SettingsView` no longer mounts `PageToc`, renders one chip per `SETTINGS_SECTIONS` entry with `aria-pressed`, and keeps every section id. Verify: the test fails on today's code.
- [x] 1.2 Add a web test for selection from the address. Cover `/settings` (Memory basics), `#settings-section-log` (Log), and an unknown anchor (Memory basics). Check that only the selected card lacks `hidden`. Verify: it fails on today's code.
- [x] 1.3 Add a router test: `navigate(to, false, { reveal: false })` pushes the address and updates the store without calling `revealPageAnchor`; plain `navigate(to)` still reveals. Verify: it fails on today's code.
- [x] 1.4 Update `web/tests/sidebar-header.spec.tsx` to expect `text-section-title font-semibold` without `text-brand-label` on the name, and `text-muted-foreground` on the version. Verify: it fails on today's code.

## 2. Implementation

- [x] 2.1 Add the `reveal` option to `navigate()` in `web/src/lib/router.ts`. Verify: test 1.3 passes.
- [x] 2.2 Add the `chip` variant to `web/src/lib/components/ui/button.tsx`. Verify: `bun run check` passes.
- [x] 2.3 Change `SettingsView.tsx`: remove `PageToc`, add the translated **Sections** chip group below the search box, read the selected section from `usePath()`, and set `hidden` on the other cards. Verify: tests 1.1 and 1.2 pass.
- [x] 2.4 Add the **Sections** label to the Settings text table in `web/src/lib/i18n/settings.ts` for Chinese and Arabic. Verify: the Settings text tests pass.
- [x] 2.5 Change the classes in `SidebarBrand.tsx`. Verify: test 1.4 passes.
- [x] 2.6 Run the existing Settings, search, sidebar tree and welcome panel tests through `scripts/run-tests-isolated.sh`. Verify: no failures.

## 3. Docs and design rules

- [x] 3.1 Update `docs/web-ui.md`: the Settings page paragraph (chips in place of the floating contents) and the sidebar header paragraph (title style). Verify: no mention of the Settings table of contents or of `#678D6C` for the name stays.
- [x] 3.2 Update `.agents/skills/omms-design/references/components.md` where it lists the Settings `PageToc` mount, and add the `chip` variant. Verify: the text matches the code.

## 4. Verification

- [x] 4.1 Browser check in Orca on a scratch web app with a copy of the store: chips at 1280 px and 390 px wide, in English and Arabic; select a chip, use Back; follow a sidebar Settings link, a search result and the welcome panel External API link; type in the External API form, switch chips, return, and check the typed value is still there. Verify: screenshots, and each item behaves as the spec says.
- [x] 4.2 Run `bun run ci:local`. Verify: it exits 0.
- [x] 4.3 Run `openspec validate settings-section-chips --strict`. Verify: it passes.

## Workflow follow-up

- Run the `openspec-verify-change` skill, then archive the change before the pull request.
- Ask the user before commit and push.
