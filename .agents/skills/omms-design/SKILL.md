---
name: omms-design
description: Apply OpenChamber-inspired design to the OMMS web UI. Use for styling, shared controls, sidebar appearance, settings rows, localisation, and visual verification in web/.
---

# OMMS design

Guide visual changes to the OMMS web app using its existing React, Tailwind, Radix, and Lucide components.

## Scope

The OMMS web UI stack (inherited from the openmem fork it descends from): React 19, Tailwind CSS v4 via `@tailwindcss/vite` (CSS-first configuration, no `tailwind.config` file), shadcn/ui-style components (`web/components.json`, style `new-york`, CSS variables on) generated into `web/src/lib/components/ui/`, Radix UI primitives (`@radix-ui/react-*`), `class-variance-authority` + `clsx` + `tailwind-merge` for variant styling, and `lucide-react` for icons. Theme values are declared as CSS custom properties in `web/src/app.css` and exposed to Tailwind through `@theme inline` aliases. Treat this stack as the baseline for any OMMS visual work; do not hand-roll replacements for primitives that already exist.

The selected direction is OpenChamber's warm neutral palette, compact system-font UI, and flat tinted controls. The references define the proposed target. OMMS currently has green terminal styling; creating this skill does not apply the target to the app.

Keep navigation, routes, section order, visible wording, save behaviour, and data operations unchanged during a visual-only change. Moving explanations into tooltips, changing defaults, or adding controls requires a separate product decision. Follow the repository's OpenSpec approval process before implementing a UI change.

Preserve the theme and language stores, preference keys, legacy preference migration, and Arabic document direction. Continue using Lucide and the existing UI primitives. Additional dependencies require approval.

## Read by task

| Task                                                                  | Read                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Colours, typography, spacing, corners, borders, or interaction states | [Visual foundations](references/foundations.md)                                                  |
| Buttons, fields, dialogs, sidebar, or settings rows                   | [Component guidance](references/components.md), plus visual foundations                          |
| Any action that starts a request, a job or a jump                     | [Feedback after a click](references/components.md#feedback-after-a-click)                        |
| Visible text, accessible labels, language switching, or Arabic layout | [Localisation](references/localisation.md)                                                       |
| Any rendered UI change                                                | [Verification](references/verification.md) before implementation and before reporting completion |

All source paths in the references are relative to the OMMS repository root. The references contain a source snapshot and proposed styles. Inspect the current owning files before editing.

## Workflow

1. Name the affected screens and shared primitives. Read their current implementations.
2. Load the applicable references. Obtain approval for the bounded visual change.
3. Apply shared styles in their owning files. Preserve event handlers and state ownership.
4. Run focused checks and the applicable visual matrix in the verification reference.
5. Report the files changed, checks performed, and checks that remain unverified.

## Completion

Components use semantic theme variables and the existing translation helpers. Every action shows a visible answer at once and again when it ends. Selected state stays distinct from primary actions. Light and dark modes remain legible, and Arabic layouts preserve readable mixed-direction content. Confirm these outcomes with runtime evidence for each affected screen.

## Discovery and attribution

The canonical skill lives in `.agents/skills/omms-design/`. `.claude/skills/omms-design` links to it. Edit the canonical files. Confirm skill discovery in the installed agent before relying on automatic loading.

The design guidance adapts OpenChamber's MIT-licensed material. Retain [its licence notice](../../../THIRD_PARTY_NOTICES.md#openchamber) with copied material. Source attribution and the selected revision appear in the foundations reference.
