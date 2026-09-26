# Using memory day to day

You do **not** need to ask your agent to “remember” things. With the defaults, memory builds up as you work.

## Typical daily flow

1. Install OMMS (see [Set up](../README.md#set-up)) and restart your agent.
2. Optionally choose the auto-capture model. With nothing set, auto-capture uses the session's own model. Pin one with `opencodeProvider` + `opencodeModel` (Pi: `piProvider` + `piModel`) or set an external API. Details under [Choosing the model](configuration.md#choosing-the-model).
3. Work normally. When an OpenCode session goes idle, or a Pi turn settles, auto-capture extracts memorable technical context and stores it.
4. Relevant memories are injected into context automatically. On OpenCode v2 and Pi, every prompt runs a semantic search of the project memory and adds the matches as an `<omms-retrieval>` system section (never as a chat message). On OpenCode v1, the most recent memories are injected on the first message of a session (`chatMessage.injectOn`). After compaction, the session's own memories are restored. Browse or edit memories in the web UI at `http://127.0.0.1:4747`.
5. Use the `memory` tool when you want something stored or retrieved immediately (see [The memory tool](#the-memory-tool)).

## Automatic vs manual memory

| Approach                                               | When it runs                                        | What you do                                                                                |
| ------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Auto-capture** (`autoCaptureEnabled: true`, default) | After conversation turns when the session goes idle | Nothing — extraction is automatic                                                          |
| **Manual** `memory` tool / commands                    | On demand                                           | `add`, `search`, `list`, `profile`, `forget`, `list-shards`, `migrate`, `export`, `import` |

Manual search/add/list still work even if auto-capture has no provider configured. Auto-capture and user profile learning need a provider that can return structured/tool-call output.

## Memory vs AGENTS.md / project docs

| Store in **memory**                                                  | Store in **AGENTS.md** / static docs                        |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Project-specific decisions, bug patterns, “we tried X and it failed” | Stable rules and workflows that rarely change               |
| User preferences discovered over sessions                            | Always-on coding conventions and process                    |
| Facts that should follow you across chats                            | Instructions every agent should see regardless of retrieval |

Rule of thumb: if it is a lasting project instruction, put it in AGENTS.md; if it is context that grows from real work, let memory (or auto-capture) hold it.

## How auto-capture works

After each turn, a background AI request summarizes the technical work and saves it as a memory. Greetings and chat without technical content are skipped. No special prompt from you is required. Which model it uses is set in [Choosing the model](configuration.md#choosing-the-model); with nothing configured it uses the session's own model.

## User profile

The **User Profile** is a separate, cross-project summary of how you like to work (preferences, habits). It is updated on an interval (`userProfileAnalysisInterval`, default every 10 analyzed prompts), shown in the web UI’s profile view, and readable via `memory({ mode: "profile" })`. You do not populate it by hand for normal use — profile learning fills it when a provider is ready.

## Web UI

Open `http://127.0.0.1:4747` to browse the memory–prompt timeline, inspect captures, and manage the user profile. If you bind the server beyond loopback, see [Web UI HTTP Basic Auth](web-ui.md#http-basic-auth).

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

See [Moving projects](moving-projects.md) for `list-shards`, `migrate`, `export` and `import`, and [Configuration](configuration.md#memory-scope) for `scope`.
