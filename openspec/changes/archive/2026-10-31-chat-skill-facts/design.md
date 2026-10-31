# Design: Skill facts in the web chat

## Context

See `proposal.md` for the reasons. Observed facts that shape the design:

- The chat runs in `src/services/chat/`. `askQuestion` (`chat-service.ts`) strips private text, plans (`chat-plan.ts`), retrieves (`chat-retrieve.ts`), numbers the sources and checks citations (`chat-answer.ts`), then saves the answer in `chats.db` (`chat-store.ts`). `chat-runtime.ts` builds the real dependencies from a config object that the caller passes. Chat modules do not import `CONFIG`.
- Sources are `ChatSource` objects with `kind: "memory" | "profile"`, saved in `chat_messages.sources_json`. `snapshot()` in `chat-store.ts` keeps only the fields in the `SOURCE_FIELDS` allow-list (ADR-032 decision 3) and drops every other field. So a new `skill` object is dropped unless the allow-list changes (decision 17). The plan is saved in `plan_json`. Neither column needs a schema change to hold a new kind or new optional fields.
- The answer prompt cuts each source to `MAX_SOURCE_CHARS` (2,000). The limits are 12 memories and 6 profile items.
- The server citation check uses `/\s*\[([SP]\d+)\]/g`. The web app has its own copies of the marker in `web/src/lib/chat-citations.ts` and `web/src/lib/chat-answer-html.ts`.
- `GET /api/chat/conversations/:id` returns `missingMemoryIds`, which the page uses to strike through a deleted memory.
- `rankSkills(store, index, now, order)` returns every watched and recorded skill with 30-day `uses`, `failedTurns`, `attention`, `lastUsedAt`, `path` and `mode`. `order` is `uses` or `attention`. After pull request #206 (`feat/skills-modified`) it also returns `modified` and `lastAppliedAt`. Decision 15 defines both.
- `skillHistory(deps, { path, name }, limit, offset)` returns history entries newest first with `kind`, `at`, `summary`, `appliedBy` (`person`, `agent` or `automatic`) and fields the chat does not need (`versionId`, `canUndo`, diff counts).
- `SkillStore.existingDb()` opens `skills.db` only when it exists, and never creates it. Only `init()` checks the schema version, and `init()` writes. The chat must not call `init()`.
- Summaries come from two writers. The drafting model writes them from turns that were redacted when `skillLearningRedact` is on. An agent writes them through the `skills propose` mode, with no redaction at all. So a stored summary can hold secrets, paths or email addresses.
- `redactTraceText(text, config)` in `src/services/capture-diagnostics.ts` removes `<private>` text, configured secrets and known secret patterns. It does not touch paths or email addresses.
- ADR-036 decision 4 and the `skill-learning-capture` spec say that the memory chat never reads `skills.db`. This change amends that rule.
- ADR-032 decision 3 lists the allowed source fields. This change amends that list (decision 17).
- Skill names are not trusted. A skill outside the watched folders gets its name from the raw `Skill` tool input (`skill-detect.ts`), or from the folder name of any `SKILL.md` that was read. A file such as `/Users/sam/SKILL.md` gives the name `sam`. Two watched skills can share a name, because `skill-index.ts` keeps both.

## Goals / Non-Goals

**Goals:**

- With `skillLearning` off, the chat request bytes, the plan tool, the saved plan and the saved sources are the same as today.
- A skill source holds only counts, dates, kinds, actors and short scrubbed summaries.
- A broken or newer `skills.db` never fails a question.

**Non-Goals:**

- Ranking skills by meaning (embeddings of skill names or summaries).
- Skill facts per project. Counts stay global, like the Skills page.
- Any write to `skills.db`.

## Decisions

### 1. One gate: the global `skillLearning` value

`chat-runtime.ts` builds a `skills` dependency only when the global `skillLearning` is `true`. `ChatServiceDeps.skills` is optional. When it is absent, `askQuestion` runs today's code path with no extra branch in the prompts. The plan uses the current `PLAN_TOOL` and system text. The answer uses the current system text.

The gate is the effective `skillLearning` value in the web server. In `src/config.ts` a project config can turn `skillLearning` off but never on. That is the safe direction: a project config can never switch skill facts on for the chat. Skill counts span all projects.

