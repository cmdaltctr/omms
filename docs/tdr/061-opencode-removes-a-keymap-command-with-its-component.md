# TDR-061: OpenCode removes a keymap command with the component that registered it

- **ID:** TDR-061
- **Date:** 2026-11-03
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Tags:** opencode, tui, keymap, slash-command, visible-recall

## Context

`/omms-recall` appeared in the OpenCode slash menu, and then it was gone while OpenCode kept running. The command was registered by `keymap.layer` inside the render of the `session.composer.top` slot, which draws the recall rows.

## Finding

OpenCode documents that a keymap layer is owned by the component or reactive computation that created it. It removes the layer when that owner is disposed (`context.keymap.layer` in the OpenCode plugin docs). The row slot is mounted only while a session is on screen, so the command went with it.

I did not reproduce the loss in a scratch run. The cause is the documented ownership rule, and the fix is covered by stub tests. A live check after release is still open.

## Decision

Register commands from a slot that stays mounted. The `./tui` entry now claims the `app` slot, calls `keymap.layer` once there, and returns nothing to draw. The row slot no longer touches the keymap. Both claims are released when the entry stops.

## Consequences

- `/omms-recall` stays available for the whole TUI run, also when no session is on screen.
- Any new command in the TUI entry follows the same rule.

## How to recognise this again

A slash command or palette entry that shows at first and later vanishes without a restart. Check which component registered its layer.

## Revisit triggers

- OpenCode changes the ownership rule for keymap layers.

## References

- ADR-039
- TDR-060
- `src/adapters/opencode/tui-recall.ts`
