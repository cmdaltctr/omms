# Memory page by host: wireframes

Status: part of the OpenSpec change `memory-host-cards`. `design.md` explains the decisions behind each view.

Legend: `[Button]` is a button, `( )` is a radio or tick box, `[____]` is a text field, `v` opens a menu, `(*)` is the selected item. `~` marks a coloured status (amber for warning, red for error, green for done).

## 1. Overview, desktop (`/memory`)

```text
+--------------------------------------------------------------------------------------+
| Memory                                                                               |
| Choose a host to see its history import, sessions and settings.                      |
|                                                                                      |
| +------------------+ +------------------+ +------------------+ +------------------+  |
| |  +----+          | |  +----+          | |  +----+          | |  +----+          |  |
| |  | Pi |       v  | |  | OC |       v  | |  | CC |       v  | |  | <> |          |  |
| |  +----+          | |  +----+          | |  +----+          | |  +----+          |  |
| |  Pi              | |  OpenCode        | |  Claude Code     | |  Shared          |  |
| |  ~ Imported      | |  ~ Paused        | |  ~ Imported      | |  Settings for    |  |
| |  9 Oct · 0 left  | |  0 pending       | |  9 Oct · 0 left  | |  every host      |  |
| +------------------+ +------------------+ +------------------+ +------------------+  |
|                                                                                      |
| [Import all hosts]  Runs one import job for every host that is set up.               |
|                     Makes model calls and can cost money.                            |
+--------------------------------------------------------------------------------------+
```

- All four cards have the same size. Every avatar is the same square size.
- `v` on a host card opens the **Change icon** menu (see section 6).
- A click anywhere else on a card opens its view.

## 2. Overview, phone (390 px)

```text
+------------------------------------+
| Memory                             |
|                                    |
| +---------------+ +---------------+|
| | +--+          | | +--+          ||
| | |Pi|       v  | | |OC|       v  ||
| | +--+          | | +--+          ||
| | Pi            | | OpenCode      ||
| | ~ Imported    | | ~ Paused      ||
| +---------------+ +---------------+|
| +---------------+ +---------------+|
| | +--+          | | +--+          ||
| | |CC|       v  | | |<>|          ||
| | +--+          | | +--+          ||
| | Claude Code   | | Shared        ||
| | ~ Imported    | | Every host    ||
| +---------------+ +---------------+|
|                                    |
| [Import all hosts]                 |
+------------------------------------+
```

## 3. Host view: OpenCode, paused (`/memory/opencode`)

```text
+--------------------------------------------------------------------------------------+
| [Pi] [(*) OpenCode] [Claude Code] [Shared]          <- compact card switcher         |
|--------------------------------------------------------------------------------------|
|  +----+  OpenCode                                                                    |
|  | OC |  ~ Paused · 0 pending · last run 9 Oct 21:21 (stopped) · model: none         |
|  +----+                                                                              |
|                                                                                      |
|  [Resume]  (greyed)                                                                  |
|  OpenCode's backfill uses the live capture model, and that model runs only inside    |
|  OpenCode. Open OpenCode, or choose the external API below.  [Use external API]      |
|                                                                                      |
|--------------------------------------------------------------------------------------|
|  Sessions                                                  Scope: [All projects  v]  |
|                                                                                      |
|  452 sessions · 431 ready · 21 need a folder                       [Refresh list]    |
|  [Select all ready (431)]  [Clear]                    Selected: 0 / 431              |
|                                                                                      |
|  ( ) 19 Sep 01:49  /Users/.../PROJECTS/openchamber            recorded               |
|  ( ) 15 Sep 23:26  /Users/.../PROJECTS/llamaindex-rag-mcp-v3  mapped                 |
|  ( ) 15 Sep 19:47  /Users/.../PROJECTS/github-workflows       worktree               |
|  ...                                                                                 |
|                                                                                      |
|  Need a folder (21)                                          [Ignore all 21]         |
|  +--------------------------------------------------------------------------------+  |
|  | ~ ~/Library/Application Support/Open Design/.../c2ecb6e9…  · 13 sessions       |  |
|  |   Folder: [_______________________________]  Suggested: none     [Ignore]      |  |
|  |--------------------------------------------------------------------------------|  |
|  | ~ /private/tmp/oc-mem-phase1/project  · 7 sessions                             |  |
|  |   Folder: [~/Development/PROJECTS/omms____]  Suggested: omms     [Ignore]      |  |
|  |--------------------------------------------------------------------------------|  |
|  | ~ /private/var/folders/.../od-conn-test-XZfcpW  · 1 session                    |  |
|  |   Folder: [_______________________________]  Suggested: none     [Ignore]      |  |
|  +--------------------------------------------------------------------------------+  |
|  [Smart resolve]  Suggests a folder or an ignore for each row. Nothing saves until   |
|                   you confirm.                                                       |
|                                                                                      |
|  [Preview (dry run)]  [Import selected]   Makes model calls and can cost money.      |
|                                                                                      |
|--------------------------------------------------------------------------------------|
|  OpenCode settings                                                                   |
|  Backfill model  [Same as live capture   v]   [Save]                                 |
|  Import model    [Saved external API     v]                                          |
|  Automatic import  ( on )   Cutoff: 28 Sep 2026 13:24                                |
+--------------------------------------------------------------------------------------+
```