- **Alternative: a new chat switch.** Rejected by the user. It adds a setting for the same consent.
- **Alternative: always on when `skills.db` exists.** Rejected. Turning recording off must also stop the chat from sending skill facts.

### 2. How skill sources are chosen

Order of work for one question while the gate is on:

1. Read the ranking once (`rankSkills`, order `uses`). Keep only names that match `^[A-Za-z0-9][\w.:-]{0,63}$` and that the summary scrub (decision 5) leaves unchanged. Drop the rest. Deduplicate the names and cut the list to 100 (`MAX_PLAN_SKILLS`). The names go to the plan prompt as one line: `Skills: name, name, …`. Names only. No counts. With at most 100 names of at most 64 characters, the line stays under 6,600 characters.
2. The plan tool gains two optional fields: `skills` (array of names) and `skillIntent` (`"none"`, `"needs-work"` or `"most-used"`). Validation keeps names that match a safe ranked name, ignoring case, in the stored spelling (the same `known()` rule as tags). An unknown intent becomes `"none"`.
3. Named skills come first, in plan order.
4. The intent fills the remaining places:
   - `needs-work`: skills with at least 1 failed turn in the window, sorted by attention, then uses, then name. The failed-turn floor matters: a skill with no use has the prior attention of 0.5, which would rank it above a skill that fails often.
   - `most-used`: skills with at least 1 use, in the ranking's `uses` order.
5. Duplicates are dropped and the list is cut to 6 (`MAX_SKILL_SOURCES`).
6. When the plan is skipped, the chat matches skill names in the question text instead: case-insensitive, whole token (a name is bounded by start, end, space or punctuation other than `-`, `_` and `:`), names of 3 or more characters, only safe names. No intent is guessed.

The two intents map onto the two `SKILL_ORDERS` that the ranking already has, so neither needs new counting code.

When two ranking rows share a name, the row with the most uses wins. On a tie, the row that comes first in the ranking order wins. The source is built from that row, and `skillHistory` is called with that row's path. The source holds the name only, so the two cannot be told apart in the chat.

- **Alternative: phrase matching only, no plan fields.** Rejected. "Which skills need work?" names no skill, so phrase matching finds nothing.
- **Alternative: embed skill names and pick the closest.** Rejected. Names are short identifiers, and the plan model already reads the question.
- **Alternative: always add the top skills.** Rejected. Questions about memories would carry skill facts they do not need.

### 3. Source limits and prompt size

Skill sources have their own limit of 6. The memory limit (12) and the profile limit (6) do not change, and skill sources are counted apart from them. So a skill source never takes a memory's place. The total is at most 24 sources.

Each skill source is small by construction: a header line, 5 counts, and at most 5 history entries with a summary of at most 200 characters. That is about 1,300 characters at most, below `MAX_SOURCE_CHARS`. Six sources add at most about 8,000 characters to the answer prompt.

- **Alternative: one shared limit for all kinds.** Rejected. Skill sources would push out memories on mixed questions.

### 4. What a skill source holds

A skill source is a `ChatSource` with `kind: "skill"`, `label: "K<n>"`, `id` set to the skill name, and a new optional `skill` object:

