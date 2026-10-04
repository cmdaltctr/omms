# Design

## Context

See `proposal.md` for scope and `specs/web-visual-design/spec.md` for acceptance scenarios.

The trial branches from `059da2d`, the existing `feat/omms-design-skill` tip. Source `main` is newer and clean. The copied canonical guidance is byte-identical to the source folder; its Claude symlink resolves to the same skill. The worktree contains no copied runtime data or build output.

Observed owners:

| Owner                                         | Current presentation or contract                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `web/src/app.css`                             | Green light/dark variables, Tailwind v4 aliases, global monospace, markdown line height 1.6, broad settings button hover rule |
| `ui/button.tsx`                               | Existing variant API; default `h-8`, small `h-7`, large `h-9`; solid primary fill                                             |
| `ui/input.tsx`, `textarea.tsx`                | Transparent fields, translucent focus ring, existing validation and prop forwarding                                           |
| `ui/select.tsx`                               | Custom combobox accepting option children and value-change events; caller-owned fill/size classes                             |
| `ui/dialog.tsx`                               | Radix focus behaviour; hardcoded accessible `Close`; physical `right-4` close placement                                       |
| `explorer/AppSidebar.tsx`                     | `w-64`, collapsed `md:w-14`; logical drawer and border; persisted collapse/tree; keyboard language menu                       |
| `settings/SettingsView.tsx`                   | Existing section composition and anchor order; section owners use native fields and buttons as well as shared controls        |
| `App.tsx`                                     | Existing route composition, toolbar classes, language-triggered memory/stat/profile reloads                                   |
| `MemoryCard.tsx`, `ProfileView.tsx`           | Existing prose, metadata, selection, and action layout; some technical values inherit the global font                         |
| `theme.ts`, `preferences.ts`, `i18n/index.ts` | Existing external stores, preference keys, legacy adoption, default dark theme, Arabic document direction                     |
| `web/vite.config.ts`                          | Development `/api` proxy to shared backend port 4747; output in `dist/web`                                                    |

Existing Bun tests exercise language-menu and settings-tree interactions, power confirmations, and settings markup/helpers. They do not establish rendered CSS, dialog focus, computed contrast, or draft retention. Specialist test planning identified these gaps; no tests ran during proposal preparation.

## Goals / Non-Goals

**Goals:** Centralise presentation in existing owners. Let shared tokens and primitives carry the style across every existing screen. Add only the class changes needed to resolve local conflicts, preserve monospace technical content, and support the approved accessibility checks.

**Non-Goals:** Replace stateful components, reorganise sections, flatten functional groups, change responsive app navigation, modify API clients, or introduce new packages. The trial does not adopt Inertia, a new test framework, a theme engine, or OpenChamber runtime components.

## Decisions

### 1. Keep semantic variables and both existing theme selectors

Use the exact palette from `foundations.md`, attributed to OpenChamber revision `02306f32e4d191e4840440cbafa643ae899471c2`. Keep literal values in `app.css`; expose any additional roles through the existing `@theme inline` block.

| Role                            | Light                             | Dark                              |
| ------------------------------- | --------------------------------- | --------------------------------- |
| Canvas / foreground             | `#fdfcfa` / `#393a34`             | `#120f0e` / `#c9c5ba`             |
| Card, popover, field            | `#f8f7f5`                         | `#181715`                         |
| Muted, secondary, sidebar       | `#f7f6f4`                         | `#171615`                         |
| Secondary text                  | `#5c5c54`                         | `#8f8b81`                         |
| Border / hover                  | `#e5e1de` / `#cbc7c2`             | `#242323` / `#504e4c`             |
| Primary / hover / pressed       | `#b35017` / `#9a4310` / `#85390c` | `#da7c47` / `#eb8c57` / `#fd9b66` |
| Neutral selection               | `#a9998f2b`                       | `#c8c6c52b`                       |
| Interactive hover / pressed     | `#0000000d` / `#00000014`         | `#ffffff12` / `#ffffff1f`         |
| Destructive                     | `#b7493f`                         | `#da5b4a`                         |
| Warning / success / information | `#8d6c15` / `#5f8d3d` / `#2d72c4` | `#c67f13` / `#76ad4f` / `#479fe6` |

