## ADDED Requirements

### Requirement: Each Pi prompt recall is kept as a summary

When the Pi adapter adds a non-empty `<omms-retrieval>` section at `before_agent_start` in Pi's interactive terminal mode, it SHALL record one recall summary for the current session. The summary SHALL be built by the shared recall-summary builder and SHALL use mode `search` with the prompt as its query. A retrieval that yields no section, a retrieval that fails, and a section with no memory entries SHALL NOT record a summary.

#### Scenario: A prompt recall records a summary

- **WHEN** the user sends a prompt in Pi's interactive terminal and retrieval yields a section with 3 memories
- **THEN** the adapter SHALL record one summary with `mode=search`, the prompt as query and 3 entries

#### Scenario: No section

- **WHEN** retrieval yields no section, or fails
- **THEN** the adapter SHALL record no summary for that prompt

#### Scenario: No opening recall on Pi

- **WHEN** a Pi session starts
- **THEN** the adapter SHALL record no `recent` summary

### Requirement: Non-interactive Pi runs record no summary

The Pi adapter SHALL record and draw recall rows only when Pi runs in its interactive terminal mode (`ctx.mode` is `tui`), as OpenCode draws rows only where the host's interactive UI exists. In RPC, JSON and print modes it SHALL record no summary and draw nothing, not even plain text. Child agent sessions that a parent Pi starts fall under this rule.

#### Scenario: A subagent child session

- **WHEN** OMMS runs inside a Pi child session started with `--mode rpc`
- **THEN** the adapter SHALL record no summary and SHALL draw no row

#### Scenario: An RPC client

- **WHEN** a client drives Pi with `--mode rpc` and sends a prompt
- **THEN** the adapter SHALL record no summary and SHALL emit no widget or text for a row

#### Scenario: A print run

- **WHEN** OMMS runs inside `pi -p` or `--mode json`
- **THEN** the adapter SHALL record no summary and SHALL draw no row

### Requirement: The session keeps a bounded list of summaries

The adapter SHALL keep the summaries of the current session in memory only, at most the latest 20, so a restart loses them. It SHALL forget them when `session_shutdown` fires. It SHALL NOT write a summary to disk or to the Pi session file.

#### Scenario: Many recalls

- **WHEN** a session records more than 20 summaries
- **THEN** the adapter SHALL keep only the latest 20

#### Scenario: Session ends or switches

- **WHEN** `session_shutdown` fires
- **THEN** the adapter SHALL forget every summary and fold state of that session

#### Scenario: Restart

- **WHEN** Pi restarts
- **THEN** the earlier summaries SHALL be gone and no row SHALL be drawn for them

### Requirement: Summaries are shown as fold rows above the Pi editor

When visible recall is enabled and the session has summaries, the adapter SHALL draw one row for each of the latest 5 summaries in one Pi editor widget placed above the editor. Each drawn line SHALL fit the terminal width.

#### Scenario: A recall row appears

- **WHEN** a summary is recorded while visible recall is enabled
- **THEN** the widget SHALL show one collapsed row for it

#### Scenario: Many recalls in one session

- **WHEN** the session holds more than 5 summaries
- **THEN** the widget SHALL show only the latest 5 rows

#### Scenario: Nothing to show

- **WHEN** the session has no summary, or visible recall is disabled
- **THEN** the adapter SHALL draw no OMMS recall widget

### Requirement: A Pi fold row reads like a memory tool call

Each collapsed row SHALL read `▸ ● memory [mode=search, query="<query>", limit=<count>]`, as the shared `callTitle` formats it. An unfolded row SHALL list the lines that the shared `unfoldLines` returns: mode, query cut to 300 characters, limit, and each memory with its relevance, its id when present, and its headline.

#### Scenario: The collapsed search row

- **WHEN** a summary with query "how did we handle om-pi-todo" and 3 memories is shown folded
- **THEN** the row SHALL read `▸ ● memory [mode=search, query="how did we handle om-pi-todo", limit=3]`

#### Scenario: An unfolded row lists the memories

- **WHEN** the row is unfolded
- **THEN** it SHALL list `mode: search`, the query, `limit: 3`, and the three memories with relevance, id and headline

#### Scenario: A narrow terminal

- **WHEN** the terminal is narrower than a row
- **THEN** each drawn line SHALL be cut to the terminal width

### Requirement: Rows fold and unfold with a slash command

The adapter SHALL register a `/omms-recall` slash command as the only toggle. Running it SHALL unfold every shown row, or fold them all when every shown row is already unfolded. The fold state of a row SHALL last as long as its summary.

#### Scenario: Unfold all

- **WHEN** at least one shown row is folded and the user runs `/omms-recall`
- **THEN** every shown row SHALL unfold

#### Scenario: Fold all

- **WHEN** every shown row is unfolded and the user runs `/omms-recall`
- **THEN** every shown row SHALL fold

#### Scenario: Clicking a row

- **WHEN** the user clicks a row
- **THEN** the adapter SHALL take no action, because `/omms-recall` is the only toggle

#### Scenario: A new recall arrives

- **WHEN** a new summary is recorded after the user unfolded the older rows
- **THEN** the older rows SHALL stay unfolded and the new row SHALL be folded

### Requirement: Pi recall rows do not change the model context or the session file

Drawing recall rows SHALL NOT run a second retrieval, SHALL NOT add a message or a custom entry to the Pi session, and SHALL NOT change the system prompt that `before_agent_start` returns. Rows SHALL be shown only on the user's screen. A failure to record or draw a row SHALL NOT change the retrieval result and SHALL NOT throw into Pi.

#### Scenario: Injection unchanged

- **WHEN** a recall is shown as a row
- **THEN** the system prompt returned from `before_agent_start` SHALL equal the one returned with visible recall disabled
- **AND** the session file SHALL gain no entry for the row

#### Scenario: Widget call fails

- **WHEN** `ctx.ui.setWidget` throws
- **THEN** the adapter SHALL still return the retrieval section and Pi SHALL keep running

### Requirement: Fold state stays out of the session file and the model context

The adapter SHALL keep fold state in memory, or in a host-provided extension store that is neither the Pi session file nor the model context. It SHALL NOT write memory text, a summary or a headline to the Pi session file or to any such store.

#### Scenario: No safe extension store

- **WHEN** Pi offers no extension store outside the session file and the model context
- **THEN** fold state SHALL be kept in memory only

#### Scenario: Session file after rows were shown

- **WHEN** rows were drawn and folded or unfolded during a session
- **THEN** the Pi session file SHALL contain no entry that holds memory text or a row

### Requirement: The visibleRecall setting gates Pi rows

The global `visibleRecall` setting SHALL control whether the Pi adapter draws recall rows, defaulting to on. A project configuration SHALL be able to turn the rows off but not on. When the setting changes in a config file, the adapter SHALL apply it from the next prompt.

#### Scenario: Turned off globally

- **WHEN** `visibleRecall` is `false` in the global configuration
- **THEN** Pi SHALL draw no recall rows

#### Scenario: Turned off for a project

- **WHEN** `visibleRecall` is `false` in the project configuration and `true` globally
- **THEN** Pi SHALL draw no recall rows in sessions for that project

### Requirement: Recall rows log no memory text

Log records about Pi recall rows SHALL carry only the mode, the memory count and the session id. They SHALL NOT carry the query, a headline or other memory text.

#### Scenario: A summary is recorded

- **WHEN** the adapter records a summary
- **THEN** the log record SHALL contain the mode, the count and the session id only
