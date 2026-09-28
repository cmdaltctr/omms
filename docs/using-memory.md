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

## User profile

The **user profile** is a separate summary of how you like to work, such as
preferences and habits. It covers all your projects.

- It updates on an interval, `userProfileAnalysisInterval`. The default is
  every 10 analysed prompts.
- You can see it in the web UI's profile view, or read it with
  `memory({ mode: "profile" })`.
- You do not fill it in by hand. Profile learning fills it when a model is
  ready.

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
