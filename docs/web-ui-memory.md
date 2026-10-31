# Memory page

Open `http://127.0.0.1:4747/memory` or select **Memory** in the sidebar. The page opens on an overview of four cards of the same size. Choose one to see only what belongs to it. The arrow beside **Memory** in the sidebar lists the same four views. User profile, Memory and Settings remember their expanded lists separately. Memory remains available in the collapsed desktop sidebar and mobile drawer.

| View        | App URL               | What it shows                                                                                                                                         |
| ----------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview    | `/memory`             | The four cards and [Import all hosts](#import-chat-history).                                                                                          |
| Pi          | `/memory/pi`          | Pi's [status and main action](#a-host-view), [sessions](#import-chat-history), [folders that need a map](#resolve-missing-project-folders), settings. |
| OpenCode    | `/memory/opencode`    | The same for OpenCode.                                                                                                                                |
| Claude Code | `/memory/claude-code` | The same for Claude Code.                                                                                                                             |
| Shared      | `/memory/shared`      | [Profile learning](#profile-learning), [Memory limits](#memory-limits), [Keyword matching](#keyword-matching), [Reranker](#reranker), saved maps.     |

Every view starts with the same four cards, including **Shared**, so one click reaches any other view. Under **Shared** in the sidebar, a contents list links to each of its five rows. Choosing one opens the row and scrolls to it. A refresh keeps the view you chose, and Back returns to the previous one.

Browse stored results on **Project memories** (`/project-memories`) and **User profile** (`/user-profile`). `/` opens Project memories. Settings retains models, access controls, diagnostics and profile identity controls. See [Settings page](web-ui-settings.md).

## The overview

Each host card shows the host's avatar, its name and one line of state, such as `Running · history imported 9 Oct · last saved today 18:52` or `Paused · 0 pending`.

- **history imported** is when the one-off import of older chats last finished. It does not change once that history is done.
- **last saved** is the newest live capture that saved a memory. It shows `today` or `yesterday` with the time, or the date and time when older. The card reads it again every minute. A host with no saved capture in the kept records (30 days by default, `captureAttemptRetentionDays`) shows no `last saved` part. **Shared** says that its settings apply to every host. A host whose history is not on this computer shows **Not set up** and its card is greyed.

**Import all hosts** opens the multi-host import described under [Import chat history](#import-chat-history). It makes model calls and can cost money.

### Memories not saved

The page checks that a new memory can be saved when it opens, every five minutes while the tab is visible, and when you select **Check again**. The check opens the memory store and embeds one fixed test string. It sends no conversation text. The server reuses a result for 30 seconds, so open tabs cause few calls. If your embedding service is remote, each check is one very small call to it.

When the check fails, each set-up host card turns amber and reads **Memories not saved** with a short reason, such as `Embedding server error (500)`. Each host view shows a strip with the reason and **Check again**. The sidebar marks the hosts with a dot. Fix the service named in the reason, then select **Check again**.

### Host avatars

Use the pencil on a host card, **Change icon**. **Upload image** accepts PNG, JPEG, WebP and GIF up to 20 MB. SVG is refused. OMMS crops the middle square, redraws it at 128 × 128 pixels in your browser, and saves only that PNG, so any image size gives the same avatar size and photo location data is dropped. **Choose icon** offers a searchable set of about 60 icons. **Reset to default** restores the host's two-letter mark.

The choice is saved in `appearance.json` and `<host>.png` under `host-appearance/` in the OMMS data folder (`~/.omms/data/host-appearance/` by default). It applies in every project.

## A host view

A host view shows only that host. From the top:

1. A switcher of the four cards, with the current one marked.
2. The write-health strip, when memories cannot be saved.
3. The **status header**: the host's state, one main action, and one sentence that explains them.
4. **Sessions**: the host's import form and session list.
5. **Sessions that need a folder**: the host's unresolved directories, open and ready to edit.
6. The host's own settings: backfill model and the automatic-import switch.

Automatic import runs all the time, so a host that is set up, not paused and not failed reads **Running** with **Pause**, even when no run is going. A **Play** button means something is off. The main action reads **Resume** while paused, **Retry** after a failure and **Resume** after a run was cut short with exchanges still pending. **Stopped** shows only for a cut-short run or a run the server says cannot start. When it is unavailable, the sentence under it gives the reason. For a host that needs itself open, the sentence offers **Use external API**, which saves the saved external API as that host's backfill model so Resume can run on its own. A host with nothing to import says `Automatic import is on. Nothing was waiting before <date>`. Newer chats come in through **Sessions**.

## Import chat history

Conversations populate project memories with technical facts. User prompts feed profile learning for preferences, recurring patterns and workflow steps.

A new form selects **Pi**, **Current project**, **Project memories** and **User profile**. **All hosts** explicitly selects Pi, OpenCode and Claude Code. It leaves project scope unchanged. Select **All projects** separately to widen that scope. Each selected host keeps its own source and session selection.

| Project memories | User profile | Result                                                             |
| ---------------- | ------------ | ------------------------------------------------------------------ |
| Selected         | Selected     | Extract memories and learn the profile.                            |
| Deselected       | Selected     | Learn from prompts; leave project memories unchanged.              |
| Selected         | Deselected   | Extract memories; skip profile learning.                           |
| Deselected       | Deselected   | Preview and Start are unavailable; the server refuses the request. |

**Skill turns** is a third output beside **Project memories** and **User profile**. It records each turn the import reads into `skills.db` for skill learning.

- The box is ticked by default while **Record agent turns** is on in the **Skill learning** card on the Settings page.
- While recording is off, the box is cleared and disabled. A note links to the **Skill learning** card.
- Skill turns also come from sessions and turns that the import ledger marks as handled, and from turns that live capture saved. The memory ledger does not change for them.
- With only **Skill turns** ticked, the run makes no model call and needs no import model. Preview and Start stay available, and the list hides no handled sessions.
- With only **Skill turns** ticked, a session whose project folder no longer exists can be selected. It shows **missing**, and its turns are recorded under the recorded folder path. A run with **Project memories** or **User profile** still skips it.
- Preview shows the turns it would record and the turns already recorded.

Host identity rules remain unchanged. **All hosts** does not merge profiles with different git emails. [Profiles in Settings](web-ui-settings.md#profiles) lets you choose or merge identities when more than one active profile exists.

### Review and start

The web app must be running and each chosen history source must be readable. A real import also needs a ready model.

1. Choose hosts and project scope.
2. Choose the outputs.
3. Select **List sessions** for each host.
4. Tick sessions, or select **Select all matching** to include matching sessions across every page.
5. Choose each host's **Import model**.
6. Select **Preview (dry run)**.
7. Check per-host results, combined counts and blockers.
8. Select **Start import**.
9. Check the confirmation's hosts, scope, outputs, model sources and work counts.
10. Confirm to start model calls.

Lists show dates, session IDs, project folders and **Resolved by**, without prompts or replies. You can select up to 1,000 sessions individually; use **Select all matching** for more. A valid source with no matching sessions reports **No work to process**. Fix an unavailable source or explicitly deselect its host, then preview again.

The list hides sessions that are already handled for the outputs you ticked. The check reads the import ledger only and never reads transcripts. With only **Project memories** ticked, a session is handled when it has memory rows and every one is imported or skipped. With only **User profile** ticked, the same test applies to its profile rows, which record that a prompt was collected. With both ticked, both tests must pass. A session with a failed or in-progress row, with no row of a ticked kind, or with no session ID stays listed. The list says how many handled sessions are hidden. The total, the pages and **Select all matching** count only the sessions shown, and the server applies the same rule when it resolves **Select all matching**. Turn on **Show handled sessions** to see them marked **Handled**. **Re-analyse handled history** shows them as well. Changing the ticked outputs, **Show handled sessions** or **Re-analyse handled history** clears the lists and the selection; select **List sessions** again. The hiding is a hint. A session that gained turns after its last import can still look handled, and a session with nothing to learn for an output never gets a row of that kind and stays listed. Preview always decides what work is pending.

Preview makes no model calls or memory-store writes. OpenCode listing or preview can create a temporary database snapshot. Readiness says **Configured, not tested.** A preview can return counts and a model blocker before the external API is ready. Complete the settings and preview again before starting.

Changing hosts, sources, sessions, scope, dates, maps, outputs, re-analysis, batch size or models invalidates the preview. Start requires a successful preview of the current draft and confirmation.

The server checks every child's source, pinned selection, options and model readiness before paid work. It checks each queued child again before that child starts. A changed or expired source stops that child visibly. The server never silently widens the selection.

### Models and pinned history

**Saved external API** uses the endpoint configured in Settings. Its label adds **not ready** when settings are incomplete. Saves on either page refresh readiness. A key saved as `env://NAME` must resolve in the web app process; a login item does not load your shell profile.

Pi and OpenCode retain their existing connected OpenCode web-model choices where available. Pi sign-in alone cannot provide a web-import model. The shared standalone web app has no OpenCode session, so use **Saved external API** there. Claude Code always uses the external API. Choosing hosts or import models changes no live-capture or backfill model settings. CLI and in-session model rules stay unchanged.

The listing pins the source, session selection and turn cutoff. An all-matching selection becomes stale when its matching set changes. An explicit selection becomes stale when a selected session disappears or resolves to another project. Refresh the list and preview again. New turns after listing wait for the next run; results count held-back turns.

**Resolved by** means:

- **recorded:** the recorded folder still exists.
- **mapped:** a directory map points to another folder.
- **project root:** OpenCode uses its recorded project folder when the session folder is gone.
- **missing:** no project folder resolves; map it before importing.

### Advanced options

Hosts, scope and outputs remain visible with Advanced options closed.

| Option                           | Effect                                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source                           | Pi: sessions folder or one `.jsonl` file. OpenCode: database file. Claude Code: transcripts folder (`claude-projects`). Defaults use each host's store.                                 |
| Project directory                | Absolute project path for Current project; an empty field uses the server's working directory.                                                                                          |
| Prompt date from, Prompt date to | Inclusive whole days in your browser's time zone. These filter turns inside sessions, not the session list. Empty limits include every turn. Untimed turns remain included and counted. |
| Directory maps                   | `old=new`, one per line. These apply to this run and win over saved maps for the same folder.                                                                                           |
| Profile batch size               | Positive integer of prompts per profile analysis request; default 50.                                                                                                                   |
| Re-analyse handled history       | Force processing for the selected outputs. Each profile prompt can be forcibly re-analysed once. Also shows handled sessions in the list.                                               |

**Browse** lists one folder at a time on a loopback-bound server. On a network address, type the path. Original history files remain unchanged. OpenCode reads a private database copy and first checks temporary disk space.

### Group progress, cancellation and retry

The server owns the queue. Selected hosts run in **Pi, OpenCode, Claude Code** order. A child finishes its memory and profile phases before the next starts. Navigation or reload reconnects to the current job without resubmitting it. One web preview or import can run at a time, including legacy single-host jobs. A host tab shows only the results of its own host. The overview shows the whole job. When you change Scope or the project directory, the session lists clear. Select **List sessions** again.

While a real import runs, the Sessions card shows a green progress bar for the active host. It names the host and the phase, **Memory units**, **Skill turns** or **Profile batches**, with the done count out of the total. A run without project memories shows **Skill turns** while it reads the turns. The two phases keep separate counts. A preview shows no bar.

When a real import ends while you are on the page, a dialog opens with one **OK** button. A successful run says **Import successful 🎉** (the 🎉 shows in English only) with the counts. A failed run names the host and the reason. If memory units failed, a line **Failed memory units: N** shows the count from the host's results. **OK** reloads readiness, host status and the job without a page reload. Your lists, selection and options stay. A cancelled run shows **Import cancelled** under the buttons and opens no dialog. If a real import ended while the page was closed, a banner shows the result with a **Dismiss** button. The page remembers the dismissed run in your browser, so the banner returns only for a later run. A preview never opens a dialog or a banner.

Results show the current host and phase, each host's state, and combined counts. Hosts can be queued, running, done, failed, cancelled, no-work or not-run. Memory units and profile batches are separate measures. Finished memory extraction still leaves the profile phase to complete.

Grouped results' **Unresolved sessions** counts source sessions with missing project folders, excluding ignored directories. These sessions stay outside import selections. No-work hosts retain their unresolved count. Combined results count each selected host once. One unresolved OpenCode project with five sessions contributes five. Legacy single-host summaries retain their unresolved-entry count for compatibility; that project contributes one there.

Results also show **Skipped memory units**, **Held-back turns**, **Untimed turns** and **Load errors** from existing report metadata. Held-back turns are newer than the listing cutoff. Untimed turns remain included when date limits apply.

A thrown error, failed memory unit or profile error fails the group. Later children become **not-run**. Completed results and ledger progress remain. When memory units fail, the message reads: some memory units failed, completed work is saved, and a new preview and import retries only the failed units. The message carries no number, so every language can translate it; the failed count shows apart. A profile failure says that profile learning failed and completed memory work is saved. Each child honours the existing per-host claim, so a competing CLI import or backfill can refuse that child.

**Cancel after current unit** stops the active child at its safe boundary. Cancellation during preparation can stop earlier. Queued hosts are cancelled; completed results remain. Cancellation does not undo stored results.

To continue after failure or cancellation:

1. Fix the named host's source, model or competing-run problem.
2. Refresh the session lists.
3. Preview the unfinished work.
4. Confirm a new import.

Normal retries use existing host ledgers to skip completed work and retry failed or waiting work. **Re-analyse handled history** intentionally forces the selected outputs again; leave it off for an ordinary memory retry. Forced profile replay keeps its once-per-prompt identity. A server restart ends the in-memory group and never restarts its queued children. Start a fresh preview and confirmation after restart; completed ledger work survives.

### Record past turns

**Record past turns** records the turns of all past history into `skills.db` in one run. The **Skill learning** card on the Settings page offers it after you turn on **Record agent turns**. The Skills page offers it too while no turns are recorded.

- The run is a grouped import with **Skill turns** only. It reads every set-up host (Pi, OpenCode and Claude Code), all projects and every session, with no date limit.
- It also reads sessions whose project folder no longer exists. Their turns use the recorded folder path for the project name.
- It makes no model call.
- It runs as the current import job, so this page shows its progress bar with the phase **Skill turns**. When it ends, it shows the count of turns recorded.
- It is safe to run again. A second run with no new history records no turns and reports them as already present.
- `om-memory-system skills record-past --yes` runs the same group in a terminal. See [CLI: Record past turns](cli.md#record-past-turns).

### Historical import badges

The badges above the form describe each host's latest import and backfill records. They are separate from the current grouped job's outcome.

- **Imported ✅:** the latest run finished with no pending exchanges or unresolved sessions.
- **Partly imported (N unresolved):** the latest run finished with unresolved sessions. Select it to reveal that host in Resolve missing project folders.
- **Running** or **Learning profile:** work or profile learning is active.
- **Stopped (N pending)**, **Paused**, **Failed ⛔️** or **Not started:** the host's recorded state.

Ignored folders leave unresolved counts without importing their sessions. Historical badges retain their existing rules: a finished run with failed exchanges can await retry without a Failed badge. The current group still reports failed units or profile work as failure. Check its results before treating a grouped run as successful.

## Automatic import

Automatic import, or backfill, reads older conversations in the background and populates project memories and user profile input. It makes model calls. It starts about 30 seconds after Pi or OpenCode starts. Claude Code starts it after the first session start that reaches the web app.

**Import past chats automatically** keeps the existing global `autoBackfill` switch. Turning it off stops a running backfill after its current exchange. The first backfill fixes each host's cutoff; later starts resume pending work with that cutoff and ledger. Live capture handles newer turns. A model change applies at the next run.

Each host's view holds its own automatic-import controls: the status header, the run facts below it, and the host's settings. The overview card shows the state in one line. Unsaved model choices stay while counts refresh.

The Pi and OpenCode **Backfill model** choices remain:

- **Same as live capture:** saves `inherit` to `piBackfillModel` or `opencodeBackfillModel`.
- **External API:** saves `external` and can run with no host open.
- A listed or typed `provider/model`: uses that host's sign-in for backfill only.

Live capture keeps its own model. Claude Code has no backfill-model setting and always uses the external API. Missing settings block **Resume** and **Retry** with a reason.

The status header shows the model, cutoff, errors and active run's starting surface. During memory extraction they show a progress bar, percentage, done/total and minutes left. The time estimate uses the recent rate and stays unknown until enough progress exists. **Learning profile** shows batches done/total after the exchanges. When idle, **Last run** shows its finish time, starting surface and imported, skipped and failed counts, without a progress bar.

Counts refresh every three seconds during a run. Operational progress leaves already handled exchanges out of pending model work. Unresolved counts are sessions, excluding ignored folders. Their links open that host's **Sessions that need a folder**. Overall historical badges appear once, in Import chat history.

### Pause and Resume

- **Pause** stops after the current exchange, including a run in another process. With no run going, it saves the pause so no automatic run starts. The pause survives host restarts.
- **Resume** clears the pause and starts the host's backfill from the ledger, with its existing cutoff, maps and model rule.

Only one import runs per host across automatic, web, terminal and in-session surfaces. Resume and Retry execute in the web app. Pi needs an open host or an external backfill model; standalone OpenCode web backfill needs the external API. Claude Code always runs in the web app with the external API. See the [Pi](pi-history-import.md#automatic-import), [OpenCode](opencode-history-import.md#automatic-import) and [Claude Code](claude-code-history-import.md#automatic-import) guides.

## Profile learning

### Analyse waiting prompts

This action reads prompts already waiting inside OMMS. Completed history stays handled. The card shows waiting prompts and estimated profile analysis calls, excluding trivial prompts. The saved external API analyses eligible prompts oldest first, in batches of 50.

1. Select **Analyse waiting prompts**.
2. Review the estimate and confirm model calls.
3. Watch batches done and remaining prompts.

**Pause** stops after the current batch. **Resume** continues. A failed batch stops with its reason code, such as `timeout` or `http-429`. Finished batches stay learned; another run continues from waiting prompts.

One catch-up run works across processes and cannot overlap a live pass. A second start in the same web app gets `409`. A new terminal run takes over from a page run after its current batch; the page shows **A newer catch-up run took over.** A stale run record expires after ten minutes. An explicit catch-up ignores the live-pass failure wait. Claude Code's live profile pass pauses during catch-up.

Open the page on the computer running OMMS to start, pause or resume catch-up. The endpoints are `GET /api/settings/profile/catch-up` and `POST /api/settings/profile/catch-up/start`, `/pause`, `/resume`. POST requires a local caller and the token file `~/.omms/.auth-token`; other callers get `403`. For another model, use [CLI: Profile catch-up](cli.md#profile-catch-up).

### Automatic profile cleanup

The **Profile learning** card also holds the controls of the automatic cleanup. OMMS merges duplicate profile items and removes vague ones by itself, in the background, after a learning pass. See [Using memory: Automatic cleanup](using-memory.md#automatic-cleanup).

| Control                                  | Config key                       | Default | Allowed                          |
| ---------------------------------------- | -------------------------------- | ------- | -------------------------------- |
| **Clean up the profile automatically**   | `userProfileAutoCleanupEnabled`  | on      | on or off                        |
| **Run every this many analysed prompts** | `userProfileAutoCleanupInterval` | 500     | a whole number from 50 to 100000 |

1. Clear or select the switch. The change saves at once.
2. To change the interval, type a whole number and select **Save interval**. Another value shows a message beside the field and writes nothing.
3. The change applies to the next learning pass. You do not restart anything.

Each run makes about one model call for every 100 profile items, so a longer interval costs less. The page does not accept an interval below 50, because each run is paid for. A project config cannot override these two settings; the page shows and saves the global value. **Undo last automatic cleanup** is on the Profile page. Saving uses the [safe global save](web-ui-settings.md#how-saving-works) of the other settings, and keeps comments and other keys in your config file.

### Re-analyse chat history

Select **Re-analyse chat history** to open Import chat history with **User profile** selected, **Project memories** deselected and **Re-analyse handled history** enabled. This presets the form; it starts no model work. Choose hosts and scope, list sessions, preview and confirm.

The run preserves the existing profile and leaves project memories unchanged while the preset outputs remain selected. Findings use existing matching and retention rules. Similar findings can merge. Each profile prompt can be forcibly re-analysed once; later forced runs report it as already handled. Re-analysis does not guarantee more workflows. Profile identity selection and merging remain in [Settings](web-ui-settings.md#profiles).

### Analysis-call estimates

Preview estimates use eligible, non-trivial history prompts after privacy filtering and ledger checks. History prompt reports and the shared waiting backlog remain separate from the analysis-call estimate. The combined estimate deduplicates overlapping prompt identities and counts waiting prompts once across selected hosts. Per-host estimates can include that same backlog; adding them would count it repeatedly.

Analysis calls use `ceil(total eligible prompts / profile batch size)`. Memory units and profile batches remain separate counts. Matching, deduplication, retries and newly waiting prompts can add calls. Estimates provide no spending cap.

## Memory limits

Open **Shared** (`/memory/shared`) and expand **Memory limits**. The table has **Setting**, **Value**, **Default**, **Unit** and **Affects** columns. Effects remain visible beside each input.

| Setting                      | Default                                        | Unit               | Accepted values          | Affects                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------- | ------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxMemories`                | 10                                             | Results            | Positive safe integers   | Maximum search results; manual searches can request fewer. Prompt retrieval uses this ceiling.                                                              |
| `chatMessage.maxMemories`    | 3                                              | Memories           | Positive safe integers   | Recent memories at session start in OpenCode V1 and Claude Code. Pi and OpenCode V2 search each prompt.                                                     |
| `autoCaptureMaxContextBytes` | 131072                                         | Bytes              | 16384–16777216 inclusive | Conversation input sent through the shared memory-summary pipeline.                                                                                         |
| `userProfileMaxContextBytes` | 32768                                          | Bytes              | 1024–16777216 inclusive  | OpenCode profile-learning input, including its truncation marker. Other hosts' profile input is outside this control.                                       |
| `retrievalMaxTokens`         | 2000                                           | Approximate tokens | 256–65536 inclusive      | Automatic memory context across all hosts, including profile text, formatting and retrieval wrappers.                                                       |
| `similarityThreshold`        | 0.5 with `qwen3-embedding:0.6b`, otherwise 0.6 | Similarity score   | Numbers from 0 to 1      | Lowest score a memory needs to be returned by search. Lower values return more memories, including less relevant ones. The default depends on the embedder. |

Bytes mean UTF-8 bytes. Approximate tokens use `ceil(bytes / 4)` and can differ from the model's count. Count limits accept up to 9007199254740991. Blank, negative, fractional or out-of-range values are refused; `similarityThreshold` accepts decimals from 0 to 1 and is the only row that does. Smaller limits can omit input or inject fewer or shorter memories. Stored data and manual search content remain unchanged. Limits do not set a spending cap, limit model replies or control Graphify output.

The threshold default follows the active embedding model: 0.5 for `qwen3-embedding:0.6b` (the only embedder measured; see [Configuration: Memory limits](configuration.md#memory-limits)), 0.6 for every other embedder. The **Default** column shows the default for the current embedder, so it changes when you switch embedder.

1. Change the global values you need.
2. Correct validation messages beside the inputs.
3. Select **Save memory limits** when a valid draft differs from loaded values.

**Cancel** restores loaded values without writing. Saving prevents duplicate submissions and shows its outcome. A successful save refreshes the shared revision used by Memory and Settings.

A project override shows its effective value and source. Inputs still edit global values; the project override stays in force. The shallow merge also applies to `chatMessage`: a project object replaces the global object, with defaults for omitted siblings.

Saving `chatMessage.maxMemories` edits only that leaf inside `chatMessage`. Siblings such as `enabled` and `injectOn`, their comments and unrelated keys retain their values and order. Unsupported nested edits are refused. Invalid or stale saves write nothing. If another editor changed the file, check refreshed values and save again.

### Reset to default

Every row has a **Reset to default** button. Selecting it removes that key from the global file through the same safe save flow, so the value follows the default again. For `chatMessage.maxMemories` only that leaf is removed; the other `chatMessage` properties and their comments stay. Reset never writes a project file. A row whose key is absent from the file has its Reset button disabled.

A row whose saved value differs from its default shows a **Differs from default** marker. This is how a file that still holds the old template's `"similarityThreshold": 0.6` becomes visible: with the `qwen3-embedding:0.6b` embedder the row shows the marker, and Reset removes the line so the default 0.5 applies again. A value equal to the default, or no saved value, shows no marker.

Memory uses the existing [safe global save](web-ui-settings.md#how-saving-works), including authentication, origin, validation, conflict and legacy-file rules. It never writes project config. Edit `~/.config/omms/omms.jsonc` directly for file-only configuration. Valid edits apply at the next relevant operation; an active operation keeps its original limits. Invalid live edits retain the last valid settings. See [Configuration: Memory limits](configuration.md#memory-limits) for packing rules and host coverage.

## Keyword matching

Open **Shared** and expand **Keyword matching**, below Memory limits. The card has one choice, **Word matching mode**, which sets `keywordMode`.

| Mode                       | Value   | Effect                                                                                                                                                                                                                      |
| -------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boost (default)            | `boost` | A memory that holds a word of your prompt gains a small score bonus (`keywordBoost`).                                                                                                                                       |
| Rank fusion (experimental) | `rrf`   | Merges a list by meaning and a list by words, so a memory that holds a word of your prompt can be returned although its meaning score is below `similarityThreshold`. It has not been shown to find more relevant memories. |

**Save** is enabled only when the choice differs from the saved value. **Cancel** restores it. The card writes the global config. A project file (`<project>/.opencode/omms.jsonc`) can still override the mode, and the card then says so. See [Configuration: Where the settings live](configuration.md#where-the-settings-live) for the global and project file locations on macOS and Windows. While the reranker is on, search uses the boost, and the card says that when you choose rank fusion. `keywordBoost` stays a config-file setting: see [Configuration: Keyword matching](configuration.md#keyword-matching). The card uses the same safe global save as the other Memory cards.

## Reranker

Open **Shared** and expand **Reranker**, below Keyword matching. The card configures the opt-in reranker stage: a switch labelled **Use a reranker** (off by default) and four fields.

The reranker settings are global only: they live in the global file, and a project file cannot change them. The global file is `~/.config/omms/omms.jsonc` on macOS and `%USERPROFILE%\.config\omms\omms.jsonc` on Windows. A project file is `<project>/.opencode/omms.jsonc`. See [Configuration: Where the settings live](configuration.md#where-the-settings-live).

| Field      | Setting             | Notes                                                                                                             |
| ---------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Server URL | `rerankerApiUrl`    | Required before the switch can be saved on. Non-loopback URLs show a notice that memory text leaves this machine. |
| Model      | `rerankerModel`     | Required before the switch can be saved on.                                                                       |
| Key        | `rerankerApiKey`    | Optional. Must be an `env://` or `file://` reference; literal keys are refused.                                   |
| Timeout    | `rerankerTimeoutMs` | Milliseconds, default 4000, from 500 to 30000.                                                                    |

The card states what the reranker does, that it sends the prompt and candidate memory text to the server URL, that a server on the same machine is recommended, and that a project file cannot change these settings. Beside the timeout it notes that the default 4000 keeps the search inside OpenCode V2's 5-second wait, and that a value over 5000 can make OpenCode V2 send the request with no memory.

- **Save** writes only the five reranker keys through the same [safe global save](web-ui-settings.md#how-saving-works) as Memory limits, and refreshes the shared revision. It is disabled while the switch is on with a blank URL or model, while a key is not a reference, or while the timeout is out of range.
- **Test** sends two fixed sample documents to the drafted URL and model, using the drafted timeout, and reports success or a failure code such as `reranker_unreachable`. No prompt or memory text leaves during a test.
- **Cancel** restores the saved values without writing.

See [Configuration: Reranker](configuration.md#reranker) for the endpoint contract, a `llama-server --reranking` example, and the fallback rules.

## Resolve missing project folders

A directory map links a recorded project folder to its current folder, for example after moving a repository or deleting a worktree. Saved maps apply globally to every host at the next import or backfill run.

- **Saved maps** starts collapsed and shows the `importPathMaps` count. Maps are grouped by target folder, largest group first. Each target group is collapsed.
- **Remove** marks a saved map for removal; **Keep** undoes it. **Save removals** saves pending removals.
- Keep maps after importing their sessions. Resolution happens before ledger checks. Removing a needed map makes its sessions unresolved again. Previously stored memories remain.
- **Ignored directories** lists `importIgnoredDirectories`. **Restore** immediately saves removal from that list. The folder returns to each host list that reported it.
- Each host view lists its **Unresolved directories** open, with a folder field on every row. Its summary counts directories, unresolved sessions and rows with targets. Collapsing keeps unsaved targets. **Shared** keeps **Saved maps** and **Ignored directories**.
- **Ignore** immediately saves the folder to `importIgnoredDirectories`. Its sessions leave unresolved counts and stay unimported. Maps, ledger and history files remain unchanged.
- **Ignore all** lists every directory it will ignore, with session counts, and saves them in one global save after you confirm. Cancel saves nothing. It never covers **No directory recorded**.
- Sessions with **No directory recorded** cannot be mapped or ignored.

A Partly imported badge or status-header folder link opens the matching host view at its folder list. Navigation saves nothing and starts no import.

### Suggestions

For each missing folder, the first matching rule supplies a proposal:

1. **Not a project.** Temporary folders, paths containing `node_modules`, `~/Library/Application Support`, `~/.agents/skills` and Claude Code's skills folder get an ignore proposal with a reason. Temporary locations include `/tmp`, `/private/tmp`, `/private/var/folders` and the system temporary folder.
2. **Same remote.** Exactly one existing known project with the recorded git remote gives an **Exact** target.
3. **OpenCode record.** OpenCode's recorded project folder gives an **Exact** target. When missing, the other project-resolution suggestion rules apply to it.
4. **Deleted worktree.** The main repository gives a **Name match**. For `~/code/app-feat-x` or `~/workspaces/app/feat-x`, the suggestion is `~/code/app`. A linked worktree's `.git` file leads to its main repository; a live linked worktree is never the target.
5. **Moved folder.** Exactly one known project with the same folder name gives a **Name match**. Multiple matches give no suggestion.
6. **Rename guess.** Exactly one neighbouring project whose name parts match gives a **Guess**. Parts must equal old parts or their initials in order, with at least two exact parts. For example, `om-pi-subagents` can match `opinionated-modular-pi-subagents-system-ompss`.

Known projects come from the memory store, saved map targets and OpenCode's recorded folders. Suggestions read local data without changing the store, history or Git, and make no network requests. Claude Code's folder follows `claudeConfigDir`, then `CLAUDE_CONFIG_DIR`, then `~/.claude`. **No suggestion found.** means you must type a target, ignore the folder or leave it unresolved.

### Smart resolve

**Smart resolve directories** opens the host's review dialog. It is the way to save unresolved-folder maps. Review shows **Proposed maps**, **Suggested to ignore** and **No target**. Maps include target, session count and confidence; ignores include reason and session count. An edited target counts as Exact; a cleared target stays empty.

Exact and Name match proposals and all ignore proposals start ticked. Guess proposals start unticked. **Confirm** saves ticked maps to `importPathMaps` and ticked ignores to `importIgnoredDirectories` in one global save. It is disabled with no ticked proposals.

1. Expand the host.
2. Expand a row to type or edit a target, if needed.
3. Select **Smart resolve directories**.
4. Review the ticks and targets.
5. Tick a Guess only after checking its target.
6. Select **Confirm**.

Existing maps and ignored folders stay. Unrelated target drafts and pending removals stay unsaved. A confirmed source has one global map across hosts. Cancel, Escape and closing the dialog change nothing. A rejected save keeps the review, ticks and error. If settings changed elsewhere, review again before confirming. Saving prevents duplicate submissions and dismissal.

After a successful save with a failed refresh, select **Refresh list** without saving again. Opening review, confirming maps, ignoring and restoring start no import. Saving does not recreate folders. A missing target leaves sessions unresolved. Per-run `--map` overrides a saved map for the same folder; memories already imported remain after removing it.

The host lists reflect session listings and full-history scans, which find unresolved sessions across the whole source in both scopes. An automatic backfill sees only history before its cutoff, so it never replaces a whole-history list; it is used only while the host has none. A current-project import or explicit session selection does not replace the full unresolved list.

## Old Settings links

Existing Markdown section anchors in the [Settings guide](web-ui-settings.md) link here. Bookmarked app URLs redirect as follows:

| Old URL                                                                               | Current URL                            |
| ------------------------------------------------------------------------------------- | -------------------------------------- |
| `/settings#settings-section-import`, `/memory#memory-section-import`                  | `/memory`                              |
| `/settings#settings-section-auto-import`, `/memory#memory-section-auto-import`        | `/memory`                              |
| `/settings#settings-section-profile`, `/memory#memory-section-profile`                | `/memory/shared#shared-profile`        |
| `/settings#settings-section-memory`, `/memory#memory-section-limits`                  | `/memory/shared#shared-limits`         |
| `/memory#memory-section-keywords`                                                     | `/memory/shared#shared-keywords`       |
| `/memory#memory-section-reranker`                                                     | `/memory/shared#shared-reranker`       |
| `/settings#settings-section-directory-maps`, `/memory#memory-section-project-folders` | `/memory/shared#shared-directory-maps` |
| `/settings#directory-maps-<host>`, `/memory#directory-maps-<host>`                    | `/memory/<host>#host-unresolved`       |

Import and automatic import name no host, so they open the overview. A Shared row opens when a link names it. Legacy navigation replaces the old history entry, so Back does not cycle between the two URLs. Unrelated Settings anchors remain there; profile identities use `/settings#settings-section-profiles`.

## Troubleshooting

| What you see                      | What to do                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| A source or reader is unavailable | Fix its path or reader, or deselect that host. Refresh lists and preview again.                    |
| External API is not ready         | Complete External API in Settings. Ensure its key resolves in the web app process. Preview again.  |
| Session list is out of date       | Refresh the affected host's list. Review its selection and preview again.                          |
| An import is already running      | Reconnect to the current job or wait for that host's CLI or backfill run to finish.                |
| Group failed or was cancelled     | Keep completed results. Fix the named problem, refresh lists, preview and confirm unfinished work. |
| Memories not saved                | Fix the service in the reason, such as the embedding server, then select **Check again**.          |
| Resume is greyed out              | Read the sentence under it. Select **Use external API** or open the host.                          |
| Config changed before save        | Review refreshed values and save again.                                                            |

For the additive grouped API and legacy response fields, see [For developers: Web history-import API](developers.md#web-history-import-api).
