# Using memory day to day

You do **not** need to ask your agent to "remember" things. With the default
settings, memory builds up as you work.

## Typical daily flow

1. Install OMMS (see [Set up](../README.md#set-up)) and restart your agent.
2. Optionally, choose the model for automatic capture. See
   [Choosing the model](configuration.md#choosing-the-model).
   - With nothing set, capture uses the session's own model.
   - To pin a model, set `opencodeProvider` and `opencodeModel` (Pi:
     `piProvider` and `piModel`).
   - To use an external API, set `opencodeModel` (Pi: `piModel`) to
     `"external"`.
3. Work normally. Capture runs when an OpenCode session goes idle or a Pi turn
   settles. It stores the useful technical context.
4. OMMS adds relevant memories to the agent's context by itself:
   - On OpenCode v2 and Pi, every prompt runs a semantic search of the project
     memory. The matches go in an `<omms-retrieval>` system section, never in
     a chat message.
   - On OpenCode v1, the most recent memories go into the first message of a
     session (`chatMessage.injectOn`).
   - After compaction, the session's own memories are put back.
   - The added memories are the closest matches only. Their header tells the agent to search the full store. See [When agents search memory](#when-agents-search-memory).
5. Browse or edit memories in the web UI at `http://127.0.0.1:4747`.
6. Use the `memory` tool to store or find something at once. See
   [The memory tool](#the-memory-tool).

## Automatic and manual memory

| Approach                                               | When it runs                                       | What you do                                                                                |
| ------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Auto-capture** (`autoCaptureEnabled: true`, default) | After conversation turns, when the session is idle | Nothing. Capture is automatic.                                                             |
| **Manual** `memory` tool and commands                  | When you ask                                       | `add`, `search`, `list`, `profile`, `forget`, `list-shards`, `migrate`, `export`, `import` |

- Manual `search`, `add` and `list` work even when capture has no model set
  up.
- Capture and user profile learning need a model that can return structured
  or tool-call output.

## Memory or AGENTS.md

| Keep in **memory**                                          | Keep in **AGENTS.md** or other fixed docs               |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| Project decisions, bug patterns, "we tried X and it failed" | Stable rules and workflows that rarely change           |
| User preferences found over many sessions                   | Coding conventions and process that always apply        |
| Facts that should follow you across chats                   | Instructions every agent must see, whatever it searches |

A simple rule: put lasting project instructions in AGENTS.md. Let memory hold
context that grows from real work.

## How auto-capture works

- After each turn, a background model call summarises the technical work and
  saves it as a memory.
- It skips greetings and chat with no technical content.
- You do not need a special prompt.
- The model it uses is set as in
  [Choosing the model](configuration.md#choosing-the-model). With nothing set,
  it uses the session's own model.

### When capture fails

- If the capture model cannot be reached (network error, timeout, rate limit or
  server error), OMMS keeps the turn and tries again later. Both hosts first
  make quick retries within the turn: up to `autoCaptureMaxRetries` tries
  (default 3), 2 and 4 seconds apart.
- Retries start when a session starts and after the next successful capture.
  The waits grow from 1 minute to 12 hours.
- Each host retries only its own turns, with its current capture model.
- Waiting turns are deleted after `captureRetryRetentionHours` (72 hours by
  default). See [Capture retry queue](configuration.md#capture-retry-queue).
- A bad key, a bad request or a bad model reply is not retried. Fix the cause,
  then run a manual history import for that session. Also run one if a turn
  waited longer than the retention, or if you turned the queue off.

## User profile

The **user profile** is a separate summary of how you like to work, such as
preferences and habits. It covers all your projects.

- It updates on an interval, `userProfileAnalysisInterval`. The default is
  every 10 analysed prompts.
- You can see it in the web UI's profile view, or read it with
  `memory({ mode: "profile" })`.
- You do not fill it in by hand. Profile learning fills it when a model is
  ready.

How profile learning behaves:

- A live pass reads the waiting prompts of the last 7 days, newest first. When none are recent, it reads the oldest. A large backlog from a history import therefore does not delay your recent prompts.
- Trivial prompts are marked as learned with no model call. A prompt is trivial when its trimmed text is under 20 characters and has fewer than three words, for example `yes go`. `use bun not npm` has four words, so OMMS keeps it. Trivial prompts do not count toward `userProfileAnalysisInterval`.
- A profile call to the external API has its own time limit of 120 seconds. Captures keep `autoCaptureIterationTimeout` (default 30 seconds).
- A failed pass writes one log record with the host and a reason code. The record holds no prompt, reply, or key.
- After a failure, that process starts no profile pass for 10 minutes. Capture continues. A success clears the wait. A restart also clears it.

| Reason code      | Meaning                                                      |
| ---------------- | ------------------------------------------------------------ |
| `timeout`        | The model did not reply within the time limit.               |
| `http-<status>`  | The API answered with an HTTP error, for example `http-429`. |
| `no-tool-call`   | The model did not return the profile through a tool call.    |
| `invalid-reply`  | The reply was not a valid profile.                           |
| `not-configured` | The model settings are not complete.                         |
| `error`          | Another error.                                               |

The log messages are `Claude Code profile learning failed`, `pi profile learning: aborted`, and `user-profile-learning: aborted` (OpenCode). To find them:

```bash
grep -E 'profile learning failed|profile learning: aborted|user-profile-learning: aborted' ~/.omms/omms.log | tail
```

### Catch up the profile

Prompts can wait for profile learning, for example after a history import. To analyse all of them at once:

- On the Settings page, select **Catch up profile** in the **Profile learning** card. See [Settings page: Profile learning](web-ui-settings.md#profile-learning).
- In a terminal, run `om-memory-system profile-catch-up`. See [CLI: Profile catch-up](cli.md#profile-catch-up).

A run analyses 50 prompts in each model call, oldest first. It costs one model call for each batch. It stops at the first failed batch and keeps the finished batches. The next run continues from there. If you start a second run, from the page or a terminal, the newest run takes over after the current batch, so no batch is paid for twice.

### How long profile items stay

Each profile pass removes old items that have little support:

- A preference or pattern is removed when it was last seen more than `userProfileStaleDays` days ago (default 2) and has fewer than `userProfileMinEvidenceForRetention` evidence entries (default 3).
- A workflow is removed when it was last seen more than `userProfileWorkflowStaleDays` days ago (default 30, or `userProfileStaleDays` when that is longer) and was seen fewer than `userProfileMinEvidenceForRetention` times. Its evidence count is used when it is larger.

### Rebuild the profile from history

Catch up analyses only prompts that still wait. To analyse imported history again, for example after old workflows were removed, run the history import with `--force --skip-memories`. Start with a dry run to see the number of prompts:

```bash
om-memory-system import-pi-history --scope all-projects --force --skip-memories --dry-run
om-memory-system import-pi-history --scope all-projects --force --skip-memories
```

Do the same with `import-opencode-history` and `import-claude-history`. On the Settings page, turn on **Force reimport** and **Skip memories** in the import options. Each rebuild costs one model call for each 50 prompts. Each history prompt is re-analysed once. A later forced run skips the prompts an earlier forced run already re-analysed, so a repeat does not count the same prompt twice.

## Web UI

Open `http://127.0.0.1:4747` to browse the memory and prompt timeline, look at
captures, and manage the user profile. For the Settings page, see
[Settings page](web-ui-settings.md). If you open the server beyond loopback,
see [Web UI HTTP Basic Auth](web-ui.md#http-basic-auth).

## The memory tool

Ask the agent to use the `memory` tool, or call it directly:

```typescript
memory({ mode: "add", content: "Project uses microservices architecture" });
memory({ mode: "search", query: "architecture decisions" });
memory({ mode: "search", query: "architecture decisions", scope: "all-projects" });
memory({ mode: "profile" });
memory({ mode: "list", limit: 10 });
memory({ mode: "list-shards" });
memory({ mode: "migrate", fromPath: "/old/path/to/project" });
memory({ mode: "export", outputPath: "./memories.json" });
memory({ mode: "import", inputPath: "./memories.json" });
```

See [Moving projects](moving-projects.md) for `list-shards`, `migrate`,
`export` and `import`. See [Configuration](configuration.md#memory-scope) for
`scope`.

## When agents search memory

OMMS adds the closest matches to the agent's context. These are not all your memories. The header of that context says so. It tells the agent to search the full store before it investigates a problem, or when you refer to earlier work.

The agent should search the full store:

- before it debugs or investigates a problem;
- when you refer to earlier work, for example "we fixed this before", "last time", "remember", or "did we";
- before a decision about project conventions.

The `memory` tool description in Pi and OpenCode gives the same instruction. These texts raise the chance of a search, but a model can still skip it. To make sure, ask the agent to search memory, or start the `omms-memory` skill.

## The omms-memory skill

The `omms-memory` skill tells the agent when and how to search and save memory. One skill file serves every host.

- With a `memory` tool (Pi and OpenCode), the agent uses the tool.
- Without one (Claude Code), the agent runs `om-memory-system memory` in its shell. See [Claude Code adapter: The memory command](claude-code-adapter.md#the-memory-command).

Each host loads the skill by itself. You do not copy any files.

| Host        | How the skill loads                                                      | Start it by name                              |
| ----------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| Pi          | The npm package lists the skill in its `pi` manifest.                    | `/skill:omms-memory`                          |
| OpenCode v1 | The plugin adds the package's `skills` folder to OpenCode's skill paths. | Ask the agent to use the `omms-memory` skill. |
| OpenCode v2 | The plugin adds the skill to OpenCode's skill list.                      | `/omms-memory`                                |
| Claude Code | The Claude Code plugin includes the skill.                               | `/omms:omms-memory`                           |

The agent also loads the skill by itself when a task matches its description.
