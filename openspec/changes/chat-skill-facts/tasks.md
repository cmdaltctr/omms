# Tasks

Implementation starts after pull request #206 (`feat/skills-modified`) merges into `main`. That pull request adds `modified` and `lastAppliedAt` to each ranked skill. The user approved decisions 12 to 15 in `design.md`. No question is open. The tasks below follow those decisions.

## 1. Prerequisites and decision record

- [ ] 1.1 After pull request #206 merges, rebase `feat/chat-skills` on `main`. Verify that `rankSkills` returns `modified` (boolean) and `lastAppliedAt` (epoch ms or null) with the meanings in design decision 15, and that `bun run typecheck` passes. Start group 2 only after this check
- [ ] 1.2 Write `docs/adr/037-chat-reads-skill-facts-from-skills-db.md`: the chat reads counts and scrubbed change history only, only while `skillLearning` is on, never turn text, never writes. It amends decision 4 of ADR-036. It also amends decision 3 of ADR-032 (the allowed source fields): `skill` joins the list with its own nested allow-list (design decision 17). Add it to `docs/adr/ADR_README.md`. Add "Decision 4 amended by ADR-037" to the status line of ADR-036 and "Amends ADR-032 decision 3" to the status line of ADR-037, and "Decision 3 amended by ADR-037" to the status line of ADR-032. Verify that Prettier passes on the four files
- [ ] 1.3 Update the `skills.db` bullet in the Security section of `AGENTS.md` (`CLAUDE.md` links to it): the memory chat reads skill counts and scrubbed summaries while `skillLearning` is on, and no turn text. Update `CONTRIBUTING.md` if it repeats the rule. Verify by reading the rendered section

## 2. Skill facts module (pure)

- [ ] 2.1 Write failing tests in `tests/chat-skills.test.ts` for summary scrubbing: `<private>` text removed, an API key redacted, `/Users/sam/x/SKILL.md`, `~/a/b` and `C:\Users\sam\x` become `[path]`, `C:\Users\John Smith\x` leaves no `Smith\x`, the home folder (`os.homedir()`) and the OS user name (`os.userInfo().username`) in plain text are replaced, a `file:` URL is replaced, `user:pass@` and the query string are stripped from an `https:` URL that otherwise stays, an email becomes `[email]`, and a 500-character summary is cut to 200. Run the file and confirm that each test fails
- [ ] 2.2 Write failing tests for selection: named skills first in plan order, unknown names dropped ignoring case, `needs-work` skips skills with 0 failed turns and sorts by attention, `most-used` skips skills with 0 uses, no duplicates, at most 6, and, when two rows share a name, the row with the most uses wins (the first in index order on a tie) and `skillHistory` is called with that row's path. Confirm that each test fails
- [ ] 2.3a Write failing tests for name safety: a name that does not match `^[A-Za-z0-9][\w.:-]{0,63}$`, a name longer than 64 characters, and a name that the scrub changes (for example `sam` from `/Users/sam/SKILL.md` when `sam` is the OS user name) are dropped from the plan prompt, from plan validation, from name matching and from sources. Confirm that each test fails
- [ ] 2.3 Write failing tests for name matching when the plan is skipped: whole token, ignoring case, names under 3 characters ignored, `s-web-search` not matched inside `s-web-search-v2`. Confirm that each test fails
- [ ] 2.4 Write failing tests for fact building: the source has `kind: "skill"`, `id` set to the name, the facts from design §4, at most 5 history entries, no `path`, no `versionId`, no `canUndo`, and a `text` block under 1,300 characters for 5 entries of 200 characters. Confirm that each test fails
- [ ] 2.5 Add `src/services/chat/chat-skills.ts` with the scrub, select, match and build functions. Take rankings, history entries and config values as arguments; do not import `CONFIG`. Verify that tests 2.1 to 2.4 pass and that the file is under 500 lines

## 3. Plan fields

- [ ] 3.1 Write a failing test in `tests/chat-plan.test.ts` that, with no skill names given, `buildPlanPrompt` returns exactly the current system and user text and the plan tool is the current `PLAN_TOOL` object, compared with a fixed copy of today's strings. Confirm that the test fails when one word of the skill text leaks into the gate-off prompt
- [ ] 3.2 Write failing tests: with skill names given, the prompt holds at most 100 names, most used first; the tool has optional `skills` and `skillIntent`; `validatePlan` drops unknown names and turns an unknown intent into none; a skipped plan has no skill fields. Confirm that each test fails
- [ ] 3.3 Implement the plan changes in `chat-plan.ts` and the optional `ChatPlanRecord` fields in `chat-types.ts`. Verify that tests 3.1 and 3.2 and the existing `chat-plan` tests pass