Use opaque primary as the independent focus role. Derive separate primary/destructive labels for tinted controls and check contrast on actual composites. Solid-fill foregrounds remain separate for checked controls and other existing solid fills. Low-contrast decorative borders do not establish an essential input boundary; use a stronger semantic boundary treatment where needed to meet the 3:1 target.

The alternative, importing OpenChamber's theme runtime, would change ownership and add unnecessary dependencies. Per-screen palettes would make theme checks harder.

### 2. Apply typography centrally and preserve technical roles

Define system sans-serif as `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`. Switch global UI inheritance to sans-serif while retaining the installed JetBrains Mono alias and explicit markdown code styles.

Use the guidance's roles: page title 17px/600, section title 14px/600, UI/field label 13.5px, helper/meta 13px, prose 14px, and code 12px. Keep memory markdown line height 1.6. Apply reusable roles centrally instead of rewriting every text node. Do not reduce root font size or change casing. Add `font-mono` and directional isolation only to technical values that would otherwise lose those roles.

Retaining global monospace would prevent the selected UI direction. A new downloaded font is unnecessary.

### 3. Update controls at their shared owners

Keep button variants and size names. Target default 36px/10px radius, small 32px/9px, extra-small 24px/7px for dense desktop rows, and large 40px/12px. Icon sizes follow their named equivalents. Use 44px minimum touch height for narrow navigation controls without changing the sidebar width or breakpoint. Use approximately 150ms colour feedback and a visible focus ring; avoid hover layout movement.

Use elevated field fills, semantic selection, readable labels, and consistent focus/invalid treatments in Input, Textarea, and Select. Preserve the custom Select's options, keyboard logic, scrolling, and event shape. Remove caller classes only where they conflict with the newly shared visual contract; retain layout widths and shrink rules.

Settings contains native fields and raw buttons. Reuse the existing shared primitives or their existing variant classes where markup semantics remain identical. Consolidate repeated presentational row classes at an existing presentation owner, without introducing a new settings controller or changing a native checkbox's save-on-change behaviour. Native control appearance may be scoped by semantic selector; do not apply broad rules that override named variants.

Replace the global `.settings-view button` colour override with owner-defined variant states. Related badge, checkbox, label, alert, and tooltip owners need changes only where the palette, focus, or typography requires them. Screen-specific overrides and new wrappers are excluded.

### 4. Keep screen composition and state ownership

Use current `AppSidebar` row classes and existing sidebar variables. Keep `SETTINGS_SECTIONS`, profile anchors, routing, mobile dismissal, collapse/tree persistence, and DOM order unchanged. Settings padding and wrapping can adapt within their current sections; do not move controls or remove group panels.

Retain the component types, positions, providers, and keys so React state is preserved. Leave `theme.ts`, `preferences.ts`, language store APIs, and hook logic unchanged. Keep `App.tsx` language-triggered reloads. A style-only class edit there is allowed; state and route composition edits require another approval.

Dialogs retain the existing Radix exports. Add the translated accessible close label using the existing translation infrastructure in all three languages; use logical `end-*` positioning. Preserve visible wording, titles, Escape, form order, save/cancel callbacks, and confirmation prompts. Constrain height and permit scrolling through shared styling so actions remain reachable without restructuring the dialog.

Verification found that controlled dialogs on the original base close to the page body because they have no Radix trigger. The user approved a bounded shared-owner correction. Capture the original opener before open autofocus. On close, run the consumer's focus handler first and honour `preventDefault()`. Restore the opener only if it remains connected; otherwise preserve the existing fallback. Add a failing regression test before implementation. No new control, form step, or route change is authorised.

### 5. Use a test-only Vite configuration with no live fallback

Add a small configuration and fixture support under `web/tests/visual/` after approval. Reuse the normal Vite plugins and aliases, but replace both development and preview API proxies with empty maps. Register fixture middleware for both `configureServer` and `configurePreviewServer`. Every `/api` request must receive synthetic JSON or an explicit fixture error; it must never fall through to a live proxy.

