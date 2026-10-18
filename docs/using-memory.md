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
   - Search matches by meaning and by exact words. A memory that contains a word from your prompt (an identifier such as `ADR-023`, a tool name, a tag) gets a small score bonus, set by `keywordBoost`. See [Keyword matching](configuration.md#keyword-matching). No extra model call is made. The Memory page can switch to an experimental rank fusion mode: see [Memory page: Keyword matching](web-ui-memory.md#keyword-matching).
   - The profile block in that section also follows the prompt. About half of the preferences, patterns and workflows are the ones closest to the prompt. The rest are the usual top items, so the block is not the same for every prompt.
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
- Each prompt shows only some items. Half of the slots go to the items closest
  to the prompt, and the other half keep the usual order. The prompt vector is
  reused from the memory search, so this adds no embedding call.

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

Prompts can wait inside OMMS after an import or failed profile pass. To analyse them:

- On **Memory**, select **Analyse waiting prompts** under **Profile learning**. Check the estimate and confirm. See [Memory: Analyse waiting prompts](web-ui-memory.md#analyse-waiting-prompts).
- In a terminal, run `om-memory-system profile-catch-up`. See [CLI: Profile catch-up](cli.md#profile-catch-up).

Catch-up reads waiting prompts oldest first, with 50 eligible prompts per analysis call. It leaves completed history handled. Trivial prompts need no model call. Matching, deduplication and retries can add calls beyond the analysis estimate.

A failed batch stops the run; completed batches stay learned. Resume continues from waiting prompts. A terminal run can take over after the active batch. A second start in the same web app is refused.

### Profile check limits

Each learning pass can check up to three candidate pairs for conflicts and five for duplicates per item type. A negative conflict answer uses the same check budget as a positive answer. Extraction and description updates can make additional model calls.

Pausing an import during profile learning stops it at a batch boundary. Completed batches stay learned.

### Automatic cleanup

OpenCode, Pi and Claude Code clean up the profile by themselves. After a live learning pass takes the count of analysed prompts past a multiple of `userProfileAutoCleanupInterval` (default 500), the host starts a cleanup in the background. It never delays learning or capture.

- The cleanup merges duplicate items and removes items that are too vague to help. It sends the whole profile to the model in batches of up to 100 items.
- It saves what the model proposes. You do not review it. A change is skipped when learning changed one of its items during the run.
- It changes nothing when the model proposes to remove or merge away more than a quarter of the items. The log then says `too-many-changes`.
- Before it saves, OMMS stores the items it changes. **Undo last automatic cleanup** on the Profile page puts them back for 30 days. OMMS deletes older records at its next daily cleanup or web app start. Undo keeps the other memories that OMMS learned or updated after the run. An update to a merged memory is lost, because Undo replaces that memory with its originals.
- History imports, backfills and catch-up runs never start it.
- Turn it off, or change how often it runs, in the **Profile learning** card on the Memory page. See [Memory page: Automatic profile cleanup](web-ui-memory.md#automatic-profile-cleanup). The keys are `userProfileAutoCleanupEnabled` and `userProfileAutoCleanupInterval`. A project config cannot override them.
- A run takes several minutes on a large profile and makes about one model call for every 100 items. On a profile of 2,000 items that is about 20 calls for each run, so the default interval is 500 prompts. On the external API, each call must finish in 60 seconds. A reasoning model can be too slow. See [Web UI: User profile page](web-ui.md#user-profile-page).

The AI Cleanup window on the Profile page still lets you review the changes before they are saved.

### How long profile items stay

Each profile pass removes old items that have little support:

- A preference or pattern is removed when it was last seen more than `userProfileStaleDays` days ago (default 2) and has fewer than `userProfileMinEvidenceForRetention` evidence entries (default 3).
- A workflow is removed when it was last seen more than `userProfileWorkflowStaleDays` days ago (default 30, or `userProfileStaleDays` when that is longer) and was seen fewer than `userProfileMinEvidenceForRetention` times. Its evidence count is used when it is larger.

### How profile categories are matched

Preferences and patterns use a hidden category key: trim the label, lower-case it, replace `_` and `-` with spaces, then collapse spaces. "Communication style", "communication_style" and "Communication Style" share a key. "Communication" and "Communication style" keep different keys. Workflows have no category.

On each save, one visible spelling wins for each key. An existing spelling without `_` or `-` takes priority over separator spellings. OMMS then counts items across preferences and patterns together to choose the most used spelling within that group. If every spelling has separators, the most used wins. Ties prefer a leading capital, then the first seen.

This keeps "Git workflow" when many items use "git-workflow". A lone "Anti-over-engineering" keeps its hyphens because there is no plain alternative.

OMMS replaces `_` with spaces and tidies spacing in the winning label. It capitalises the first letter only when there are no capitals already. "UI/UX" and "OpenSpec conventions" keep their capitals; hyphens stay in the visible label. A blank becomes "General", and `explicit` stays `explicit`.

A manual edit to another spelling of an existing key uses the winning label when saved. This does not support renaming a whole category by editing one item.

Every host's profile prompt lists the 40 most used categories per type, with item counts. The model is asked to reuse those exact names when an observation fits. Rare categories can fall outside this list. Each name is shown in quotes, and the prompt tells the model that the quoted names are stored data, not instructions.

Old spellings are repaired on the next save. To preview a repair at once, run `om-memory-system profile-normalise-categories`. See [CLI: Normalise profile categories](cli.md#normalise-profile-categories).

To join different wordings of one meaning, such as "Execution" and "Direct execution", use the category cleanup on the user profile page or `om-memory-system profile-cleanup-categories`. It groups names by meaning, lets you review each group, and only renames categories. See [CLI: Clean up profile categories](cli.md#clean-up-profile-categories).

Apply works on the profile as it is when you apply, even when learning ran during the preview. A new item that learning added under an accepted name is renamed too. If another save lands at the exact moment of the write, Apply asks you to try again.

The model's answers are saved per group. A new preview asks the model only about new groups and groups that failed before, and keeps each answer for 30 days. It checks a changed set of names again.

After a cleanup, more memories share a category. Profile learning merges two memories in one category at a similarity of 0.8, against 0.9 across categories, so near-duplicates merge more readily. Conflict checks also run only inside one category.

### How workflows are learned

A workflow is a repeatable sequence of at least 3 concrete steps, for example "create a branch, write a failing test, fix, run CI, open a PR". The profile prompt asks every host for this and says that a personality or style summary is not a workflow. A workflow with fewer than 3 non-empty steps is dropped before it is stored. Preferences and patterns in the same reply are kept.

A new workflow joins an existing one only when the two are very similar. Otherwise it is stored as a separate workflow. A match keeps the longer list of steps, and a workflow description is never rewritten into a general summary.

### Rebuild the profile from history

On **Memory**, select **Re-analyse chat history**. It opens a forced profile-only import with User profile selected and Project memories deselected. Choose hosts and scope, list sessions, preview and confirm before model calls. The preset preserves your profile and leaves project memories unchanged.

From a terminal, run the history import with `--force --skip-memories`. Start with a dry run:

```bash
om-memory-system import-pi-history --scope all-projects --force --skip-memories --dry-run
om-memory-system import-pi-history --scope all-projects --force --skip-memories
```

Do the same with `import-opencode-history` and `import-claude-history`. Commands and flags stay unchanged. Each history prompt can be forcibly re-analysed once; later forced runs skip earlier replays. Findings use existing matching and retention rules and can merge into existing items. Re-analysis preserves the profile and does not guarantee more workflows.

[Memory's preview](web-ui-memory.md#analysis-call-estimates) counts eligible non-trivial history and the shared waiting backlog once. Additional matching, deduplication, retries or newly waiting prompts can add calls.

Profile identities still follow git emails. **All hosts** does not merge different emails. Use [Profiles in Settings](web-ui-settings.md#profiles) to choose or merge identities when more than one active profile exists.

## Web UI

Open `http://127.0.0.1:4747` to browse the memory and prompt timeline, look at
captures, and manage the user profile. Use [Memory](web-ui-memory.md) for history imports, profile actions, memory limits and missing project folders. Settings retains [models and profile identities](web-ui-settings.md). If you open the server beyond loopback,
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

Each added memory shows its id beside its relevance, for example `<memory id="mem_…" relevance="82%">`. After a compaction or a resume, the heading shows it: `### Memory 1 (mem_…)`. The agent can pass that id to `forget` with no search first. In Claude Code, the recall rows at the top of each reply show the same ids. See [Claude Code adapter: Memory tool and recall rows](claude-code-adapter.md#memory-tool-and-recall-rows).

The agent should search the full store:

- before it debugs or investigates a problem;
- when you refer to earlier work, for example "we fixed this before", "last time", "remember", or "did we";
- before a decision about project conventions.

The `memory` tool description in Pi, OpenCode and Claude Code gives the same instruction. These texts raise the chance of a search, but a model can still skip it. To make sure, ask the agent to search memory, or start the `omms-memory` skill.

## The omms-memory skill

The `omms-memory` skill tells the agent when and how to search and save memory. One skill file serves every host.

- With a `memory` tool, the agent uses the tool. Pi and OpenCode call it `memory`. The Claude Code plugin calls it `mcp__omms__memory`.
- Without one (Claude Code with hand-written hooks), the agent runs `om-memory-system memory` in its shell. See [Claude Code adapter: The memory command](claude-code-adapter.md#the-memory-command).

Each host loads the skill by itself. You do not copy any files.

| Host        | How the skill loads                                                      | Start it by name                              |
| ----------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| Pi          | The npm package lists the skill in its `pi` manifest.                    | `/skill:omms-memory`                          |
| OpenCode v1 | The plugin adds the package's `skills` folder to OpenCode's skill paths. | Ask the agent to use the `omms-memory` skill. |
| OpenCode v2 | The plugin adds the skill to OpenCode's skill list.                      | `/omms-memory`                                |
| Claude Code | The Claude Code plugin includes the skill.                               | `/omms:omms-memory`                           |

The agent also loads the skill by itself when a task matches its description.
