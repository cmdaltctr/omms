# Design

## Context

`AppSidebar.tsx` renders the footer control and calls `onLangToggle`. `App.tsx` cycles the language, stores a separate code label, and reloads visible data. `web/src/lib/i18n/index.ts` already exposes `setLanguage`, persists the choice, and sets document direction for Arabic. The sidebar is fixed on mobile and sticky on desktop.

## Goals / Non-Goals

**Goals:** Keep one source of truth for the selected code and show a reachable menu above the sidebar footer.

**Non-Goals:** Add languages, change translation storage, or change the server.

## Decisions

- Use the existing i18n store's current language for the code, and call `setLanguage` only after an option is selected. This avoids a second state value falling out of sync. Keeping the cycling handler would retain the accidental-switch behaviour.
- Put the menu in the sidebar footer and open it upwards, so it stays visible near the bottom of the viewport. Use the existing styling and simple local open state rather than add a menu dependency.
- Give the trigger a translated accessible label, expose the expanded state, and provide named, keyboard-focusable choices with the current choice marked. Close on Escape, outside interaction, or selection and return focus appropriately. Check mobile and Arabic direction.
- Keep the existing refresh of memories, statistics, and visible profile after a real selection. Opening the menu does not reload data.

## Risks / Trade-offs

- [Footer menu may clip on small screens] → Check menu placement and scroll reachability at mobile sizes.
- [Arabic direction may shift the menu off screen] → Align with logical positioning and test in right-to-left mode.