## 4. Answer prompt and citations

- [ ] 4.1 Write failing tests in `tests/chat-answer.test.ts`: skill sources are numbered `K1`, `K2` after `S` and `P`; `describeSource` sends the skill `text`; `[K4]` is removed when only `K1` and `K2` were sent; `[K1]` is removed when no `K` source was sent. Confirm that each test fails
- [ ] 4.2 Change `numberSources`, `describeSource`, the system text (gate on only) and the marker to `[SPK]` in `chat-answer.ts`. Verify that tests 4.1 and the existing `chat-answer` tests pass
- [ ] 4.3 Write failing tests for the web markers in `web/src/lib/chat-citations.ts` and `web/src/lib/chat-answer-html.ts` (extend `tests/web-chat-answer-html.test.ts`): a `[K1]` marker becomes a chip and stays escaped. Change both markers to `[SPK]`. Verify that the tests pass

## 5. Service, runtime and routes

- [ ] 5.1 Write a failing test in `tests/chat-service.test.ts` for the gate off: with no `skills` dependency, the plan request, the answer request, `plan_json` and `sources_json` equal those of a fixed run of today's code, a spy on the skill store sees no open, and the log record of the question equals the log record of today's code. Confirm that the test fails when the service calls the skill reader or adds a log field with the gate off
- [ ] 5.2 Write failing tests for the gate on: the plan gets skill names, `K` sources are saved with the answer, a question with only skill sources makes the answer call, and memories still get 12 places when 6 skill sources are found
- [ ] 5.3 Write failing tests for the failure mode: a `skills.db` with `schema_version` above `SKILL_SCHEMA_VERSION` and a reader that throws both give an answer with no `K` source, `skillFacts: "unavailable"` in the plan, the gate-off plan prompt, one log record with the reason code, and an unchanged `skills.db` (same bytes before and after)
- [ ] 5.4 Write a failing test that `chats.db` holds no home folder, OS user name, absolute path or email address from skill facts: set `skillLearningRedact` to `false`, seed a ranking with `path: "/Users/sam/.agents/skills/a/SKILL.md"` and a summary with that path and `sam@example.com`, ask a question, then read the raw `sources_json` and `plan_json` and assert that neither contains `/Users/`, `sam@` or `.agents/skills`. Add a case for a skill named `sam` from `/Users/sam/SKILL.md`, which must not reach the plan prompt or `sources_json`
- [ ] 5.4a Write a failing test in `tests/chat-store.test.ts` that a skill source survives save and reload with its `skill` facts (name, uses, failedTurns, attention, modified, lastAppliedAt, history entries with kind, at, summary, appliedBy), and that an extra field on the source or inside `skill` or a history entry (for example `path` or `versionId`) is dropped. Confirm that the test fails on today's `snapshot()`. Then add `skill` to `SOURCE_FIELDS` with the nested allow-list in `chat-store.ts` and verify that it passes
- [ ] 5.5 Wire the gate and the skill reader into `chat-service.ts` and `chat-runtime.ts`: add `skillLearning`, `claudeConfigDir`, the skill folders and the secrets to `ChatRuntimeConfig`. Build `skills` only when `skillLearning` is `true`. Find the file with `skillStoragePath(config)` and the folders with `watchedSkillFolders(config)` (which needs `claudeConfigDir`). Open `skills.db` with `existingDb()` and check the schema version without `init()`. Log counts and codes only. Verify that tests 5.1 to 5.4 pass and that `chat-service.ts` stays under 500 lines
- [ ] 5.6 Write failing tests in `tests/chat-routes.test.ts`: `GET /api/chat/status` returns `skillFacts` matching the global `skillLearning`; a project config with `skillLearning: true` does not turn it on; `GET` of a conversation returns `missingSkillNames` for a `K` source whose skill is no longer ranked, and an empty list, with no error, when the ranking cannot be read, when `skills.db` has a newer schema version, or when the gate is off. Implement them in `chat-status.ts` and `chat-routes.ts`. Verify that the tests pass

