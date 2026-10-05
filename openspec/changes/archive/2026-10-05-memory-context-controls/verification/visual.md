# Memory card visual verification

## Environment

- Worktree: `omms-feat-memory-context-controls`, branch `feat/memory-context-controls`.
- Synthetic preview: `http://127.0.0.1:5187/settings#settings-section-memory`.
- Server: `web/tests/visual/vite.config.ts`, with its real-data API proxy disabled.
- Confirmed loaded CSS paths point to this worktree.
- All values and map paths were synthetic. No real config, credentials, transcripts, or memory store were changed.
- Browser viewport tests only. No mobile emulator was used.

## Appearance

The initial narrow table squeezed the Affects text into tall rows. The final card uses a local horizontal scroller and a 56rem minimum table width. The mobile anchor margin was increased so the sticky header leaves the title visible.

| Language | Theme | Viewport   | Page overflow | Minimum measured text contrast | Result |
| -------- | ----- | ---------- | ------------- | ------------------------------ | ------ |
| English  | Light | 1280 × 800 | None          | 6.04:1                         | PASS   |
| English  | Dark  | 1280 × 800 | None          | 5.27:1                         | PASS   |
| English  | Light | 390 × 800  | None          | 5.02:1                         | PASS   |
| English  | Dark  | 390 × 800  | None          | 5.27:1                         | PASS   |
| Chinese  | Light | 1280 × 800 | None          | 6.04:1                         | PASS   |
| Chinese  | Dark  | 1280 × 800 | None          | 5.27:1                         | PASS   |
| Chinese  | Light | 390 × 800  | None          | 5.02:1                         | PASS   |
| Chinese  | Dark  | 390 × 800  | None          | 5.27:1                         | PASS   |
| Arabic   | Light | 1280 × 800 | None          | 6.04:1                         | PASS   |
| Arabic   | Dark  | 1280 × 800 | None          | 5.27:1                         | PASS   |
| Arabic   | Light | 390 × 800  | None          | 5.02:1                         | PASS   |
| Arabic   | Dark  | 390 × 800  | None          | 5.27:1                         | PASS   |

Measurements used `web/tests/visual/browser-checks.ts`. Disabled controls are excluded from its contrast check. This evidence covers the inspected screen; it is not a full accessibility audit.

At 390px, the table scrolls within a 322px area and retains its 896px minimum width. The English Affects cell measured 293px wide when horizontally scrolled into view. The page itself stayed within the viewport. Rows were 66–113px high after the correction.

- Arabic sets `lang="ar"` and `dir="rtl"`; each technical identifier has computed left-to-right direction.
- Chinese and Arabic text wraps without clipped glyphs in the inspected captures.
- The page has one H1. Memory uses the shared H2 role.
- Checks at 768px and 320px also found only local table overflow.
- At 200% CSS zoom, the page retained local table scrolling and 72px-high input controls. See `en-zoom-200.png`. Native browser-menu zoom was not used.

The multilingual captures predate the user's request to use English only for further visual feedback. Subsequent checks used English. Translation unit tests remain multilingual.

## Runtime interaction evidence

| Check                             | Evidence                                                                                                                        | Result |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Open Memory from project memories | Sidebar click changed the route to `/settings` and requested the Memory anchor.                                                 | PASS   |
| Direct hash and reload            | Browser brought the card into view. Desktop card top: 16px. Mobile card top: 80px, title top: 97px.                             | PASS   |
| Desktop collapse                  | Collapse reduced the sidebar to its icon rail; Expand restored the Settings children.                                           | PASS   |
| Mobile drawer                     | Menu opened the drawer; selecting Memory changed the route and dismissed it.                                                    | PASS   |
| Directory maps focus              | Pi, OpenCode, and Claude Code links opened their own disclosures and focused their summaries.                                   | PASS   |
| Directory maps drafts             | `/synthetic/unsaved-memory-navigation-target` and its checked selection survived Memory navigation and host disclosure changes. | PASS   |
| Invalid draft                     | `retrievalMaxTokens=255` set `aria-invalid`, showed associated range text, and disabled Save.                                   | PASS   |
| Keyboard                          | Tab from the final input reached Save with a visible 2px outline.                                                               | PASS   |
| Draft preservation                | `retrievalMaxTokens=1234` remained after a language and theme change.                                                           | PASS   |
| Cancel                            | Restored 2000 and disabled Save without a file write.                                                                           | PASS   |

The embedded browser did not advance native smooth-scroll animation during one navigation check. For click-target verification, the browser test recorded the application's original scroll target and options, then applied that target instantly. Production code was unchanged by this instrumentation. Animation timing is outside these results.

A separate attempt to capture the horizontally scrolled table returned a blank browser frame. `screenshots/capture-failed-en-effects.png` preserves that failed capture and is excluded from appearance evidence. The viewport captures and computed cell bounds establish the checked layout.

## Screenshots

Final captures are under `screenshots/`:

- `en-light-1280.png`, `en-dark-1280.png`, `en-light-390.png`, `en-dark-390.png`.
- Matching `zh-*` and `ar-*` captures for the recorded matrix.
- `en-zoom-200.png`, with earlier Chinese and Arabic zoom captures.

The before-change English desktop capture is `/tmp/omms-memory-before-en-desktop.png`.