| Field           | Source                               |
| --------------- | ------------------------------------ |
| `uses`          | ranking, 30-day window               |
| `failedTurns`   | ranking                              |
| `attention`     | ranking                              |
| `modified`      | ranking (from pull request #206)     |
| `lastAppliedAt` | ranking (from pull request #206)     |
| `history`       | newest 5 entries from `skillHistory` |

Decision 15 gives the meaning of `modified` and `lastAppliedAt`. Each history entry keeps `kind`, `at`, `summary` and `appliedBy`. `versionId`, `canUndo`, diff counts and proposal ids are dropped. The ranking `path` is never copied.

The saved `skill` object has its own allow-list (decision 17): `name`, `uses`, `failedTurns`, `attention`, `modified`, `lastAppliedAt` and `history` entries with `kind`, `at`, `summary` and `appliedBy`. Nothing else is saved.

`text` holds the same facts as plain lines. The answer prompt sends `text`, and an older OMMS that opens the file shows `text` as a plain source.

The counts cover all projects in the last 30 days, whatever the chat scope is. The source view says so.

The chat calls `skillHistory` as it is. It does a few file reads for `canUndo`, which the chat throws away. With at most 6 skills and 5 entries each, the cost is small, and the skill-learning code stays unchanged.

### 5. Summary and name scrubbing

Before a summary is sent or saved, the chat runs these steps in this order:

1. Replaces the real home folder (`os.homedir()`) with `[home]` and the OS user name (`os.userInfo().username`, 3 or more characters, any case) with `[user]`.
2. Treats `file:` URLs as paths and replaces them with `[path]`.
3. Strips user info (`user:pass@`) and query strings from other URLs. The rest of the URL stays.
4. Runs `redactTraceText` with the configured secrets. This removes `<private>` text and redacts secrets.
5. Replaces every absolute path with `[path]`: tokens that start with `/` and have two or more segments, tokens that start with `~/`, and Windows drive-letter paths such as `C:\`. A Windows path whose folder names hold spaces is replaced whole. So `C:\Users\John Smith\x` leaves no `Smith\x`.
6. Replaces email addresses with `[email]`.
7. Collapses white space and cuts the result to 200 characters, with `…` when cut.

The chat does this whatever `skillLearningRedact` says (decision 12). Decision 13 sets the breadth of step 5. Skill names go through the same scrub, and a name that the scrub changes is dropped (decision 2). The steps keep `chats.db` free of a home folder, an OS user name, an absolute path and an email address in what the chat writes.

- **Alternative: send summaries as stored.** Rejected. Agent-written summaries are never redacted, and the chat is a new destination.
- **Alternative: no summaries, kinds and times only.** Rejected. The user asked for summaries, and a history without them cannot answer "what changed?".

### 6. Plan record and "How I searched"

`ChatPlanRecord` gains three optional fields: `skills` (the names used), `skillIntent` and `skillFacts: "unavailable"`. They are written only while the gate is on, so a plan saved with the gate off has the same keys as today. **How I searched** shows the skills and the intent when present, and the note "Skill facts could not be read" when `skillFacts` is `"unavailable"`.

### 7. Citations

The server marker becomes `/\s*\[([SPK]\d+)\]/g`, and the two web copies change the same way. The rule is the same for every letter: a marker for a label that was not sent is removed. This holds with the gate off too. With the gate off the model gets no `K` source, so a `[K1]` in its reply names a source that was not sent and is removed, like `[S9]`.

"Nothing found" now means no memory, no profile item and no skill source. A question with only skill sources gets an answer call.

### 8. Deleted and renamed skills

`GET /api/chat/conversations/:id` adds `missingSkillNames`: the `K` source ids that the current ranking does not list. A renamed skill counts as missing under its old name once its old turns leave the 30-day window and its old folder is gone. The page strikes the chip through, in the answer text and in the source dialog, and the source view says "This skill is no longer listed. These facts were saved with the answer." The check runs only while the gate is on. If the ranking cannot be read, or `skills.db` has a newer schema version, no skill is marked missing and the route returns an empty list without an error, the same fallback as memories. The chat page strikes through only memory chips today (`AnswerBubble.tsx` and `ChatView.tsx`). Both change to cover skill chips.

### 9. Failure mode

The skill reader finds the file with `skillStoragePath(config)` and the watched folders with `watchedSkillFolders(config)`, which needs `claudeConfigDir`. It opens `skills.db` with `existingDb()` and reads `skill_meta.schema_version` before it ranks. A version above `SKILL_SCHEMA_VERSION`, or any thrown error, marks skill facts unavailable for that question. The plan then runs without skill fields (the gate-off prompt), the answer has no `K` source, and the plan record has `skillFacts: "unavailable"`. The log gets one record with a reason code (`newer_schema` or `read_failed`) and no text. A missing `skills.db` is not a failure: the ranking then lists watched skills with zero counts.

### 10. Legend, chip and source view

- The legend shows the `K` item when the chat status says skill facts are on, or when the open conversation holds a `K` source. `chatStatus` gains `skillFacts: boolean`.
- `K` chips get their own colour from the existing tokens, distinct from `S` (primary) and `P` (blue). The legend and source chips take it from `citationColours`. The chips inside the answer text take it from a CSS class: `linkCitations` in `chat-answer-html.ts` adds `cite-profile` for `P` today. It adds `cite-skill` for `K`, with light and dark rules in `web/src/app.css` that match the legend colour. The `omms-design` skill records the choice.
- The source view is a small table: uses, failed turns, attention, modified, then up to 5 history rows (kind, time, summary, applied by). The modified row reads "Yes, last applied <date>" or "No". A short note under it says that "Yes" means at least one applied proposal is in place. Times use the web date and time format setting.

### 11. Module layout

A new pure module, `src/services/chat/chat-skills.ts`, holds selection, fact building, scrubbing and name matching. It takes rankings, history entries and config values as arguments. `chat-runtime.ts` wires it to `rankSkills`, `skillHistory`, `getSkillIndex` and the config passed in. This keeps `chat-service.ts` and `chat-plan.ts` under the 500-line ceiling and follows the rule that new logic gets `CONFIG` as an argument.

### 12. Summaries are always scrubbed for the chat

The chat scrubs every summary, whatever `skillLearningRedact` says. The user may turn redaction off for drafting, and the Settings page says that drafting then sends turns to the external API. The chat is a new destination, so it applies its own scrub. The scrub removes `<private>` text, redacts secrets, replaces paths and email addresses, and cuts the summary to 200 characters.

### 13. The path filter covers every absolute path

The filter replaces every absolute path, every `~/` path and every Windows drive-letter path, not only home-folder paths. A path to a shared folder can still name a client or a project. The specs require "no absolute path". The regex can be tuned later without a spec change.

### 14. No `chats.db` schema version bump

`K` sources live inside the existing JSON column. Their plain `text` keeps them readable in an older OMMS. A version bump would make every older OMMS open the whole file read-only.

### 15. Meaning of `modified` and `lastAppliedAt`

Pull request #206 defines both fields in `src/services/skill-learning/ranking.ts`. The code and its tests confirm these meanings:

- `modified` is true while at least one applied proposal is in place for the skill. An undone, rejected, stale or pending proposal does not count. Undo clears it.
- `lastAppliedAt` is the `updated_at` (epoch ms) of the newest applied proposal. It is null when the skill is not modified.
- A proposal matches a skill by path. A proposal with no path matches only a skill with no path and the same name.

The source view uses this meaning in its label (decision 10). Task 1.1 verifies that the fields exist with these meanings after #206 merges.

### 16. Skill names are checked before use

Only names that match `^[A-Za-z0-9][\w.:-]{0,63}$` and that the scrub leaves unchanged are offered to the plan, accepted from the plan, matched in a skipped plan, or saved as a source `id`. The chat drops every other name. This also bounds the plan prompt. See decisions 2 and 5.

### 17. The saved `skill` object has its own allow-list

`snapshot()` in `chat-store.ts` keeps only listed fields. The change adds `skill` to `SOURCE_FIELDS` and gives it a nested allow-list (see decision 4). A hostile or future field inside `skill` is dropped on save. ADR-038 amends ADR-032 decision 3 with this list. The `chats.db` copy requirement is modified so that skill sources survive a copy to another computer.

## Risks / Trade-offs

- [Summaries can still name a person or a private project in plain words] → Scrubbing removes `<private>` text, secrets, paths and email addresses only. The Settings warning and the chat privacy note say that summaries are sent. Turn excerpts (option 3) stay out of scope.
- [The plan model picks a skill the question does not need] → At most 6 sources, each about 1,300 characters. The answer model cites only what it uses.
- [`skillHistory` reads skill files for `canUndo`] → At most 30 entries per question. If it shows up in timings, export the pure entry builder from `history.ts` instead.
- [An older OMMS opens a `chats.db` with `K` sources] → `text` holds the facts as plain lines, so the older page shows a plain source. The `K` chip uses the default colour there.
- [Skill names come from untrusted input] → Decision 16 limits them to a safe pattern and the scrub.
- [Pull request #206 changes `modified` or `lastAppliedAt` before it merges] → Implementation starts after #206 merges into `main`. Task 1.1 checks the fields at that point.
- [The skill name list grows past 100] → The plan gets the 100 most used. A rarer skill can still be found by phrase matching when the plan is skipped, or by a later question that names it.

## Migration Plan

No data migration. `chats.db` keeps schema version 1 (decision 14). Rollback: revert the change. Saved `K` sources then show as plain sources through their `text`.

## Proposed issues, not in this change

A reviewer found two minor points (each likelihood 2, impact 2, product 4). The proposal already fixes both, so no issue is open.

1. The MODIFIED "Citations open their source" requirement now keeps the baseline words "in Project memories" and "below the text".
2. Tasks 6.1 to 6.4 and 7.1 now write the failing test first.
