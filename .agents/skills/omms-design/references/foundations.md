# Visual foundations

## Selected source and current state

Use the `openchamber-light` and `openchamber-dark` JSON themes as the source. Do not use the CSS bootstrap fallback palette.

The source snapshot is OpenChamber revision `02306f32e4d191e4840440cbafa643ae899471c2`, inspected on 3 October 2026:

- [Light theme](https://github.com/openchamber/openchamber/blob/02306f32e4d191e4840440cbafa643ae899471c2/packages/ui/src/lib/theme/themes/openchamber-light.json)
- [Dark theme](https://github.com/openchamber/openchamber/blob/02306f32e4d191e4840440cbafa643ae899471c2/packages/ui/src/lib/theme/themes/openchamber-dark.json)
- [Typography defaults](https://github.com/openchamber/openchamber/blob/02306f32e4d191e4840440cbafa643ae899471c2/packages/ui/src/styles/design-system.css) and [semantic typography](https://github.com/openchamber/openchamber/blob/02306f32e4d191e4840440cbafa643ae899471c2/packages/ui/src/styles/typography.css)
- [Button styles](https://github.com/openchamber/openchamber/blob/02306f32e4d191e4840440cbafa643ae899471c2/packages/ui/src/components/ui/button.tsx)
- [Settings spacing](https://github.com/openchamber/openchamber/blob/02306f32e4d191e4840440cbafa643ae899471c2/.agents/skills/settings-ui-patterns/references/layout.md)

OMMS currently defines its green palette and global monospace font in `web/src/app.css`. That file owns CSS variables and their Tailwind v4 `@theme inline` aliases. The tables below describe proposed values for a future visual change. This skill does not install them.

## Palette and mapping

Keep existing OMMS variable names where their meaning matches. Declare literal colour values centrally in `app.css`; components read semantic variables.

| Role in OpenChamber         | Light       | Dark        | OMMS mapping                                           |
| --------------------------- | ----------- | ----------- | ------------------------------------------------------ |
| Canvas                      | `#fdfcfa`   | `#120f0e`   | `--background`                                         |
| Main text                   | `#393a34`   | `#c9c5ba`   | `--foreground`                                         |
| Elevated background         | `#f8f7f5`   | `#181715`   | `--card`, `--popover`; field fill                      |
| Muted background            | `#f7f6f4`   | `#171615`   | `--muted`, `--secondary`, `--sidebar`                  |
| Secondary text              | `#5c5c54`   | `#8f8b81`   | `--muted-foreground`                                   |
| Border                      | `#e5e1de`   | `#242323`   | `--border`; use for `--input`, `--sidebar-border`      |
| Border on hover             | `#cbc7c2`   | `#504e4c`   | Proposed `--border-hover`                              |
| Primary accent              | `#b35017`   | `#da7c47`   | `--primary`, `--sidebar-primary`                       |
| Primary hover               | `#9a4310`   | `#eb8c57`   | Proposed `--primary-hover`                             |
| Primary pressed             | `#85390c`   | `#fd9b66`   | Proposed `--primary-active`                            |
| Selected item fill          | `#a9998f2b` | `#c8c6c52b` | `--accent`, `--sidebar-accent`; proposed `--selection` |
| Interactive hover overlay   | `#0000000d` | `#ffffff12` | Proposed `--interactive-hover`                         |
| Interactive pressed overlay | `#00000014` | `#ffffff1f` | Proposed `--interactive-active`                        |
| Source focus tint           | `#b3501755` | `#da7c4755` | See focus guidance below                               |
| Error                       | `#b7493f`   | `#da5b4a`   | `--destructive`                                        |
| Warning                     | `#8d6c15`   | `#c67f13`   | Proposed `--status-warning`                            |
| Success                     | `#5f8d3d`   | `#76ad4f`   | Proposed `--status-success`                            |
| Information                 | `#2d72c4`   | `#479fe6`   | Proposed `--status-info`                               |

OMMS mappings are design choices, not a copy of OpenChamber's CSS generator. Use main text for selected items and sidebar labels. Check foreground contrast separately on canvas, elevated, and tinted backgrounds. OpenChamber computes some text colours; its raw JSON does not supply every final foreground.

Keep `--primary-foreground` for text on a solid primary fill. Tinted buttons need a separate readable accent label, such as proposed `--primary-label`. Using the light solid-fill foreground on a pale tint can make text unreadable. Do the same check for destructive fills and labels.

The source focus tint contains transparency. For OMMS, start with the opaque primary accent as `--ring` and verify contrast against each control. This is an adaptation. Maintain an independent focus role even when its value matches the accent.

Proposed variables require definitions in both themes before use. Register new Tailwind aliases in `@theme inline` if components use named utilities. Until then, use existing OMMS classes such as `bg-card`, `text-foreground`, and `border-border`.

## Typography

OpenChamber's default UI font is the system stack. Adopt a system sans-serif UI during the approved visual change:

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
```

Keep the installed JetBrains Mono font for code, commands, identifiers, and file paths. This change needs no font download. Arabic and Chinese must fall back to fonts with the required glyphs. Check Arabic shaping and line height in the browser.

| Role                 | Source size                      | Weight                      | Line height                  |
| -------------------- | -------------------------------- | --------------------------- | ---------------------------- |
| Page title           | `1.0625rem`, 17px at a 16px root | 600                         | 1.25                         |
| Section title        | `0.875rem`, 14px                 | 600                         | 1.2                          |
| UI label             | `0.84375rem`, 13.5px             | 400; 500 for buttons/groups | About 1.45 for general UI    |
| Settings field label | `0.84375rem`                     | 400                         | 1.2                          |
| Helper/meta          | `0.8125rem`, 13px                | 400                         | 1.5 for descriptions         |
| Micro text           | `0.8125rem`, 13px                | 400                         | About 1.45                   |
| Code                 | `0.75rem`, 12px                  | 400                         | Keep code blocks readable    |
| Body/memory prose    | `0.875rem`, 14px                 | 400                         | Preserve OMMS markdown's 1.6 |

These sizes assume the normal root font size. Preserve browser zoom and wrapping. Define reusable typography roles in `app.css` when several components need them. Keep existing text casing and wording; OpenChamber's lowercase button treatment does not authorise a copy change in OMMS.

## Spacing and geometry

Use this compact scale as an OMMS adaptation of the inspected controls and settings rhythm:

| Use                                       | Target                                    |
| ----------------------------------------- | ----------------------------------------- |
| Icon/label gap                            | 6 to 8px                                  |
| Dense options                             | 6px vertical separation                   |
| Field stack                               | 16px                                      |
| Related groups                            | 24px                                      |
| Settings section vertical padding         | 32px when the available space supports it |
| Default control height                    | 36px, `h-9`                               |
| Small button                              | 32px, `h-8`                               |
| Extra-small button                        | 24px, `h-6`, dense desktop rows only      |
| Large button                              | 40px, `h-10`                              |
| Narrow-screen navigation target           | At least 44px touch height                |
| Default control corner                    | 10px                                      |
| Small / extra-small / large button corner | 9px / 7px / 12px                          |
| Border                                    | 1px semantic border                       |

Use a conventional rounded fallback. Squircle enhancement with `corner-shape` is optional and must work without browser support. Keep settings rows flat. Dialogs may use a restrained elevation; decorative shadows and nested panels need a clear purpose.

Do not change sidebar widths, breakpoints, or section grouping in the first styling pass. Test controls against the actual available panel width.

## Interaction states

- Use primary accent for actions. Navigation selection uses the neutral selected fill and foreground text.
- Apply hover only to interactive items. Overlay hover and pressed colour on the base surface so fields retain their fill.
- Primary buttons use a pale accent tint, subtle accent border, and contrast-checked accent text. Source tint strengths are 10% light / 16% dark at rest, 16% / 22% on hover, and 22% / 30% pressed.
- Keep disabled state recognisable without removing visible labels or status information.
- Use status colour with text or an icon. Colour alone must not convey errors or success.
- Use a visible focus outline or ring on the focused element. Preserve keyboard focus through dialogs and menus.
- Keep normal feedback transitions around 150ms. Restrict ongoing animations to opacity and transform, respect reduced motion, and avoid changing layout on hover.

Check the existing global `.settings-view button` hover rule when adapting buttons. It can override the label colour of destructive and neutral variants. Update that rule only as part of the approved shared-control change.

## Theme ownership

`web/src/lib/theme.ts` remains the only theme store. Preserve `useTheme()`, `setTheme()`, `toggleTheme()`, the root `.dark` class, default dark mode, `omms-theme`, and migration from `opencode-mem-theme`. Use `web/src/lib/preferences.ts` for existing preference behaviour. The redesign changes values and component styles, not theme persistence or startup timing.
