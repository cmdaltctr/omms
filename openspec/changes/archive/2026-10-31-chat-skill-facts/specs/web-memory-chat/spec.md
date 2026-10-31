## ADDED Requirements

### Requirement: Skill facts are used only when skill learning is on

The chat SHALL use skill facts as a source only while the global `skillLearning` setting is `true`. A project config SHALL NOT turn it on for the chat. While `skillLearning` is off, the chat SHALL NOT open `skills.db`, and the plan request, the plan tool, the answer request, the saved plan and the saved sources SHALL be the same as they are without this capability.

#### Scenario: Skill learning off

- **WHEN** `skillLearning` is `false` and the user asks "which skills need work?"
- **THEN** the plan and answer requests SHALL hold no skill names and no skill fields
- **AND** the answer SHALL have no `K` source
- **AND** `skills.db` SHALL NOT be opened

#### Scenario: Skill learning on

- **WHEN** `skillLearning` is `true` and the user asks "which skills need work?"
- **THEN** the plan request SHALL hold the skill names

#### Scenario: Project config cannot turn it on

- **WHEN** the global `skillLearning` is `false` and a project config sets it to `true`
- **THEN** the chat SHALL NOT open `skills.db`

### Requirement: The plan can name skills and a skill question type

While skill facts are on, the chat SHALL send the names of the ranked skills to the plan call, at most 100, most used first. The plan SHALL be able to return the skill names the question is about and one skill question type: `needs-work`, `most-used`, or none. The chat SHALL drop any returned name that is not a ranked skill, ignoring case, and SHALL treat an unknown type as none.

#### Scenario: Unknown skill dropped

- **WHEN** the plan returns the skills `s-web-search` and `made-up-skill`, and only `s-web-search` is ranked
- **THEN** the sources SHALL include `s-web-search`
- **AND** SHALL NOT include `made-up-skill`

### Requirement: Only safe skill names are used

The chat SHALL use a skill name only if it matches `^[A-Za-z0-9][\w.:-]{0,63}$` and the summary scrub leaves it unchanged. It SHALL drop every other name before it builds the plan prompt, accepts a plan name, matches the question or saves a source.

#### Scenario: Name taken from a folder

- **WHEN** a ranked skill is named `sam` from the file `/Users/sam/SKILL.md`, and another is named `my skill (draft)`
- **THEN** the plan prompt SHALL NOT hold `my skill (draft)`
- **AND** a name that the scrub changes SHALL NOT become a source

#### Scenario: Long name

- **WHEN** a ranked skill name has 200 characters
- **THEN** the plan prompt SHALL NOT hold it

### Requirement: Two skills with the same name give one source

When two ranked skills share a name, the chat SHALL build one source from the row with the most uses, and from the first row in ranking order on a tie. It SHALL read the history of that row.

#### Scenario: Same name twice

- **WHEN** two watched skills are named `s-commit`, with 3 uses and 8 uses
- **THEN** there SHALL be one `s-commit` source with 8 uses
- **AND** its history SHALL come from the row with 8 uses

### Requirement: Skill names in the question are used when the plan is skipped

While skill facts are on and the plan is skipped, the chat SHALL use the ranked skill names that are written in the question as whole words, ignoring case. It SHALL ignore names shorter than 3 characters. It SHALL NOT guess a skill question type.

#### Scenario: Plan skipped

- **WHEN** the planning call times out and the question is "why does s-web-search fail?"
- **THEN** the sources SHALL include the skill `s-web-search`

### Requirement: Skill sources follow the plan order and the question type

The chat SHALL add the named skills first, in plan order. For the type `needs-work` it SHALL then add skills that have at least one failed turn in the 30-day window, highest attention first. For the type `most-used` it SHALL then add skills that have at least one use, most uses first. It SHALL NOT add a skill twice.

#### Scenario: Needs work

- **WHEN** skill A has 6 uses and 4 failed turns, skill B has 40 uses and 0 failed turns, and the plan returns the type `needs-work`
- **THEN** the sources SHALL include A
- **AND** SHALL NOT include B

#### Scenario: Named skill first

- **WHEN** the plan returns the skill `s-commit` and the type `needs-work`
- **THEN** `s-commit` SHALL be `K1`

### Requirement: Skill sources are bounded and keep memory places

An answer SHALL have at most 6 skill sources. The memory and profile limits SHALL NOT change, and skill sources SHALL NOT count toward them. Skill counts SHALL cover all projects in the last 30 days, whatever the scope of the question.

#### Scenario: Limit

- **WHEN** 9 skills have failed turns and the plan returns the type `needs-work`
- **THEN** the answer SHALL have 6 skill sources

#### Scenario: Memories keep their places

- **WHEN** a question finds 12 memories and 6 skill sources
- **THEN** all 12 memories SHALL be sent as sources

### Requirement: A skill source holds facts only

