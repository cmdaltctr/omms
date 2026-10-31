# Skill learning

Skill learning records how your agents work, ranks the skills you use, and drafts better versions of them. You review each draft before it changes a file, unless you turn on automatic mode for that skill.

It is off by default. Nothing is recorded until you turn it on.

## What is recorded

When skill learning is on, OMMS records each finished turn on Pi, OpenCode and Claude Code:

- the prompt
- every assistant reply, in full
- every tool call in order, with its input, whether it succeeded, and its error text
- each skill the turn used, and how: through the host's skill tool, by reading a `SKILL.md`, or by a slash command

A namespaced name such as `opsx:apply` keeps its full name. It is shortened to `apply` only when a watched skill has that name.

Tool output, such as the text of a file the agent read, is not stored.

Turns go into `skills.db` in the storage path (`~/.omms/data` by default). It is never inside a project folder. Treat this file as private, because it holds whatever your turns hold.

Project memories and the user profile do not change. They get the same input as before, and they never read `skills.db`.

Recording makes no model call. A failure to record is logged without any turn text and never stops memory capture.

## Turn it on

1. Open **Settings** and go to the **Skill learning** card.
2. Turn on **Record agent turns**.
3. Read the warning box. It says what OMMS stores and what drafting sends to the external API.

You can also set `"skillLearning": true` in the global config. See [Configuration](configuration.md#skill-learning).

A project config can turn recording off for that project. It cannot turn it on.

## Redaction

**Remove private text and secrets** is on by default. OMMS then removes text inside `<private>` tags and redacts secrets before it stores a turn. A prompt that is entirely private is not recorded.

If you turn it off, OMMS asks you to confirm and shows a red warning box. Text is then stored as written, and it is sent to the external API when you draft a skill.

On OpenCode, `<private>` text is already removed from the prompt before OMMS sees it, so OpenCode prompts stay stripped even with redaction off.

## Record past turns

After you turn recording on, select **Record past turns** on the Settings card or the Skills page. OMMS reads every set-up host's history, for all projects, and records the turns. Sessions whose project folder no longer exists are recorded too, under the recorded folder path. It makes no model call. Running it again adds only new turns.

The button first shows **Finding past sessions…**, then a progress bar with the turn count, then **Recorded N past turns**. The web app keeps answering while the run goes on. On macOS, the first run can ask whether `node` may read a history folder. The run waits until you answer.

From the terminal:

```bash
om-memory-system skills record-past        # shows what it would record
om-memory-system skills record-past --yes  # records
```

History imports also record skill turns when recording is on. Use `--skip-skills`, or clear **Skill turns** in the import form, to leave them out. See [CLI](cli.md#skill-turns).

## Watched folders

OMMS reads skills from the folders it watches. By default these are `~/.agents/skills` and the `skills` folder in the Claude Code folder, each when it exists. Skills in nested category folders are found, up to four levels deep.

On the **Skills** page, under **Watched folders**, you can add a folder by path, remove one, or select **Reset default**. OMMS writes skill files only inside a watched folder.

## Ranking

The **Skills** page lists each skill with its uses (U) in the last 30 days, the turns with a failed tool call (F), an attention score, its last use and its mode. A failed tool call counts only when it came after the skill was used in that turn. A skill invoked by a slash command counts every failed tool call in the turn. The attention score is (F + 1) / (U + 2), rounded to two decimals. A skill with little evidence stays near the middle, and a skill that fails often rises towards 1.

The Skills page sorts the list in the browser by **Most used**, **Needs attention**, **Name (A–Z)**, **Last used**, **Failed turns** or **Last modified**, in either direction. It shows 5 skills on each page and remembers the page size and sort. In the terminal, use `skills list --order attention`. The API takes `GET /api/skills?order=attention`. See [Web UI: Skills page](web-ui.md#skills-page) for the paging controls, the charts and the history timeline.

Each skill row from `GET /api/skills` and from `GET /api/skills/skill` has two more fields. `modified` is true while at least one proposal of the skill is in the state `applied`. An undone, rejected, stale or pending proposal does not count. `lastAppliedAt` is the epoch time in milliseconds of the newest applied proposal, or `null` when `modified` is false. A proposal belongs to a skill by its path. A proposal with no path belongs to the skill with no path that has the same name. One query reads the applied proposals for the whole list.

A skill in a watched folder shows **Suggested** when it has 5 or more uses, an attention score of 0.3 or more, and a failed turn since its last draft or review. A draft that proposes no change also counts, so the badge goes away until a new failed turn arrives. A skill with 1 use and 1 failure has attention 0.67 and is not Suggested, because it has fewer than 5 uses.

A skill your agents used that is not in a watched folder shows **Not in a watched folder**. OMMS cannot draft it until you add its folder.

## Drafting

Open a skill and select **Draft improvement**. OMMS sends the current `SKILL.md` and up to 20 recent turns that used it to the external API model. The draft appears as a proposal with a summary, a line diff and the turns it used as evidence.

**Find new skill ideas** sends a short list of recent turns and your skill names. It returns up to three ideas. Choose one, pick a watched folder, and select **Draft skill**.

Each draft is one external API call. Set up the model in the **External API** card on the Settings page first. A draft can take a few minutes; the page shows **Drafting…** with a spinner until it ends. If a draft fails, OMMS logs a reason code and waits 10 minutes before automatic review tries again. When the model's reply is not valid JSON, the page says **Try again**, and the log records why the model stopped (`stopReason`) and where the JSON broke (`jsonErrorAt`), never the reply text. Profile learning is not paused by a failed draft.

## Apply, reject and undo

A pending proposal offers **Apply** and **Reject**.

- **Apply** writes the new `SKILL.md`. OMMS first checks that the file has not changed since the draft. If you edited it by hand, the proposal becomes **Stale** and the file keeps your edit.
- **Reject** closes the proposal and leaves the file alone.
- **Undo** restores the previous version, or deletes a new skill. It works only while the file still matches what OMMS wrote. If you changed the file since, undo refuses and shows the saved version.

Undo checks the file against the content OMMS wrote for that one change. If a later change rewrote the file, undo of the older change refuses with `changed`. Undo the later change first.

## Web API for the Skills page

All routes are under `/api/skills`. Every number in a query is clamped to its range; a bad value uses the default.

| Route                       | Query                                                                                                                                                                            | Result                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/skills/skill`     | `path` or `name`; `turnLimit` (1 to 200, default 20); `turnOffset` (0 or more)                                                                                                   | The skill, `recentTurns`, `turnTotal`, `daily` (the last 30 UTC days, zero-filled) and its proposals (each with `canUndo`, as in `/api/skills/proposals`).                                                                                                                                                                                                                                                |
| `GET /api/skills/activity`  | `bucket` (`day`, `month` or `year`, default `day`); `days` (1 to 90, default 30); `month` (`YYYY-MM`, wins over `days`); `year` (default this year); `top` (1 to 100, default 8) | `bucket`; `series` (`{ key, uses, failed }` per UTC day `YYYY-MM-DD`, month `YYYY-MM` or year `YYYY`, oldest first, zero-filled); `days` (the day series as before, empty for months and years); `topSkills` (the `top` most used in the window); `topTotal` (skills used in the window); `totals` for the window; `available` (`months` with a use and `years` with a use plus this year, newest first). |
| `GET /api/skills/history`   | `path` or `name`; `limit` (1 to 200, default 20); `offset`                                                                                                                       | `total` and `entries`, newest first. A `name` without `path` matches only proposals that have no path. Each entry has a `kind` (`created`, `applied`, `rejected`, `undone` or `stale`), line counts, `canUndo` and `laterAppliedCount`.                                                                                                                                                                   |
| `GET /api/skills/proposals` | `state`, `skill`; optional `limit` and `offset`                                                                                                                                  | `proposals` and `total`. Without `limit` and `offset`, every proposal comes back. Each proposal also has `canUndo`: true only for an applied proposal that undo would accept now, false once a newer applied change rewrote the file.                                                                                                                                                                     |

For `/api/skills/activity`, a `month` gives every day of that UTC month, with future days as zeros. `bucket=month` gives exactly 12 months. `bucket=year` gives each year from the first recorded use to this year. An unknown `bucket`, or a `month` that is not `YYYY-MM` from 1970 on, returns 400 `invalid-args`, like an unknown `order` or `state`.

## Manual and automatic mode

Each skill is in **Manual** mode by default. A proposal waits until you apply it.

In **Automatic** mode, OMMS drafts and applies an improvement on its own once the skill has 10 new uses and at least 24 hours have passed since its last review. Choosing **Automatic** shows a warning and needs confirmation. Automatic review runs in the web app, so it waits while the web app is stopped. Every automatic change can be undone.

## Agents and the terminal

Pi, OpenCode and Claude Code have a `skills` tool. An agent can list skills, find ideas, draft, list and show proposals, apply, reject or undo them. An agent applies a proposal only when you ask.

The agent can also fix a skill itself, with no external API call:

1. `evidence` gives the skill's `SKILL.md`, its numbers and its newest recorded turns, failed ones first.
2. The agent writes a fixed `SKILL.md`.
3. `propose` saves it as a pending proposal. OMMS computes the diff from the file on disk. The agent shows you the diff.
4. `apply` writes the file only when you ask.

The recorded turn text enters the agent's own session on this path. The proposal shows **Written by the agent** in `show`.

The terminal command offers the same modes:

```bash
om-memory-system skills list
om-memory-system skills draft --skill s-web-search
om-memory-system skills proposals --state pending
om-memory-system skills apply --id <proposal id>
om-memory-system skills evidence --skill s-web-search
om-memory-system skills propose --skill s-web-search --summary "Explain the curl failure" --content-file fixed.md
```

See [CLI](cli.md#skills-and-proposals) for every mode and flag.

## Delete recorded turns

Select **Delete recorded turns** on the Settings card, or run:

```bash
om-memory-system skills delete-turns --yes
```

This deletes every recorded turn with its tool calls and skill uses, then compacts `skills.db` so the deleted text does not stay in the file. Proposals and saved skill versions stay. Turning recording off does not delete turns.

## Known limits

- OpenCode with `chatMessage.enabled` off saves no prompts, so it records no skill turns.
- The skill view has no address of its own. Reloading the Skills page returns to the list.

The design is recorded in [ADR-036](adr/036-skill-learning-stores-full-turns-in-skills-db.md).
