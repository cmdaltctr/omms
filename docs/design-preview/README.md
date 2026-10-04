# Design preview evidence

This directory records the approved `omms-design-preview` trial. It changed presentation and an approved dialog focus-return correction. It did not change routes, features, preference keys, legacy preference migration, right-to-left behaviour, or settings save timing.

## Appearance scope

- Warm light and dark themes use semantic colour roles.
- Interface text uses the system sans-serif font. Technical values use JetBrains Mono.
- Shared fields and default buttons are 36px high. Small buttons are 32px. Large buttons are 40px.
- Selected navigation rows use a neutral colour. Narrow navigation keeps a 44px target.
- The dialog close label is translated in English, Chinese, and Arabic.
- The separately approved controlled-dialog correction restores focus only to a connected opener. It preserves consumer focus handlers.

## Isolated trial

The browser trial used `web/tests/visual/vite.config.ts` on `http://127.0.0.1:5179`.

```bash
bun --cwd web run dev --config tests/visual/vite.config.ts --host 127.0.0.1 --port 5179 --strictPort
```

The Vite configuration has empty development and preview proxies. Fixture middleware handles every `/api` request. Unknown routes and undeclared mutations fail closed. Declared memory and settings writes change fixture memory only. Restarting the fixture server resets those writes. The trial did not access the real backend, settings, stores, history, models, or live data.

Root and web frozen-lockfile installs were authorised. Locked files stayed unchanged. This trial did not restart the real backend.

## Browser evidence

The matrix records 60 matched before cases and 60 after cases in `screenshots/`:

- English at 1280px, 768px, and 390px, in both themes.
- Arabic at 1280px and 390px, in both themes.
- Chinese at 390px, in both themes.
- Every case uses an 800px height.

[`after-matrix.json`](after-matrix.json) records computed results for the after cases. It found no overflow or text-contrast failures. Field boundaries meet 3:1 or better. These are measurements of rendered text on the tested backgrounds. They do not prove contrast for every screenshot pixel.

[`final-dialog-matrix.json`](final-dialog-matrix.json), [`final-settings-matrix.json`](final-settings-matrix.json), and [`final-menu-matrix.json`](final-menu-matrix.json) refresh the corresponding captures after the final direction and typography changes. All 36 refreshed cases pass overflow and text contrast checks. Editable API and directory paths use left-to-right monospace text. Full-page settings images can differ in pixel width from their baseline: the original page overflow enlarged some baseline images. Both runs used the same viewport widths.

[`zoom200.json`](zoom200.json) records native Chrome UI zoom at 200%, with a 640px × 400px CSS viewport from a 1280px × 800px viewport. Save remained reachable in light and dark Arabic cases.

[`narrow-reduced-motion.json`](narrow-reduced-motion.json) records 24 cases at 320px × 480px across each language, theme, route, and dialog state. It found no overflow and Save fitted. Reduced motion was **false** in this matrix because media emulation was reset. Do not use this file as reduced-motion evidence.

[`control-states.json`](control-states.json) records 19 passing Puppeteer checks with real pointer and keyboard input. It verifies hover, mouse-down and hit testing, 4.5:1 text contrast, 3:1 focus rings, disabled and invalid controls, Select changing to Beta once, checkbox Space handling, tooltip edge placement, and raw settings-button neutral hover behaviour. It also verifies reduced motion through the browser feature: transitions and animations resolve to `1e-05s`.

[`control-states-initial.json`](control-states-initial.json) is retained as diagnostic evidence. Its six failures came from harness checks: the debugger overlay sat below the sidebar, and the Clear password assertion expected destructive text when the existing control keeps neutral text. The corrections changed the harness only.

## Behaviour evidence

[`memory-interactions.json`](memory-interactions.json) shows an open edit dialog and its textarea stayed mounted through theme and language updates. The selected memory, route, sidebar state, and draft also remained. The corrected dialog focus-return check passes. [`dialog-keyboard.json`](dialog-keyboard.json) keeps the earlier failed baseline that led to this focus regression.

