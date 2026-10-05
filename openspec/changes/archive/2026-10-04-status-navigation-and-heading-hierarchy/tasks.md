# Tasks

## 1. Host-specific unresolved navigation

- [x] 1.1 Add focused badge and navigation regression tests under `web/tests/` for all three hosts, real link semantics, unchanged visible counts, informational statuses, repeat activation, and empty lists; confirm new assertions fail before implementation.
- [x] 1.2 Add stable host-summary anchors and a bounded shared reveal/focus operation used by Directory maps navigation; verify helper tests preserve other disclosures, target editors, decisions, and both existing general anchors.
- [x] 1.3 Wire Partly imported badges in `HostImportBadges.tsx` and `ImportStatusBadge.tsx` to the matching host list; verify navigation regression tests pass without changing the badge results tested by `bun test tests/web-auto-settings.test.ts`.
- [x] 1.4 Remove repeated overall-status pills from Automatic import and retarget its existing unresolved-directory links; add a failing regression first, then verify host names, run states, progress, counts, errors, models, actions, and polling remain available.
- [x] 1.5 Translate new host/destination accessible names through the English, Chinese, and Arabic settings pairs; verify `bun test tests/web-settings-i18n.test.ts` and rendered accessible-name assertions pass while visible status wording stays unchanged.

## 2. Heading semantics and shared typography

- [x] 2.1 Add focused heading-outline and typography-role tests under `web/tests/` for application H1/H2/H3, profile levels, dialog titles, and preserved Markdown/metadata roles; confirm they fail on the current hierarchy or when the required implementation is removed.
- [x] 2.2 Define relative page, section, subsection, and body roles in `app.css`, align the Settings override, and decouple `DialogTitle` from page-title styling; verify focused role tests and `bun test --tsconfig-override web/tsconfig.app.json web/tests/visual-foundations.spec.ts` pass with the approved 24/18/15/14px scale.
- [x] 2.3 Apply the shared roles and correct semantic levels in `App.tsx`, Profile, Settings cards, nested groups, and Directory maps summaries; verify the heading-outline tests and existing sidebar-anchor tests pass without changing metadata roles, stored content, or Markdown heading styles.

## 3. Documentation and verification

The user waived original tasks 3.2 (synthetic fixtures and browser interactions) and 3.3 (the visual matrix, including mobile and native zoom). These checks are excluded from the execution gate and remain NOT RUN. No product requirement has been removed. Retain the original task numbers for the remaining checks.

- [x] 3.1 Update `docs/web-ui-settings.md`, the matching overview in `docs/web-ui.md`, and the OMMS typography adaptation in `.agents/skills/omms-design/references/foundations.md`; verify they match the navigation and scale while retaining OpenChamber source attribution.
- [x] 3.4 Run focused tests in separate processes, `(cd web && bun run check)`, Aikido on changed code, and `bun run ci:local` after approval for the full suite; record every command and outcome, including failures and blockers.
- [x] 3.5 Run `openspec validate status-navigation-and-heading-hierarchy --strict` and OpenSpec verification against every requirement and scenario; record remaining gaps before requesting archive, commit, or PR approval.