Each skill source SHALL be one skill. It SHALL hold the skill name, its uses and failed turns in the 30-day window, its attention score, whether it is modified, the time it was last applied, and at most its 5 newest history entries, each with its kind, time, summary and who applied it. It SHALL NOT hold turn text, prompts, replies, tool-call text or output, file paths, or the `SKILL.md` body.

#### Scenario: No skill path saved

- **WHEN** an answer cites a skill source
- **THEN** the saved source SHALL hold the skill name
- **AND** SHALL NOT hold the path of its `SKILL.md`

#### Scenario: Saved with its own allow-list

- **WHEN** an answer with a skill source is saved
- **THEN** the saved source SHALL keep its `skill` facts: name, uses, failed turns, attention, modified, last applied time, and history entries with kind, time, summary and applied by
- **AND** any other field in the source or inside `skill` SHALL be dropped

#### Scenario: Modified skill

- **WHEN** a skill has one applied proposal in place
- **THEN** the saved fact `modified` SHALL be true
- **AND** `lastAppliedAt` SHALL be the update time of the newest applied proposal

#### Scenario: Proposal undone

- **WHEN** the only applied proposal of a skill is undone
- **THEN** the saved fact `modified` SHALL be false
- **AND** `lastAppliedAt` SHALL be null

### Requirement: Skill change summaries are scrubbed before they are sent or saved

Before a summary is sent or saved, the chat SHALL remove `<private>` text, redact secrets, and replace the home folder, the OS user name, every absolute path (including `~/` and Windows drive-letter paths with spaces), every `file:` URL and every email address with markers. It SHALL cut the summary to 200 characters. It SHALL do this whatever `skillLearningRedact` is set to. `chats.db` SHALL hold no home folder, no OS user name, no absolute path and no email address from skill facts.

#### Scenario: Path in a summary

- **WHEN** a proposal summary reads "Fixed the step in /Users/sam/.agents/skills/s-web-search/SKILL.md"
- **THEN** neither the answer request nor `chats.db` SHALL contain `/Users/sam`

#### Scenario: Windows path with spaces

- **WHEN** a summary reads "Edited C:\Users\John Smith\x\SKILL.md"
- **THEN** neither the answer request nor `chats.db` SHALL contain `Smith\x`

#### Scenario: User name in plain text

- **WHEN** a summary names the OS user in a sentence
- **THEN** the answer request and `chats.db` SHALL NOT contain that user name

#### Scenario: Secret in a summary

- **WHEN** an agent-written summary contains an API key
- **THEN** the answer request and the saved source SHALL hold the redaction marker in place of the key

### Requirement: Chat answers without skill facts when skills.db cannot be read

When `skills.db` cannot be read, or has a newer schema version than this OMMS supports, the chat SHALL answer the question without skill sources and SHALL NOT fail it. The answer SHALL show a short note that skill facts could not be read. The chat SHALL NOT write to `skills.db`.

#### Scenario: Newer skills.db

- **WHEN** `skillLearning` is on and `skills.db` has a newer schema version
- **THEN** the chat SHALL answer from memories and profile items
- **AND** **How I searched** SHALL say that skill facts could not be read

#### Scenario: Saved answer with a newer skills.db

- **WHEN** the user opens a saved answer that cites a skill and `skills.db` has a newer schema version
- **THEN** the page SHALL open without an error
- **AND** no skill SHALL be marked as no longer listed

#### Scenario: Unreadable skills.db

- **WHEN** reading `skills.db` throws an error
- **THEN** the question SHALL still get an answer or the nothing-found reply

### Requirement: The citation legend names each source letter

The chat page SHALL show a legend that names each citation letter: `S` "memory (a note saved from your sessions)", `P` "profile item (a preference, pattern or workflow)", and `K` "skill (usage and change history)". The `K` item SHALL show only while skill facts are on or when the open conversation holds a skill source. Each letter SHALL have its own colour, the same in the legend and in the citations.

#### Scenario: Skill learning on

- **WHEN** `skillLearning` is on and the user opens the chat page
- **THEN** the legend SHALL show the `S`, `P` and `K` items

#### Scenario: Skill learning off

- **WHEN** `skillLearning` is off and the open conversation has no skill source
- **THEN** the legend SHALL show only the `S` and `P` items

#### Scenario: Chip colour inside the answer

- **WHEN** an answer text cites `K1` in light mode and in dark mode
- **THEN** the chip SHALL have the class `cite-skill`
- **AND** its colour SHALL match the `K` item in the legend and differ from `S` and `P`

## MODIFIED Requirements

### Requirement: Answers come only from cited sources

The chat SHALL number the sources it finds: `S1`, `S2`, … for memories, `P1`, `P2`, … for profile items, `K1`, `K2`, … for skill sources. It SHALL ask the model to answer only from them and to cite them, and SHALL remove any citation to a source it did not send. When it finds no source, it SHALL say it found nothing relevant and SHALL NOT call the model. When the model says the sources do not answer the question, the chat SHALL say so.

