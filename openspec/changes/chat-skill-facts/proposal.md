# Proposal: Skill facts in the web chat

## Why

Skill learning counts how often each skill is used, how often it fails, and how it changed. The web chat cannot see any of it. A question such as "which skills need work?" or "what changed in `s-web-search`?" gets no answer, although the facts are in `skills.db`. The user approved option 2: give the chat a small, fact-only skill source.

## What Changes

- **New source kind: skill facts.** Each source is one skill. It holds the skill name, its uses and failed turns in the 30-day window, its attention score, whether it is modified and when it was last applied, and its recent history entries (kind, time, summary, applied by). It holds no turn text, prompts, replies, tool-call text or output, file paths or `SKILL.md` body.
- **New citation letter `K`.** Skill sources are numbered `K1`, `K2`, … beside `S` (memory) and `P` (profile). A `K` citation to a source that was not sent is removed, like `S` and `P`.
- **Legend and source view.** The citation legend gets "K: skill (usage and change history)" in the style of the S and P items. Selecting a `K` citation opens a small table of the saved facts. A skill that was deleted or renamed after the answer is shown like a deleted memory: struck through, with the saved facts.
- **Plan fields.** When skill facts are on, the plan call also gets the real skill names. It can return `skills` (names the question is about) and `skillIntent` (`needs-work` or `most-used`). Unknown names are dropped, like tags. When the plan is skipped, skill names written in the question are matched instead.
- **Bounded.** At most 6 skill sources per answer. The memory limit (12) and the profile limit (6) stay as they are, so skill sources never take a memory's place.
- **Opt-in through the existing setting.** Skill facts are used only when the global `skillLearning` setting is on. When it is off, the chat behaves exactly as today: same prompts, same plan tool, no `K` sources, and `skills.db` is not opened.
- **Privacy.** Proposal summaries are model-written or agent-written text. Before they are sent or saved, the chat always removes `<private>` text, redacts secrets, replaces the home folder, the OS user name, paths and email addresses with markers, and trims each summary to 200 characters. Skill names must match a safe pattern. `chats.db` stays free of a home folder, an OS user name, absolute paths and email addresses in what the chat writes. The saved `skill` object has its own allow-list of fields.
- **Failure mode.** When `skills.db` cannot be read, or is from a newer OMMS, the chat answers without skill sources and shows a short note in **How I searched**. It never fails the question.
- **Consent text.** The **Record agent turns** warning on the Settings page also says that the chat sends skill facts to the external API.
- **Decision record.** A new ADR records that the chat reads fact-only data from `skills.db`. It amends decision 4 of ADR-036, which says that the memory chat never reads `skills.db`. It also amends decision 3 of ADR-032 (the allowed source fields).

Out of scope:

- Option 3: turn excerpts, failed tool-call error texts, and prompt snippets as chat sources.
- A new Settings switch for skill facts. `skillLearning` is the only gate.
- Any change to `skills.db`: its schema, its tables, or what it records. The chat only reads it.
- Hosts other than the web app. The chat is web-only, so host parity does not apply.
- The Skills page.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-memory-chat`: a third source kind (skill facts) with its own citation letter, legend item, answer chip class, source view, plan fields, opt-in rule, privacy rules and failure mode. The `chats.db` copy requirement is modified so that skill sources survive a copy.
- `skill-learning-capture`: the rule that the memory chat never reads `skills.db` changes. The chat may read skill counts and change history from it, read-only, only while `skillLearning` is on.
- `web-skills`: the **Record agent turns** warning also names the chat as a reader that sends skill facts to the external API.

## Impact

- **Dependency:** the `modified` and `lastAppliedAt` fields on each ranked skill come from the separate pull request #206 (`feat/skills-modified`). `modified` is true while at least one applied proposal is in place. `lastAppliedAt` is the update time of the newest applied proposal, or null. Implementation starts after #206 merges into `main`.
- **Changed code:** `src/services/chat/` (plan, retrieve, answer, service, runtime, routes, status, types), one new pure module for skill facts in `src/services/chat/`, and the chat web components (`CitationLegend`, `CitationChip`, `SourceDialog`, `SearchDetails`, `MessageThread`) with `web/src/lib/chat-citations.ts`, `web/src/lib/chat-answer-html.ts` and `web/src/lib/chat-api.ts`. The Settings card text in the skill-learning card.
- **Read-only use of skill-learning code:** `rankSkills` and `skillHistory` from `src/services/skill-learning/`. No skill-learning module writes anything for the chat.
- **Data:** no new file. `chats.db` keeps its schema version. Skill sources are saved inside the existing source snapshots of each answer.
- **Model cost:** no new model call. The plan and answer prompts grow by the skill names and at most 6 short fact blocks, only while `skillLearning` is on.
- **Translations:** new keys in English, Chinese and Arabic.
- **Docs:** `docs/web-ui-chat.md`, `docs/web-ui-settings.md`, `docs/skill-learning.md`, the `skills.db` bullet in the Security section of `AGENTS.md`, a new ADR-038 and `docs/adr/ADR_README.md`, and the `omms-design` skill (both copies).