- A folder typed into a row is saved as a directory map. Saved maps apply to every host, and the Shared view lists them.
- **Ignore all** opens a confirmation that lists the folders first.

## 4. Main button: one label per state

```text
State            Button              Sentence under the button
---------------  ------------------  ----------------------------------------------------
running          [Pause]             Importing 120 / 431 · about 6 min left
paused           [Resume]            Paused by you on 9 Oct. Resume to continue.
nothing to do    [Run now]           Nothing to import before 28 Sep. Newer chats: use
                                     Sessions below.
done             [Run now]           Imported 431 sessions on 9 Oct.
failed           [Retry]             ~ Stopped: model call failed (401). Check the API key.
not set up       [How to set up]     Pi is not installed on this machine.
```

## 5. Health warning on a card (memory writes failing)

```text
+------------------------+
|  +----+             v  |
|  | OC |                |
|  +----+                |
|  OpenCode              |
|  ~ Memories not saved  |   <- amber card edge and text
|  Embedding server      |
|  error (500)           |
+------------------------+
```

In the host view, the same warning shows as a strip above the status header:

```text
+--------------------------------------------------------------------------------------+
| ~ Memories are not being saved. The embedding server at 127.0.0.1:9931 returns 500.  |
|   Restart the embedding model, then press Check again.        [Check again] [Help]   |
+--------------------------------------------------------------------------------------+
```

The warning affects every host, so all three host cards show it at the same time.

## 6. Change icon menu and dialog

```text
 v on the OpenCode card
 +----------------------+
 | Upload image...      |
 | Choose icon...       |
 | Reset to default     |
 +----------------------+

 Choose icon...
 +----------------------------------------------------------+
 | Choose an icon for OpenCode                          [x] |
 | Search: [terminal_____________]                          |
 |                                                          |
 |  [>_] [{}] [</>] [#] [*] [o] [=] [+] [~] [@] [!] [?]     |
 |  [>_] [{}] [</>] [#] [*] [o] [=] [+] [~] [@] [!] [?]     |
 |                                                          |
 | Preview: +----+                                          |
 |          | >_ |   Same size on every card                |
 |          +----+                                          |
 |                                    [Cancel]  [Use icon]  |
 +----------------------------------------------------------+

 Upload image...
 +----------------------------------------------------------+
 | Upload an image for OpenCode                         [x] |
 | PNG, JPEG, WebP or GIF, up to 20 MB.                     |
 |                                                          |
 |  +--------------------------+     Preview: +----+        |
 |  |   wide photo 3000x1200   |              |crop|        |
 |  |     [ square crop ]      |              +----+        |
 |  +--------------------------+     Centre-cropped to a    |
 |                                   square, saved at 128 px|
 |                                    [Cancel]  [Save]      |
 +----------------------------------------------------------+
```

## 7. Not set up card

```text
+------------------------+
|  +----+                |   <- greyed card
|  | Pi |                |
|  +----+                |
|  Pi                    |
|  Not set up            |
|  Open for setup steps  |
+------------------------+
```

Opening it shows a short note and a link to `docs/pi-adapter.md`.

## 8. Shared view (`/memory/shared`)

```text
+--------------------------------------------------------------------------------------+
| [Pi] [OpenCode] [Claude Code] [(*) Shared]                                           |
|--------------------------------------------------------------------------------------|
|  Shared settings apply to every host.                                                |
|                                                                                      |
|  > Profile learning        Prompts waiting: 0 · [Start]                              |
|  > Memory limits           Results 10 · Memories 3 · Context 2,000 tokens            |
|  > Keyword matching        Mode: hybrid                                              |
|  > Reranker                Off                                                       |
|  > Directory maps          84 saved · 18 ignored folders  [Ignore all unresolved]    |
|                                                                                      |
|  Each row opens in place to show its full settings.                                  |
+--------------------------------------------------------------------------------------+
```

## 9. Sidebar

```text
Memory
  Pi
  OpenCode      ~
  Claude Code
  Shared
```

Old bookmarks still work. For example, `#memory-section-reranker` opens the Shared view at the Reranker row.