Serve deterministic explorer, profile, and settings responses. Log request metadata and fail unknown endpoints. For checks of save/confirmation behaviour, allow only declared in-memory fixture mutations. Never call a production backend, model, history reader, power operation, or filesystem storage service. Normal Vite config and API clients remain unchanged.

Launch through existing package scripts, for example `bun --cwd web run dev --config tests/visual/vite.config.ts --host 127.0.0.1 --port 5179 --strictPort`, from the checked worktree root. This local development preview supports the matrix without copying or deleting build output. If built preview is needed, use the existing web build/preview scripts with the fixture configuration and request permission before a command that deletes output.

Confirm the loaded CSS/module URL and computed styles match this worktree, not the installed app. Use a distinct loopback origin and isolated browser storage. Record baseline screenshots before UI edits, then repeat each capture with identical fixtures and viewport.

Vite's default preview proxy inherits the development proxy. Changing only middleware or assuming preview is isolated would leave a path to port 4747. Official Vite documentation confirms the need to handle both server modes.

### 6. Keep attribution and evidence with the trial

The user confirmed that `main` already contains `THIRD_PARTY_NOTICES.md#openchamber` and approved removing duplicate attribution work from this trial. Keep that notice on `main` unchanged and preserve the canonical folder verbatim. Its relative attribution link will resolve when integrated with `main`; the older worktree base need not duplicate the file.

Update the web UI guide with the appearance change after implementation. Store a verification record with per-case results, command output, synthetic fixture identity, screenshot paths, and any remaining concern. No security or code audit is part of this handoff.

## Risks / Trade-offs

- Larger default controls can crowd toolbars and dialogs. Test existing widths and wrapping before accepting the trial.
- Source palette colours can fail contrast on tinted backgrounds. Check composites and adapt separate semantic labels/boundaries.
- Legacy local classes can override new primitives. Remove only conflicting presentation at current owners.
- Arabic font metrics and Chinese wrapping can expose clipping. Inspect both themes at narrow widths and preserve logical alignment.
- Modal focus trapping prevents normal pointer access to the sidebar while editing. Check store-driven theme/language updates in the isolated browser without closing/remounting the dialog; do not add a new in-dialog control.
- Static tests cannot establish focus, contrast, or draft survival. Use browser evidence and report missing checks explicitly.
- The worktree starts from an older branch tip. Verify this baseline; do not merge newer source changes into the trial.
- Dependencies are absent in the new worktree. Request install permission before implementation verification; do not link source `node_modules` or copy outputs.

## Verification Plan

Inspect explorer, profile, settings, edit-memory dialog, sidebar, and language menu for every matrix case. Use 800px height.

| Language | Themes         | Widths               |
| -------- | -------------- | -------------------- |
| English  | Light and dark | 1280px, 768px, 390px |
| Arabic   | Light and dark | 1280px, 390px        |
| Chinese  | Light and dark | 390px                |

Also check 320px and 200% browser zoom for touched controls/dialogs. Cover hover, pressed, selected, disabled, invalid, empty/loading/error states, visible warnings, keyboard focus, Escape, focus return, reduced motion, long synthetic paths, mixed Arabic/model identifiers, and multiline drafts. Test preference reload and legacy migration on this isolated origin. The user accepts browser mobile-viewport verification for task 5.3 and waived physical-device and emulator testing. Retain actual software-keyboard behaviour as NOT RUN; it is outside this trial's completion gate.

Use `bun --cwd web run check` and each relevant Bun test file in its own process. At minimum retain language-menu and settings-tree tests; include affected settings/power markup tests and new focused checks for shared contracts, preferences, and translated dialog closing. Prove each new test detects a deliberately broken implementation and restore it immediately. Request permission before `ci:local` or any full suite.

## Migration Plan

No data migration, runtime configuration change, or deployment is needed. The user subsequently authorised committing the trial, syncing its specification, archiving the change, and integrating it through a PR to `main` after local and GitHub CI pass. ADR-022 records the shared-owner design choice. Release actions still require separate approval. Rollback is to leave the trial unapplied and continue using the unchanged source build; do not reset, clean, or remove worktrees without permission.