## 6. Chat page

- [ ] 6.1 Load the `omms-design` skill. Add the `K` item to `CitationLegend.tsx`, shown when `skillFacts` is on or the open conversation has a `K` source. Give `K` its own colour in `citationColours` (`CitationChip.tsx`). Write a failing test first for the visibility function (the four on/off and has-K cases), then implement it and verify that it passes
- [ ] 6.1a Write a failing test in `tests/web-chat-answer-html.test.ts` that `linkCitations` gives a `[K1]` chip the class `cite-skill` (and `P` still `cite-profile`, `S` neither). Then add the class in `web/src/lib/chat-answer-html.ts` and the light and dark rules in `web/src/app.css` next to `.cite-profile`, with the same colour as the `K` legend item. Verify that the test passes and check both modes in task 9.1
- [ ] 6.2 Write failing component tests first, then add the skill source view to `SourceDialog.tsx`: name, a table of uses, failed turns, attention, modified ("Yes, last applied <date>" or "No", with a note that "Yes" means an applied proposal is in place), up to 5 history rows (kind, time, summary, applied by), the "last 30 days in all projects" line, and the "no longer listed" note from `missingSkillNames`. Pass `missingSkillNames` to `AnswerBubble.tsx` (its `isDeleted` strikes through only memory chips today) and `ChatView.tsx` (its `SourceDialog` `deleted` prop checks only memory), so a deleted skill chip is struck through in the answer text and in the dialog. Use the web date and time format setting. Verify that the tests pass and that every touched file stays within `tests/file-size-ceiling.test.ts`
- [ ] 6.3 Write a failing test first: an old saved plan without skill fields renders as today, and a plan with skill fields shows them. Then show the skills, the skill question type and the "Skill facts could not be read" note in `SearchDetails.tsx`, and pass `missingSkillNames` through `chat-api.ts` and `MessageThread.tsx`. Verify that the test passes
- [ ] 6.4 Write the translation key test first (it fails while keys are missing), then add the translation keys in English, Chinese and Arabic: `chat-legend-skill` ("skill (usage and change history)"), the source view labels, the intent names, the two notes, and the chat privacy line under the question box that names skill facts. Verify that the test passes and that no key is missing in any language

## 7. Settings card

- [ ] 7.1 Write a failing Settings card test that the sentence shows when the switch is on, then add the sentence to the **Record agent turns** warning in the Skill learning card: the memory chat sends skill counts and short change summaries to the external API, and no turn text. Add it in English, Chinese and Arabic. Verify that the test passes

## 8. Documentation

- [ ] 8.1 Update `docs/web-ui-chat.md`: the `K` letter and legend, how skill sources are chosen, the limit of 6, the gate, the privacy note (what is sent and what is scrubbed), the source view, the "no longer listed" state, and the failure note. Verify that each statement matches the code and that Prettier passes
- [ ] 8.2 Update `docs/web-ui-settings.md` (the warning text) and `docs/skill-learning.md` (line 22 and the privacy section: the chat reads counts and scrubbed summaries while recording is on). Verify that `grep -rn "never read" docs/` has no hit that now contradicts the change
- [ ] 8.3 Add a note on the `K` chip colour and the skill source table to the `omms-design` skill in both copies: `.agents/skills/omms-design/SKILL.md` in the repository and `~/.agents/skills/omms-design/SKILL.md`. Verify that both files hold the same note

## 9. Verification

- [ ] 9.1 Browser check with `chrome-devtools` (or `orca-cli` if Chrome fails) on a free port, with `skillLearning` on and seeded skills: at 1280 px and at 390 px, ask "which skills need work?", open a `K` citation, open **How I searched**, and switch to Arabic. Verify with screenshots that the legend shows S, P and K, the table fits without horizontal scrolling at 390 px, and the layout is right to left in Arabic. Repeat with `skillLearning` off and verify that the legend shows only S and P
- [ ] 9.2 Run `bun run ci:local` in the worktree and confirm that it passes. Report any failure with the command and its output
- [ ] 9.3 Run `openspec validate chat-skill-facts --strict` and the `openspec-verify-change` skill. Resolve every finding

## Workflow follow-up

- Run `graphify update .` after the code changes.
- Archive the change with the `openspec-archive-change` skill before the pull request is created, only when every task above is done and task 9.3 passes.
