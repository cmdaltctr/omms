# ADR-038: The chat reads skill facts from skills.db

- **Date:** 2026-10-31
- **Status:** Accepted. Amends decision 3 of ADR-032 and decision 4 of ADR-036.
- **Deciders:** Aizat Hawari
- **Change:** [`chat-skill-facts`](../../openspec/changes/chat-skill-facts/proposal.md)

## Context

ADR-036 says the memory chat never reads `skills.db`. Users now ask the chat questions such as "which skills need work?" and "what changed in `s-web-search`?". The chat cannot answer them, because the facts are only on the Skills page.

The answer needs counts and a short change history for each skill. It does not need the recorded turns. Summaries of changes come from two writers. The drafting model writes them from turns that were redacted only when `skillLearningRedact` is on. An agent writes them through the `skills propose` mode with no redaction. So a stored summary can hold a secret, a path or an email address. The chat is a new destination for this text: the answer call goes to the external API, and the cited facts are saved in `chats.db`.

ADR-032 decision 3 lists the source fields that `chats.db` may keep. A skill source needs a new field.

## Decision

1. **The chat reads skill facts.** It reads, for each skill: the 30-day count of uses and failed turns, the attention score, whether an applied proposal is in place, the time of the newest applied proposal, and the newest 5 history entries (kind, time, summary, applied by). It never reads turn text, tool calls, tool errors or file paths.
2. **One gate: the global `skillLearning` value.** The chat reads `skills.db` only while `skillLearning` is on. A project config can turn it off but never on. With the gate off, the chat requests, the saved plan and the saved sources are the same as before this change.
3. **The chat never writes to `skills.db`.** It opens the file with `existingDb()`, which never creates it, and it never calls `init()`.
4. **The chat scrubs every summary and every skill name before it uses them.** The scrub runs whatever `skillLearningRedact` says. It removes `<private>` text and secrets, replaces the home folder, the OS user name, every absolute path and every email address, and cuts a summary to 200 characters. A skill name that the scrub changes, or that does not match `^[A-Za-z0-9][\w.:-]{0,63}$`, is dropped.
5. **A skill source has its own allow-list.** `skill` joins the source fields of ADR-032 decision 3. The nested object keeps `name`, `uses`, `failedTurns`, `attention`, `modified`, `lastAppliedAt`, and history entries with `kind`, `at`, `summary` and `appliedBy`. The chat never saves a path, a version id or a proposal id.
6. **A newer or unreadable `skills.db` never fails a question.** The chat answers without skill facts, marks the plan `skillFacts: "unavailable"`, and logs one record with a reason code and no text.
7. **No `chats.db` schema bump.** Skill sources fit in the existing JSON column. Their plain `text` keeps them readable in an older OMMS.

## Alternatives rejected

- **A new chat setting for skill facts.** It adds a second switch for the same consent. The user rejected it.
- **Read `skills.db` whenever the file exists.** Turning recording off would not stop the chat from sending skill facts.
- **Send summaries as stored.** Agent-written summaries are never redacted.
- **Turn excerpts with failed tool errors.** More useful, but it sends turn text to the external API. It needs its own switch and warning, and stays out of scope.
- **Bump the `chats.db` schema version.** Every older OMMS would open the whole file read-only.

## Consequences

- The Security section of `AGENTS.md`, `CONTRIBUTING.md`, `docs/skill-learning.md` and the Settings warning say that the chat reads skill counts and scrubbed summaries while recording is on.
- Skill counts cover all projects, whatever the chat scope is. The source view says so.
- The scrub is a filter, not a proof. A summary can still name a person or a private project in plain words. The Settings warning and the chat privacy line say that summaries are sent.
