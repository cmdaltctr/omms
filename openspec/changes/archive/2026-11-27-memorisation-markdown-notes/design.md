## Context

See proposal.md for the motivation. Current state:

- `MemorisationRow.tsx:116-126` shows the full text in a `<pre>` with `whitespace-pre-wrap`. The title (`:66-73`) is `memorisationTitle(content)`: the legacy `Topic:` line, else the first non-empty line, as raw text.
- `web/src/lib/markdown.ts` has `renderMarkdown()`: `marked` (GFM, `breaks: true`) and then `DOMPurify.sanitize`. `MemoryCard.tsx:186-187` and `AnswerBubble.tsx:80-82` use it through `dangerouslySetInnerHTML`, with the `.markdown-content` style (`web/src/app.css:220-324`).
- `snapshotText` (`src/core/memorisation.ts:20-25`) joins `Label: value` lines. All hosts and the CLI call it through `runMemorise`.
- `memorisationRepeat: "replace"` finds the earlier snapshot by the session ID tag, not by text. A change to the text shape does not affect it.
- `skills/omms-remember/SKILL.md` is the only copy of the skill. Pi, OpenCode and the Claude Code plugin load it.
- The size cap is `memorisationMaxSize` (default 2000) and `memorisationSizeUnit` (`characters` or `tokens`). `src/core/memorisation-settings.ts` reads them. `SizeCapForm.tsx` edits them. The agent sees the cap only in the error after a failed save.
- The `help` mode (`src/core/memory-operations.ts:149`) exists on every host and the CLI. It needs no embedding model, so it is cheap.

## Goals / Non-Goals

**Goals:**

- One note shape for snapshots and composed notes: a plain title line, then `##` sections with bullets.
- The Memorisation page renders Markdown exactly like project memory cards.
- Length presets the user can pick, and a note length the agent can read before it writes.
- No change to stored records, the API shape, recall or the size cap rules.

**Non-Goals:**

- Rewriting old records. They render well enough as Markdown because `breaks: true` keeps their lines.
- Markdown in the CLI or the TUI. CLI recall prints JSON, and the TUI shows no memorisation text.
- A server-side format check. OMMS stores what the agent sends. The skill guides the format.
- A Markdown hint in the `memory` tool description. The skill is the place for format guidance, and the tool description is shared by every mode.
- Separate token values for each preset. One character value per preset is enough, because tokens are already an estimate from characters.
- More than three presets, or presets with names the user chooses.
- The note length in the injected memory context. It would cost tokens on every prompt for a skill that runs rarely.

## Decisions

1. **Snapshot shape: topic as the first line, then `## Done`, `## Doing` and `## Next`.** Each value starts on the line after its heading, and empty fields are left out. Sections are separated by a blank line. With this shape the card title rule is "first line" for both snapshots and notes the agent writes. A `## Topic` heading was rejected for two reasons. `.markdown-content` styles headings as small muted labels, so the topic would look like a label and not like a title. The title rule would also need a third special case.
2. **Reuse `renderMarkdown` and `.markdown-content`.** The full-text panel uses the same box as now (`rounded-lg border bg-muted p-3`) with `dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}`, `dir="auto"` and the existing `max-h-96 overflow-y-auto`. This matches `MemoryCard` and keeps one sanitising path. A new renderer such as `react-markdown` was rejected because it adds a dependency and a second sanitising rule. `CollapsibleContent` is not needed: the card already has its own Show/Hide button and a height cap.
3. **The title is plain text from a small pure stripper in `memorisation-model.ts`.** It removes `#` heading marks, `*`/`_` emphasis, backticks, leading `-`/`*`/`1.` list markers and `[text](url)` link syntax, and keeps the words. Inline Markdown rendering in the `<h3>` was rejected: links and code chips in a two-line clamped title add noise, and a click on a title link would compete with the card toggle.
4. **Format guidance lives in the skill, with one example.** The skill tells the agent to write snapshot fields as bullets, and to write composed `content` notes as a title line with `##` sections (for example Decision, Why, Plan, Next). Text the user dictates is saved unchanged, as the skill already says. The example is short, so the skill stays easy to read.
5. **Preset values are three global settings in characters, and the selected preset is derived.**
   - `memorisationShortSize`, `memorisationMediumSize` and `memorisationLongSize` (defaults 800, 2000 and 5000) join `MEMORISATION_KEYS`. `removeMemorisationProjectOverrides` then drops them from a project config, and the config writer, settings snapshot and editable keys treat them like `memorisationMaxSize`.
   - The token value of a preset is `Math.ceil(chars / 4)`. That is the same "about four bytes per token" estimate the card already states. The defaults give 200, 500 and 1,250 tokens.
   - `noteLengthFor(settings)` in `src/core/memorisation.ts` is pure and returns `{ length, maxSize, unit }`. The length is the preset whose value in the saved unit equals `memorisationMaxSize`, else `custom`.
   - A validation function accepts a whole number from 100 to 20,000 for each preset, with Short < Medium < Long. Each preset is also at least one token above the one below it: values 1 to 3 characters apart round to the same token value, and the Tokens unit could then not tell them apart. `settingsFrom` and `checkMemorisationSettingsEdits` both call it. An invalid edit is refused with the rule it broke, and the previous values stay. `settingsFrom` throws in the `Invalid <key> config (accepted: ...)` form, so the config loader names the broken key and its rule. For a broken pair it names the key the file sets, or the lower key when the file sets both.
   - The web model imports nothing from `src/`. It gets the preset values from the settings snapshot and uses the same divide-by-4 rule. A test checks the web rule against the core rule.
   - A stored `memorisationNoteLength` key was rejected because it could disagree with the cap number. Separate token values for each preset were rejected because six numbers is too many for one card.
   - Medium equals today's default cap, so existing users see Medium and nothing changes.