[`settings-interactions.json`](settings-interactions.json) records an unsaved settings value through presentation changes. It also records that settings save only on its existing trigger, including blur where applicable. [`language-menu-keyboard.json`](language-menu-keyboard.json) records menu keyboard navigation, Escape, and focus return. [`preference-migration.json`](preference-migration.json) records legacy adoption, current-value precedence, and reload persistence.

[`mobile-sidebar.json`](mobile-sidebar.json) records drawer dismissal through section navigation, its close control, and the overlay. Desktop widths remain 256px expanded and 56px collapsed in the persistence evidence. Synthetic empty and error searches retain visible feedback in [`empty-search.json`](empty-search.json) and [`error-search.json`](error-search.json).

## Focused checks

Run each focused web test in its own process:

```bash
bun test --tsconfig-override web/tsconfig.app.json web/tests/visual-foundations.spec.ts
bun test --tsconfig-override web/tsconfig.app.json web/tests/dialog-and-preferences.spec.ts
bun test --tsconfig-override web/tsconfig.app.json web/tests/visual-fixture-api.spec.ts
bun test --tsconfig-override web/tsconfig.app.json web/tests/dialog-focus.spec.tsx
bun --cwd web run check
```

[`test-sensitivity.md`](test-sensitivity.md) records 11 focused tests that each failed under a relevant temporary mutation and passed again after restoration. The six focus-return regression tests first produced zero passes and six failures before the correction, then passed after it.

The final run used `bun test --tsconfig-override web/tsconfig.app.json ./web/tests/<file>` once for each file below.

| File                                  | Passed | Failed |
| ------------------------------------- | -----: | -----: |
| `visual-foundations.spec.ts`          |      4 |      0 |
| `dialog-and-preferences.spec.ts`      |      3 |      0 |
| `visual-fixture-api.spec.ts`          |      4 |      0 |
| `dialog-focus.spec.tsx`               |      6 |      0 |
| `language-menu-interactions.spec.tsx` |      8 |      0 |
| `sidebar-settings-tree.spec.tsx`      |      3 |      0 |
| `power-button.spec.tsx`               |      9 |      0 |
| `keys-access.spec.tsx`                |      7 |      0 |
| `embedding-section.spec.tsx`          |      5 |      0 |
| `settings-page-fixes.spec.tsx`        |      9 |      0 |
| `claude-folder-status.spec.tsx`       |      4 |      0 |
| `claude-capture-status.spec.tsx`      |      3 |      0 |
| `web-app-version.spec.tsx`            |      4 |      0 |
| `profile-catch-up.spec.tsx`           |      4 |      0 |

The control-state runner uses an externally available Puppeteer driver. Its module path, Chrome executable, user-data directory, and fixture URL are configurable with environment variables. It does not add a repository dependency or install a package.

## Limits and follow-up

Actual mobile software-keyboard reachability is **NOT RUN**. The user waived physical-device and emulator testing and accepted the existing browser mobile-viewport checks for task 5.3. The task is complete under that revised criterion. Browser viewport evidence does not establish software-keyboard behaviour on a phone. No device preview or network exposure was started.

`bun run check` and `bun run --cwd web check` passed. Fourteen focused test files ran in separate Bun processes: **73 passed, 0 failed**. After the user authorised merge preparation, `bun run ci:local` passed, including build and the full isolated suite. The first attempt stopped at documentation formatting; formatting the verification record resolved it. Bun printed non-failing tsconfig directory-mismatch diagnostics during web tests. Audits are **NOT RUN (not requested)**. The user approved spec sync, archive, and inclusion of the existing attribution commits. Integrated local CI initially passed: **1,677 passed, 0 failed across 251 files**. After PR #88 and the approved backfill test fix, final local CI passed: **1,682 passed, 0 failed across 253 files**. The verification record retains the earlier failures. Fresh GitHub checks await the push.

The [OpenSpec verification record](verification.md) maps all eight requirements and records the accepted browser checks and device-test waiver. [ADR-022](../adr/022-shared-warm-web-design.md) records why the trial uses existing shared presentation owners. [TDR-029](../tdr/029-wait-for-backfill-test-child-cleanup.md) records the separately approved test-only fix for the Windows child-cleanup failure.