#### Scenario: Invented citation

- **WHEN** the answer cites `S9` and only `S1` to `S4` were sent
- **THEN** the shown answer SHALL NOT contain a citation to `S9`

#### Scenario: Invented skill citation

- **WHEN** the answer cites `K4` and only `K1` and `K2` were sent
- **THEN** the shown answer SHALL NOT contain a citation to `K4`

#### Scenario: Nothing found

- **WHEN** the search returns no memory, no profile source and no skill source
- **THEN** the chat SHALL reply that it found nothing relevant in the scope
- **AND** no answer call SHALL be made

#### Scenario: Only skill sources

- **WHEN** the search returns no memory and no profile source, and returns one skill source
- **THEN** the chat SHALL make the answer call with that skill source

### Requirement: Citations open their source

Each citation in an answer SHALL be a control that opens its source. A memory source SHALL show its text, project, date and tags, and link to the memory in Project memories. A profile source SHALL show its section, category, description and evidence. A skill source SHALL show its name and a table of its saved facts, and say the counts cover 30 days in all projects. The answer SHALL list its cited sources below the text.

#### Scenario: Open a memory citation

- **WHEN** the user activates the `S2` citation
- **THEN** a dialog SHALL show the S2 memory's text, project, date, and tags

#### Scenario: Open a skill citation

- **WHEN** the user activates the `K1` citation
- **THEN** a dialog SHALL show the K1 skill's name, uses, failed turns, attention, modified state and history entries
- **AND** the modified row SHALL read "Yes" with the last applied date while an applied proposal is in place, and "No" otherwise

#### Scenario: Source deleted later

- **WHEN** the user opens a saved answer whose cited memory was deleted after the answer
- **THEN** the dialog SHALL show the text saved with the answer
- **AND** SHALL say that the memory no longer exists

#### Scenario: Skill removed later

- **WHEN** skill learning is on and the user opens a saved answer whose cited skill is no longer listed
- **THEN** the citation SHALL be struck through, in the answer text and in the dialog
- **AND** the dialog SHALL show the facts saved with the answer and say that the skill is no longer listed

### Requirement: Each answer shows how it searched

Each answer SHALL show the search phrases, tags, and profile categories that were used, and whether the plan was skipped. When skill facts were on for the answer, it SHALL also show the skill names and the skill question type that were used, and SHALL say when skill facts could not be read.

#### Scenario: Search details

- **WHEN** an answer was produced with the phrases `bun install error` and the tag `bun`
- **THEN** the answer SHALL show those phrases and that tag

#### Scenario: Skill search details

- **WHEN** an answer was produced with the skill `s-web-search` and the type `needs-work`
- **THEN** the answer SHALL show that skill and that type

### Requirement: The chat file can be copied to another computer

`chats.db` SHALL hold every conversation's data by itself, with no other file needed once the web app has stopped. The chat SHALL NOT write absolute paths, user names, or email addresses into its own fields: titles, scope tags, project names, project tags, search plans, and timestamps. Cited source snapshots SHALL keep the memory or profile text exactly as it was when the answer was written, so that text can contain whatever the user's memories contain, such as folder paths. Cited skill source snapshots SHALL keep their scrubbed facts, and a copy to another computer SHALL show them. The docs SHALL warn that the file holds copies of memory text and must not be committed to Git or shared. It SHALL record its schema version. When a copied `chats.db` is placed in another computer's OMMS data folder while that web app is stopped, the chat page on that computer SHALL list the same conversations with their answers, citations, and search details.

#### Scenario: Copy to a second computer

- **WHEN** the user stops the web app, copies `chats.db` to another computer's OMMS data folder, and starts the web app there
- **THEN** the chat page SHALL list every copied conversation
- **AND** each citation SHALL open its saved source

#### Scenario: Skill source in a copied file

- **WHEN** an answer with a `K1` skill source is copied to a second computer where `skillLearning` is off
- **THEN** the `K1` citation SHALL open the saved skill facts

#### Scenario: Project with the same git remote

- **WHEN** a copied conversation's scope is a project whose git remote also exists on the second computer
- **THEN** the next question in that conversation SHALL search that project

#### Scenario: Project missing on the second computer

- **WHEN** a copied conversation's scope matches no project on the second computer
- **THEN** the conversation SHALL show that the project is not on this computer
- **AND** saved answers SHALL still open their sources
- **AND** the next question SHALL ask the user to choose a scope

#### Scenario: File from a newer OMMS

- **WHEN** the copied `chats.db` has a newer schema version than this OMMS supports
- **THEN** the chat page SHALL show the conversations as read-only
- **AND** SHALL say that OMMS needs an upgrade to continue them

#### Scenario: File from an older OMMS

- **WHEN** the copied `chats.db` has an older schema version
- **THEN** OMMS SHALL update the file in place and keep every conversation
