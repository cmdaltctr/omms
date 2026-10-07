# Verification

## Documentation-only work

For skill creation or reference edits, check frontmatter, links, source paths, examples, and the Claude symlink. Run the local Markdown formatter on changed files. Verify the declared palette against the attributed source snapshot.

This establishes that the guidance is usable. Browser checks below apply only after an approved UI implementation. Do not report a visual matrix as passed after documentation-only work.

The canonical folder is `.agents/skills/omms-design`. The relative link `.claude/skills/omms-design -> ../../.agents/skills/omms-design` must resolve to that folder. Check the installed agent's skill list after reloading its project context. Filesystem checks alone do not prove automatic skill selection.

## Source checks for a UI change

Use the current `package.json` scripts and the repository instructions as the command source of truth. Run commands from the OMMS root with an explicit working directory. Typical focused checks are:

```bash
bun --cwd web run check
bun test ./web/tests/language-menu-interactions.spec.tsx
bun test ./web/tests/sidebar-settings-tree.spec.tsx
```

Run each relevant Bun test file in a separate process. Choose tests for the touched behaviour; these sidebar examples do not cover dialogs, forms, or rendered CSS. Add focused regression tests for fixes, and prove new tests detect a broken implementation. The full `ci:local` gate requires permission and is required before a future merge under the repository rules.

Check that source changes remain within the agreed visual scope. Theme and language persistence keys, route behaviour, API calls, save callbacks, and destructive confirmations must retain their current contracts.

## Run the correct app

The installed app normally runs at `http://127.0.0.1:4747`. It may serve a published build rather than the local checkout.

For local UI work, the root `web:dev` script starts Vite. Its `/api` proxy targets the backend at port 4747. Read `web/vite.config.ts` and use the URL Vite reports. Confirm the loaded styles come from the intended checkout before capturing evidence. Do not restart the live backend, change settings, or write to real memory data as a side effect of visual testing.

Use synthetic data or an authorised test store for destructive actions, credential screens, import flows, and saved settings. Mock a failure state where practical. Keep secrets and private memory text out of screenshots and reports.

## Representative screens

| Screen                    | Route or entry               | Inspect                                                                                   |
| ------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| Memory explorer           | `/project-memories`          | Search, filters, action buttons, selection, memory cards, empty/loading/error states      |
| Profile                   | `/user-profile`              | Headings, prose, lists, metadata, long values, sidebar anchors                            |
| Settings                  | `/settings`                  | Existing section order, labels, fields, checkboxes, status, visible warnings, narrow rows |
| Edit memory dialog        | Open through a memory action | Title, textarea, save/cancel, close label, focus return, long draft                       |
| Sidebar and language menu | Present on each route        | Expanded/collapsed desktop, mobile drawer, selected route, keyboard menu navigation       |

Check the owning route constants in `web/src/lib/routes.ts` if these paths change. A root visit resolves to the memory explorer.

## Visual matrix

For shared theme, font, or control changes, inspect every representative screen. For a local change, inspect that screen and the shared components it affects.

| Language | Theme          | Widths                                           |
| -------- | -------------- | ------------------------------------------------ |
| English  | Light and dark | 1280px desktop, 768px intermediate, 390px narrow |
| Arabic   | Light and dark | 1280px desktop and 390px narrow                  |
| Chinese  | Light and dark | 390px narrow for translation wrapping            |

Use 800px viewport height as a repeatable starting point. Check 320px width and 200% browser zoom for the touched controls and dialogs. These dimensions are verification targets, not new app breakpoints.

### Mobile checks

Check mobile layouts in a desktop browser only. Set a mobile viewport with the browser's device mode or the automation tool's viewport setting, for example 390×844 and 320×480 with touch on. Do not use the iOS Simulator, an Android emulator, or a physical device. Software keyboard behaviour is outside this check, so do not list it as a missing step.

Unless the user asks, keep mobile checks simple: look at the layout at the narrow width and check for overflow. Do not simulate keyboard presses, gestures, or other multi-step interactions at mobile widths. Run keyboard and focus checks (items 3 and 5 below) at desktop width only.

For each applicable case:

1. Inspect the default screen and its hovered, focused, selected, disabled, and error states where present.
2. Verify text contrast against the actual composite background. Target WCAG AA, 4.5:1 for normal text and 3:1 for large text.
3. Check visible control boundaries and focus indicators against neighbouring colours. Test focus visibility through keyboard navigation.
4. Look for horizontal page overflow, clipped translations, cramped icons, and hidden action buttons.
5. Open the dialog or menu. Check Escape, Tab navigation, focus trapping where appropriate, and focus return.
6. Switch theme and language while a safe draft is open. Confirm the route and unsaved content remain intact.
7. Reload to confirm theme and language persistence. Check existing sidebar collapse/tree preferences separately.
8. Verify Arabic document direction and mixed-direction technical text using the localisation reference.
9. Check reduced-motion settings and browser fallback for optional squircle styling.

Use a long synthetic path and a long translated label. Include a multiline memory draft, Arabic prose with an English model identifier, and a checkbox with a wrapped label. Keep test content out of production stores.

## Evidence and reporting

Capture before/after images at matching theme, language, width, and data state. Include screenshots for the main changed screen in both themes and Arabic narrow layout. Record computed styles if you need to confirm a token or font.

Report each check as `PASS`, `FAIL`, `NOT RUN`, or `BLOCKED`, with the command or browser case. A type-check establishes type correctness; screenshots establish appearance only for the cases captured. Explain any missing check and the next action needed to run it. Do not infer accessibility or runtime behaviour from static checks alone.

Audits are separate user-requested work. This skill does not authorise a security scan, package install, live-data mutation, or git push.
