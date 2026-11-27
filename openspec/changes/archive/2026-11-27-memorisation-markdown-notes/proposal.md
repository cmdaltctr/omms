## Why

A memorisation shows on the Memorisation page as one plain block of text. Project memories and the memory chat render Markdown, so headings and lists are easy to scan there. A long note such as `ms-3va2ft` (a decision, three numbered reasons, a plan and a caveat in one paragraph) is hard to read. The omms-remember skill gives the agent no format, so agents write one long paragraph. The snapshot builder stores `Topic: x` lines, and a list in a field breaks: the first bullet sits on the label line.

A memorisation is meant to be a note. It should look like one when it is saved and when it is shown. How long the note should be depends on the user: the size cap is a bare number today, and the agent cannot read it before it writes. The agent only finds the cap when a save fails.

## What Changes

- The Memorisation page renders the full stored text as Markdown, the same way project memory cards do: same renderer, same sanitising, same `markdown-content` style.
- The card title shows plain text. OMMS removes Markdown symbols (`#`, `**`, backticks, list markers, link syntax) from the title line. The title rule keeps the legacy `Topic:` line.
- `memorise` with snapshot fields stores a Markdown note. The topic is the first line. `## Done`, `## Doing` and `## Next` headings follow, each with its value on the lines below, so a bullet list in a field renders as a list. Old records stay as they are.
- **Bug fix:** a bullet list in a snapshot field no longer breaks. Today `snapshotText` writes `Done: - a\n- b`, so the first bullet sits on the label line and does not render as a list item. A regression test covers it.
- **Note length presets.** The Size cap card gets a **Short**, **Medium**, **Long** or **Custom** choice above the number box. A preset fills the box. The defaults are Short 800, Medium 2,000 (today's cap default) and Long 5,000 characters, which are 200, 500 and 1,250 tokens. A number the user types that matches no preset shows as Custom.
- **Editable presets.** Three new global settings, `memorisationShortSize`, `memorisationMediumSize` and `memorisationLongSize`, hold the preset values in characters. The token value of a preset is the character value divided by 4 and rounded up, which is the estimate tokens already use. An **Edit presets** control on the card opens three number boxes and a **Reset presets** button. Each value must lie in the character cap range (100 to 20,000), and Short must be less than Medium, which must be less than Long. Each preset must also be at least one token above the one below it.
- **The agent can read the note length.** The `memory` tool's `help` mode, on every host and the CLI, returns the current note length: the preset name (`short`, `medium`, `long` or `custom`), the cap and its unit.
- The omms-remember skill tells the agent to read the note length with `help` before it writes, and to size the note to it. Short notes have at most 3 bullets in each section. Medium notes have at most 5. Long notes have at most 8 and may add a Context section. A Custom length is sized to the cap. Snapshot fields are bullet lists. A note the agent writes from context with `content` has a one-line title, then `##` sections with bullets, and no long paragraphs. Text the user dictates word for word stays as written.
- ADR-054 records the note shape and the length presets.

No breaking change. CLI and tool recall output stays JSON. The text inside it is Markdown.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memorisation`: the snapshot fields are stored as a Markdown note with a title line and `##` sections. The size cap has three named, editable presets, and `help` reports the note length.
- `web-memorisation`: the full text renders as Markdown, the card title is plain text, and the Size cap card offers the length presets and an editor for their values.
- `omms-skill`: omms-remember reads the note length and writes snapshots and composed notes as Markdown notes of that length.

## Impact

- Core: `src/core/memorisation.ts` (`snapshotText`, preset validation and `noteLengthFor`), `src/core/memorisation-settings.ts` (three new keys in `MEMORISATION_KEYS` and `MEMORISATION_DEFAULTS`, read and edit checks), and the `help` case in `src/core/memory-operations.ts`. Every host and the CLI use these, so no adapter changes.
- Config: `src/config.ts` (types and defaults), `src/config-template.ts`, `src/config-writer.ts`, `src/services/settings-snapshot.ts`, `src/services/settings-editable-keys.ts`. The three keys are global-only, like the other memorisation settings.
- Web: `web/src/lib/components/memorisation/MemorisationRow.tsx` (title and full-text panel), `web/src/lib/memorisation-model.ts` (`memorisationTitle`, preset helpers), `SizeCapForm.tsx` (preset choice), a new preset editor component next to it, the i18n tables (English, Chinese, Arabic), and the existing `web/src/lib/markdown.ts`. No new dependency.
- Skill: `skills/omms-remember/SKILL.md`, the only copy, loaded by all three hosts.
- Tests: `tests/memorisation-core.test.ts`, `tests/memory-operations-memorise.test.ts`, `tests/cli-memory.test.ts`, `tests/memorisation-routes.test.ts`, `tests/claude-plugin-assets.test.ts`, `web/tests/memorisation-view.spec.tsx`, `web/tests/memorisation-routes.spec.ts`, a help-mode test, and a Size cap form test.
- Docs: `docs/using-memory.md`, `docs/web-ui-memory.md`, `docs/adr/054-memorisations-are-markdown-notes-of-a-chosen-length.md` and the ADR index.
- Size cap: Markdown symbols count towards `memorisationMaxSize`. A snapshot uses a few more characters than before.
