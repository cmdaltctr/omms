# Design

## Context

`hooks/omms-status.js` is a Claude Code function-hooks module, listed under `modules` in `hooks/hooks.json`. It polls the web app health route every 30 seconds, asks the plugin launcher for the status JSON every 6 hours, and calls `$.ui.status(text)`. Claude Code draws that text in its plugin status row with a yellow `⚠` prefix. `$.ui.status` takes text only, and no render site covers that row, so the row cannot be restyled.

The plugin API of Claude Code 2.1.289 lists the render sites a `ui.render` hook may draw: `InfoNotice`, `SessionMode`, `PromptHint`, `AbovePrompt`, `Pane`, and transcript rows. `Text` takes `color` as a theme key or a raw colour.

## Goals / Non-Goals

**Goals:**

- Show OMMS state in colour: green connected, yellow connecting, red off.
- Never show `⚠` or yellow for a healthy web app.
- Keep the polling, launcher facts, update check and toast as they are.

**Non-Goals:**

- No change to OpenCode or Pi footers.
- No buttons or click actions on the label.
- No change to the health route, launcher, or `claude-hook status` command.

## Decisions

### 1. Draw in `SessionMode`

A `ui.render` hook on `{ component: 'SessionMode' }` draws the label. The site is the dim mode labels at the right of the prompt footer. It is one row the footer already holds, so it takes no new row. The hook calls `next(e)` first and draws the engine's tree, then our label after it. Other modes and other plugins' labels stay.

Alternatives:

- `PromptHint`: a coloured tree replaces `? for shortcuts` and its live pills, and `tail` is dim only. Rejected.
- `AbovePrompt`: a whole band with a `[-]` mark, and it gives way to surveys. Too heavy for one word.
- Keep `$.ui.status` and add the footer label: the `⚠` row stays. Rejected.

### 2. Colours from theme keys

`success` for connected, `warning` for connecting, `error` for web app off and not installed. Theme keys follow the user's light or dark theme. Task 1 checks that the engine accepts these keys. If it does not, use raw `green`, `yellow`, `red`.

Label shape: `● omms: <state>` with the dot and state in the colour. A dim ` · <version> available` follows when there is an update.

### 3. `connecting` state

Today `show()` draws nothing while `facts.web === null`. The new label shows `connecting` in that state instead. The first health check runs at once on the default URL and times out after 3 seconds, so `connecting` lasts at most about 3 seconds. A later failed check shows `web app off`, not `connecting`.

### 4. State in an atom, redraw on change

The render hook reads the state from an `atom` (`read($, atom)`). `checkHealth` and `refreshStatus` write it with `update($, atom, fn)`, which redraws the readers. The plain facts object stays the source of truth inside the module. The atom holds only what the label draws: `state` and `update`.

### 5. Module becomes `.jsx`

Render hooks build trees with JSX from `$.ui.resolve(e)`. Claude Code loads `.jsx` and compiles it, so the plugin still ships no build step. `hooks/hooks.json` `modules` names `./omms-status.jsx`. ESLint and `tsconfig.json` cover only `src/`, so `bun run check` is unaffected. Prettier formats `.jsx`.

### 6. Tests

`hooks/omms-status.test.ts` uses `claude-code/testing`. It mounts `SessionMode` with `$.ui.mount` and reads the drawn tree for each state: colour key, text, and the engine's own mode labels kept. It also checks that the module makes no `$.ui.status` call. The existing launcher and update tests carry over.

## Risks / Trade-offs

- [`SessionMode` may not exist in Claude Code 2.1.287] → Task 1 checks. If it is missing, raise the minimum to the first version that has it, in the spec, plugin description, and docs.
- [`next(e)` may return nothing when there are no modes] → The hook draws only our label then. Test both cases.
- [The footer label is narrow at small terminal widths and may be cut] → Keep the label short. The update suffix is the first part to lose.
- [Another plugin draws its own `SessionMode` tree without `next(e)`] → Our label hides under it. Rare; accepted.
- [No footer in headless runs] → Same as today: the status row is also absent there.
- [Users who used the old status row lose it] → The footer label replaces it with the same words plus colour. Docs say where it moved.

## Migration Plan

No data migration. Users get the new label with the next plugin update. Rollback: restore `omms-status.js` and its `modules` entry.
