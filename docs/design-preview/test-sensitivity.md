# Design preview test sensitivity

Task 2.2 ran each file in a separate Bun process. Each mutation was applied to
the relevant implementation, tested red, restored immediately, then tested
green with the same command. No mutation was kept.

| Test case                                        | Temporary mutation and red result                                                                    | Restored green command                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Warm palette, fonts, and markdown code           | Changed light `--background` to `#000000`; the palette test failed.                                  | `bun test tests/visual-foundations.spec.ts` — 4 pass     |
| Button and Input dimensions and states           | Changed the default button height from `h-9` to `h-8`; the shared-controls test failed.              | `bun test tests/visual-foundations.spec.ts` — 4 pass     |
| Semantic aliases in both themes                  | Mapped `--color-selection` to `--background`; the alias test failed.                                 | `bun test tests/visual-foundations.spec.ts` — 4 pass     |
| Select field boundary, focus, and value contract | Replaced `focus-visible:border-ring` with `focus-visible:border-foreground`; the Select test failed. | `bun test tests/visual-foundations.spec.ts` — 4 pass     |
| Translated logical dialog close control          | Replaced `t("dialog-close")` with a hard-coded English label; the dialog test failed.                | `bun test tests/dialog-and-preferences.spec.ts` — 3 pass |
| Current preference precedence                    | Returned `null` when a current preference existed; the precedence test failed.                       | `bun test tests/dialog-and-preferences.spec.ts` — 3 pass |
| Legacy preference adoption                       | Skipped `writePreference` during legacy adoption; the migration test failed.                         | `bun test tests/dialog-and-preferences.spec.ts` — 3 pass |
| Declared synthetic reads                         | Returned HTTP 500 from `/api/health`; the fixture-read test failed.                                  | `bun test tests/visual-fixture-api.spec.ts` — 4 pass     |
| Unknown route closure and undeclared mutations   | Returned HTTP 200 for an unknown route; the closed-route test failed.                                | `bun test tests/visual-fixture-api.spec.ts` — 4 pass     |
| Vite dev and preview isolation                   | Removed `configurePreviewServer`; the fixture middleware test failed.                                | `bun test tests/visual-fixture-api.spec.ts` — 4 pass     |
| Fixture mutation retention and response shapes   | Prevented memory `PUT` from updating its synthetic item; the retained-memory test failed.            | `bun test tests/visual-fixture-api.spec.ts` — 4 pass     |

The fixture mutation test calls the exported `fixtureResponse`. It restores the
original memory content and settings model in `finally`. Memory reads use the
success envelope. Settings reads retain their raw snapshot shape. It also checks
the declared `PUT /api/memories/preview-memory-1` and `PATCH /api/settings`
paths persist only in fixture memory.

## Browser-only gaps

The focused Bun checks cannot prove rendered contrast, focus visibility,
keyboard traversal, dialog focus trapping and return, responsive overflow,
Arabic direction, Chinese wrapping, browser zoom, or reduced-motion behaviour.
These scenarios remain for task 5 browser verification.