6. **The agent reads the length through `help`.** The `help` result gains a `memorisation` object with the note length. `help` already exists in every host's tool schema and in the CLI, so no host adapter changes. It reads the config on each call, so a change on the page applies to the next note. Other routes were rejected for these reasons:
   - A new mode would change three tool schemas.
   - A value in the tool description is fixed when the tool registers, so it goes stale.
   - A value in the injected context costs tokens on every prompt.
7. **The form fills the number box, and the user still presses Save.** The preset choice is a radio group styled like the Characters/Tokens choice. Each option shows its value, for example "Short · 800". Choosing a preset sets the box. Typing a number recomputes the selection. A unit switch keeps the preset and refills the box. On Custom, the unit switch keeps the number, which is the current behaviour.
8. **Preset editor: an Edit presets button opens three number boxes on the same card.** Each box is in characters and shows its token estimate beside it. Save writes the three keys. If the selected preset's value changed, Save writes the new cap too, so the selection stays on that preset. Reset presets fills the defaults 800, 2000 and 5000, and the user then saves. Cancel closes the boxes without a write. The editor is its own component, so `SizeCapForm.tsx` stays small. A dialog was rejected: three numbers fit inline, and the card already follows the inline-form pattern.
9. **ADR-054 records the note shape and the presets** and supersedes nothing. ADR-047 still holds: a memorisation is an exact record, and OMMS never rewrites it.

## Risks / Trade-offs

- [Markdown symbols use part of the size cap] → The overhead is small (about 10 characters for each heading). The skill already tells the agent to stay under the cap, and the error message tells it to shorten the text.
- [The agent skips the `help` call] → The cap still refuses an oversized note, and the error names the limit. The skill falls back to a medium note when `help` fails.
- [Core and web token rules drift] → A test compares them.
- [The user edits a preset that is not selected, and the cap stays the same] → This is intended. The cap only changes when the user picks that preset, or when the edited preset is the selected one.
- [A preset in tokens hits the token range edge] → 100 to 20,000 characters maps to 25 to 5,000 tokens, which is the token cap range. Every valid preset is therefore a valid cap in both units.
- [Agents ignore the format guidance] → Old-style paragraphs still render as readable text. The skill example makes the expected shape concrete.
- [Raw HTML in an agent note] → DOMPurify removes scripts and event handlers. Project memory cards already depend on the same path.
- [Recall by text scores change a little because of the new headings] → Every new snapshot has the same headings, as the old `Topic:` labels did, so the ranking between records does not change much.

## Migration Plan

No data migration and no config migration. A config without the three preset keys uses the defaults. A saved cap of 2000 characters shows as Medium. Any other saved number shows as its matching preset or as Custom. New snapshots get the new shape. Old records keep their text, and both title rules read them. Rollback: revert the commit. Records saved in the new shape stay valid Markdown and read well in the old `<pre>` view.
