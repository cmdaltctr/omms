# ADR-054: Memorisations are Markdown notes of a chosen length

- **Date:** 2026-11-27
- **Status:** Accepted
- **Deciders:** OMMS maintainer
- **Change:** [`memorisation-markdown-notes`](../../openspec/changes/memorisation-markdown-notes/proposal.md)

## Context

A memorisation is an exact record that OMMS never rewrites (ADR-047). The record has no fixed shape. Two paths write it:

- Snapshot fields (`topic`, `done`, `doing`, `next`). `snapshotText` joins them as `Label: value` lines. A bullet list in a field breaks, because its first bullet sits on the label line.
- Free `content`. The omms-remember skill gives no format, so agents write one long paragraph.

The Memorisation page shows the text in a `<pre>` block. Project memory cards and the memory chat render Markdown through one shared renderer (`marked` and DOMPurify) and the `.markdown-content` style. A long decision note is therefore hard to read on the one page built for notes.

The size cap (`memorisationMaxSize`, `memorisationSizeUnit`, default 2,000 characters) is a bare number. The user has no simple way to say "short notes" or "long notes". The agent cannot read the cap before it writes. It only sees the cap in the error after a failed save.

## Decision

1. **A memorisation is a Markdown note with one shape.** The first line is a plain title. `##` sections with bullet lists follow. OMMS does not enforce the shape. The skill guides it, and the renderer shows any Markdown.
2. **Snapshots use the same shape.** The topic is the first line. `## Done`, `## Doing` and `## Next` follow, with each value on the lines after its heading. Empty fields are left out.
3. **The Memorisation page renders the full text with the shared Markdown renderer and `.markdown-content`**, exactly like project memory cards. The card title is the first line (or a legacy `Topic:` line) with Markdown symbols removed.
4. **The size cap has three named presets, and the user can edit their values.** Global-only settings `memorisationShortSize`, `memorisationMediumSize` and `memorisationLongSize` hold the values in characters. The defaults are 800, 2,000 (today's cap default) and 5,000. A preset's token value is its character value divided by 4 and rounded up, which is the estimate tokens already use. Each value lies from 100 to 20,000, and Short < Medium < Long, each at least one token above the one below it. The selected preset is derived from the saved cap: the preset whose value in the saved unit equals the cap, else Custom. The Size cap card shows the choice above the number box. An **Edit presets** control on the card changes the three values and can reset them to the defaults.
5. **The agent reads the note length from the `help` mode.** `help` returns the preset name, the cap and its unit, and it reads the config on each call. It already exists on every host and in the CLI.
6. **The omms-remember skill reads the length first and sizes the note to it.** Short allows at most 3 bullets in each section. Medium allows at most 5. Long allows at most 8 and an optional Context section. Custom is sized to the cap. If `help` fails, the agent writes a medium note. Text the user dictates is saved unchanged.
7. **Old records stay as stored.** The renderer keeps their line breaks, and the title rule still reads `Topic:`.

## Alternatives Considered

| Option                                         | Rejected Because                                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A `## Topic` heading in snapshots              | `.markdown-content` styles headings as small muted labels, so the title would look like a label.               |
| `react-markdown` for the page                  | A new dependency and a second sanitising rule, when `renderMarkdown` already serves memory cards and the chat. |
| Rewrite old snapshots to the new shape         | ADR-047 makes a memorisation an exact record. The old text already reads well with line breaks kept.           |
| Server-side format check on `memorise`         | It would refuse dictated text and short one-line notes. Guidance in the skill is enough.                       |
| Markdown title rendering in the card `<h3>`    | Links and code chips in a two-line clamped title add noise, and a link click competes with the card toggle.    |
| A `memorisationNoteLength` config key          | It could disagree with the number, and every settings path and host would need to know it.                     |
| A new `memory` mode for the note length        | Three tool schemas change, when `help` already exists everywhere.                                              |
| The cap in the tool description                | The description is fixed when the tool registers, so it goes stale after a change on the page.                 |
| The note length in the injected memory context | It costs tokens on every prompt for a skill that runs rarely.                                                  |
| Fixed preset values in code                    | Users want their own idea of short, medium and long, and Custom alone does not give the agent a named length.  |
| Separate token values for each preset          | Six numbers on one card. Tokens are already an estimate from characters, so one value per preset is enough.    |

## Consequences

- Snapshots and agent notes look the same on the page and are easy to scan.
- The user picks a note length in one click, and the agent writes to it.
- Three more global settings to validate, write and show. They follow the path of the other memorisation settings.
- The meaning of "short" differs between users. The agent reads the name and the cap, so it sizes the note to the real cap.
- An agent that follows the skill makes one extra `help` call before each save.
- Markdown symbols count towards the size cap. A snapshot uses about 10 more characters for each section.
- CLI and tool recall still return JSON. The text inside is Markdown, which agents read without trouble.
