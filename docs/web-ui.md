# Web UI

OMMS serves a web app at `http://127.0.0.1:4747`. Use it to browse and edit memories, manage your user profile, and change settings.

## Starting the web app

One shared web app serves the page for every host. It runs as its own process, apart from any host session. It uses one port, one set of settings, and one memory store.

These things start it:

- **OpenCode, Pi, and Claude Code** each check the port when a session starts (Claude Code: when a hook runs). If an OMMS web app answers, the host uses it. If none answers, the host starts one `om-memory-system web` in the background. The web app keeps running after the session ends.
- **The login item** starts it when you sign in to your computer. Turn it on with `om-memory-system web install`, or on the Settings page. See [CLI: Web app commands](cli.md#web-app-commands). Each host start keeps the newest OMMS copy in the item: the host's own copy, the global install, or the copy the item already runs. An older cached copy never replaces a newer one.
- **`om-memory-system web`** starts it by hand in the terminal. Press Ctrl+C to stop it.

Two hosts that start at the same time start one web app. A start lock (`~/.omms/web-start.lock`) makes the other hosts wait. A lock is stale when its process is gone or it is older than 20 seconds, so a crash does not block a later start.

If another program (not OMMS) uses the configured port, no host starts a web app. The host writes a `port-busy` code to the log. Set `webServerPort` to a free port.

To keep the web app off, set `webServerEnabled` to `false` in the global config. No host then starts it.

OpenCode does not run a web server inside its session. The web app has no OpenCode session, so it cannot use OpenCode's signed-in models. See [Settings page](web-ui-settings.md) for what changes.

## Sidebar header

The sidebar header shows the name **OMMS** in the brand green `#678D6C`. The version of the running web app follows in a smaller font, for example `v4.9.0`. The page reads the version from `GET /api/web/status`. The power button uses the same call every 15 seconds. When a restart brings a new version, the header shows it at the next call, without a page reload. Before the first call answers, the header shows only the name. On a narrow screen, the top bar shows the same name and version. When you collapse the sidebar on a desktop, the header shows only the icon.

## Power button

When you open the page from the same computer, the sidebar footer shows a power button. It is green while the web app answers, and grey when the last check failed. The page checks every 15 seconds. Select it to open a dialog with two actions:

- **Restart** (the main action) starts a fresh copy of the web app on the same port. The page waits up to 30 seconds for the copy to answer, then reloads. If the restart fails and the old web app still answers, the dialog opens again and says so.
- **Stop** turns the web app off and exits it with code `0`. The page shows a stopped screen with the command `om-memory-system web`.

A stop lasts until the next OpenCode start, Pi start, Claude Code prompt, `om-memory-system web install`, or login. Then a host starts the web app again.

The routes are `GET /api/web/status` (version, `canControl`, and an `instance` value that changes with each web app process), `POST /api/web/restart`, and `POST /api/web/stop`. Stop and Restart need the local API token (`~/.omms/.auth-token`) and a loopback caller. Without the token they return `401`. From another address they return `403`. A web app that cannot restart itself returns `409`. On success they return `202` before the web app stops. A second request that arrives while a stop or restart is running also gets `202` and does nothing more. Each request writes one log record (`stopping`, `restarting`, `already_running`, `refused_auth`, `refused_not_loopback`, or `unsupported`) and the version. The log never holds the token. The page hides the button when it may not control the web app.

How Restart works:

- **Login item:** the service manager restarts it (`launchctl kickstart -k` on macOS, `systemctl --user restart` on Linux). If that command fails, the web app starts a detached copy instead.
- **Started by a host or by hand:** the web app starts a detached copy first. The copy waits while the old web app holds the port. The old web app then stops serving and exits when the copy answers. A web app you started by hand loses its terminal, so its output no longer shows there.

The copy takes the port through the 5-second check in "Port ownership and step-aside" below, so a restart takes up to about 7 seconds.

The old web app gives its copy an instance ID. It exits only when `GET /api/health` on the port reports that ID. Health needs no credentials, so this works with HTTP Basic Auth on. Another web app that waits for the port can take it first:

- If that web app is older, the old web app asks it to step aside. It asks each older web app once. The copy then gets a new 15 seconds to take the port.
- If that web app has the same or a newer version, or its version cannot be read, the old web app stops the copy and exits.

A restart does not leave the port empty when the copy fails:

- If the copy cannot start, or exits in its first second, the old web app keeps serving.
- If the copy exits after the old web app stopped serving, the old web app serves again.
- If the copy does not answer within 15 seconds, the old web app stops the copy and serves again.

Each failed restart writes one log record `Web app restart failed` with a code: `spawn-error`, `copy-exit`, `handoff`, or `other-owner`. The code `other-owner` means another web app of the same or a newer version took the port.

### Port ownership and step-aside

One OMMS process owns the port. A process that finds the port busy waits and checks every 5 seconds. It takes the port only when the owner stops answering.

A standalone web app that waits exits with code `0` when the owner runs a newer version. It writes one log record `Web server waiter retired` with its version. An old waiter cannot then take the port when a newer web app restarts.

`om-memory-system web install` can ask an older owner to step aside. The request is `POST /api/web/step-aside`. It needs the local API token (`~/.omms/.auth-token`) and a loopback caller. The owner refuses with `409` when the caller is not newer than itself.

- A standalone web app (`om-memory-system web` or the login item) exits with code `0`.
- A web app inside an OpenCode session stops serving. The session keeps running. The web app waits 60 seconds before it can take the port back, so the login item can bind first. Only an older OpenCode plugin runs a web app in its session.
- Each request writes one log record with the outcome (`stepped_aside`, `refused_not_newer`, or `refused_auth`) and both versions. The log never holds the token.

OMMS 3.5.0 and earlier have no step-aside route. Stop those web apps by hand.

A global install of the terminal command is optional. The login item and the hooks run the newest OMMS copy on the machine without it. To put the command on your `PATH`:

```bash
npm i -g om-memory-system      # or: bun add -g om-memory-system
om-memory-system --version
```

## Update button

When npm has a newer release, the sidebar footer shows an **Update** button. In the open sidebar it sits after the GitHub link. In the collapsed sidebar it shows as an up-arrow icon. On a phone it has its own row above the footer icons. It shows only on this computer, under the same rule as the power button. Select it to open a dialog:

- The running version and the newer release.
- The update command for each host, each with a **Copy** action. OpenCode and Pi need their own update command and a restart.
- **Update web app** installs the release globally and restarts the web app on it. The page shows progress, then reloads on the new version. When a step fails, the dialog shows the failure code and the web app keeps running. When no npm sits beside the web app's Node.js, for example under Bun, the action is off and the dialog says so.

A standalone web app (`om-memory-system web` or the login item) checks npm `latest` when it starts and then every 10 minutes. While a page is open, it checks again when the last check is more than a minute old, so a newly approved release shows within about a minute. A release counts only when it is newer than the running version and is not a prerelease. Set `OMMS_DISABLE_UPDATE_CHECK=1` to turn the check off. A failed check keeps the last result and writes `Web app update check failed` with the code `unreachable`.

`GET /api/web/status` reports the result in its `update` field:

| Field        | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `available`  | The newer release, or `null`.                                  |
| `state`      | `idle`, `installing`, `restarting`, or `failed`.               |
| `code`       | The failure code while `state` is `failed`.                    |
| `canInstall` | `true` when npm sits beside the Node.js that runs the web app. |

`POST /api/web/update` installs the release and restarts the web app onto it. It has the same guards as Restart:

- Without the local API token it returns `401`. From another address it returns `403`.
- With no newer release, with no npm beside Node.js, with no launcher at `~/.omms/bin/omms-launch.mjs` (every restart onto the new copy runs it, the login item's included), or while a Stop or Restart runs, it returns `409`. Stop and Restart also return `409` while an update runs.
- Otherwise it returns `202`. A second request while an update runs also gets `202` and starts nothing.

How the update works:

1. The web app runs `npm install -g om-memory-system@<version>` with the npm beside its Node.js, without a shell (Windows runs `npm.cmd` through one). Only a plain `x.y.z` version reaches npm.
2. The web app reads the version of the install beside its Node.js. It restarts only when that version is the new release.
3. The restart runs the OMMS launcher (`~/.omms/bin/omms-launch.mjs`), so the newest copy on the machine serves. A login item restarts through the service manager, and the login item runs the launcher too.

The web app keeps serving its current version when a step fails. The `code` names the step:

| Code                                  | Meaning                                                                                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permission`                          | npm could not write to the global folder (`EACCES` or `EPERM`).                                                                                                                                 |
| `network`                             | npm could not reach the registry.                                                                                                                                                               |
| `npm-exit`                            | npm failed for another reason.                                                                                                                                                                  |
| `timeout`                             | npm ran longer than 5 minutes and was stopped.                                                                                                                                                  |
| `spawn-error`                         | npm or the restarted copy could not start.                                                                                                                                                      |
| `version-mismatch`                    | The install beside Node.js does not report the new release. A custom npm prefix (`prefix` in `.npmrc`) installs where the launcher does not look. Use the global command in the dialog instead. |
| `no-launcher`                         | The launcher is missing.                                                                                                                                                                        |
| `copy-exit`, `handoff`, `other-owner` | The restart failed. See [How Restart works](#power-button).                                                                                                                                     |

Each update writes `Web app update` log records with the outcome, the code, both versions, the npm exit code, and the duration. The log never holds npm output or the token.

## Filters and memory cards

The Project memories page has two filters above the search box:

- **Project** lists each project. It filters the page to the memories of one project.
- **Label** lists each label with the number of memories that carry it, for example `npm (3)`. It filters to memories with that exact label, ignoring case. When you pick a project, the counts cover that project only. Choose **All labels** to clear it. `GET /api/keywords` returns the list, and takes an optional `tag` parameter for the project.

The search box finds memories by meaning. It ranks results and does not filter by label. A text search clears the Label filter.

A memory card with a prompt shows the prompt, then the memory, each in its own bordered card. Commands in backticks show as code. Fenced code and `<pasted_content>` blocks show in their own code cards inside the prompt. A prompt or memory taller than its limit (240 px for a prompt, 320 px for a memory) is cut short with a fade. Select **See more** to show all of it and **See less** to fold it again.

## Memory badges

- **Memory type** identifies the stored category, such as `analysis` or `bug-fix`. Its pill uses coloured text and an outline with no coloured fill. Each type keeps its colour across cards and reloads. Unknown stored types keep their literal names.
- **Tags** identifies keyword pills. Their existing colours stay unchanged. Select a keyword to filter memories by it.
- Hover or focus a type or tag to show its role tooltip. Tooltip text follows the selected language. Type names and keyword values stay unchanged.
- **LINKED** uses green text and an outline beside the existing link icon. It marks an existing prompt-memory relationship. Unlinked items have no LINKED pill.

Types remain separate from keyword tags. Displaying a badge writes no labels, tags, or relationships to the memory store.

## Language

The sidebar footer shows the current language: EN, ZH, or AR. Select it to choose English, Chinese, or Arabic. The page remembers your choice for the next visit.

## Appearance preview

The approved appearance preview uses warm light and dark themes. The web UI follows the system light or dark setting until you click the theme toggle. Then it keeps your choice in that browser. Interface text uses the system sans-serif font. Technical values use JetBrains Mono. Shared fields and default buttons are 36px high; small and large buttons are 32px and 40px. The mobile navigation target is 44px high. Selected rows use a neutral colour.

Application page titles use H1 at 24px. Main sections use H2 at 18px, with nested H3 titles at 15px. Normal UI text is 14px. These sizes use relative units and follow browser font preferences and zoom. Dialog titles use the 18px section role. Headings inside stored memory Markdown, such as "Request" and "Outcome", render as bold, muted, uppercase 14px labels. Workflow cards in the profile use the same card layout as patterns, with numbered blue step pills, in two columns from 640px.

The preview keeps the existing routes, features, preference keys, legacy migration, right-to-left layout, and save timing. Dialog close labels are translated in English, Chinese, and Arabic. The separately approved dialog correction returns focus only to a connected opener and respects a consumer focus handler.

The preview used synthetic data on loopback port 5179. It did not use the normal web backend.

## Memory page

Select **Memory** or open `http://127.0.0.1:4747/memory`. It opens on four cards of the same size: **Pi**, **OpenCode**, **Claude Code** and **Shared**. A host card opens only that host: its status and main action (Pause, Resume or Retry), its sessions, the folders that need a map, and its own settings. **Shared** holds **Profile learning**, **Memory limits**, **Keyword matching**, **Reranker** and the saved directory maps. Each host card has an avatar that you can change, and the cards turn amber when memories cannot be saved.

**Import all hosts** on the overview opens the multi-host import. It defaults to Pi, Current project and both outputs: Project memories and User profile. **All hosts** explicitly includes Pi, OpenCode and Claude Code without widening project scope. The hosts and scope you tick stay after a refresh. A reviewed preview and confirmation precede model calls. The server runs the selected hosts sequentially and retains completed work after failure or cancellation.

Profile learning separates **Analyse waiting prompts** inside OMMS from **Re-analyse chat history**, a reviewed forced profile-only import. The [Memory page guide](web-ui-memory.md) covers operations, estimates, limits, maps and [old Settings redirects](web-ui-memory.md#old-settings-links).

Browse results on `/project-memories` and `/user-profile`. `/` resolves to Project memories. User profile, Memory and Settings each have an arrow that opens or closes their list in the sidebar, and each remembers its own choice; both remain reachable through desktop collapse and the mobile drawer.

## Chat page

Select **Chat** or open `http://127.0.0.1:4747/chat` to ask questions about your memories and profile. Answers cite their sources. The [Chat page guide](web-ui-chat.md) covers setup, citations, folders, deleting chats, and copying `chats.db` to another computer.

## User profile page

Open `/user-profile` to see learned preferences, patterns and workflows.

The footer of each card shows two numbers:

- **◎ 36** is how many times profile analysis matched this item. It has no upper limit.
- **ⓘ 10 evidence** is the number of evidence items. OMMS keeps up to 10 per item. A card with no evidence does not show it.

Select **10 evidence** to open a window that shows the item's section, its description, and its evidence as a numbered list. Press Escape to close the window. Focus goes back to the button.

The profile model writes each evidence item from your prompts, so an item can be a summary, not an exact quote. **Added by a manual memory save** means that you or an agent saved the item with the `memory` tool.

**Clean up categories** shows the number of categories beside its label. It opens a review of category names that mean the same thing:

1. OMMS groups the names and the profile model proposes one name per group. This runs in the background with a progress line, one model call per 20 groups. On a large profile it can take many minutes. Closing the window does not stop it. **Build a new preview** starts over.
2. Each group lists its names with item counts. Clear a group's box to skip it, or edit its name. Groups that the AI checked start selected. Groups marked **Not checked by the AI** start cleared; select one to include it.
3. **Apply selected** renames the categories of the selected groups. No memory is changed, merged or removed.
4. **Undo last cleanup** restores the names the last cleanup changed.

A group marked **Not checked by the AI** used its most used name because the profile model did not answer. Check its names before you select it: the AI did not confirm that they mean the same thing.

While a preview exists, a banner under the profile details shows its state, so you do not need to keep the window open:

- **Running:** shows the progress, such as "batch 3 of 15", with an **Open review** button.
- **Ready:** says that a preview is ready and how many groups it holds, with the same button.
- **Failed:** shows the error. **Open review** opens the window, where **Build a new preview** starts over.

The banner only reads the state. It never starts a preview or calls the model. It hides while the window is open and shows the current state when you close it. It stays until you apply or undo a cleanup, or the web app restarts. If the web app cannot be reached, the banner is hidden until you open the page again.

An **i** button sits beside **AI Cleanup** and beside **Clean up categories**. Select it to read a short explanation. Press Escape or select elsewhere to close it.

**AI Cleanup** asks the profile model to merge memories that say the same thing and to remove memories that are too vague to help. It can change preferences, patterns and workflows.

1. Choose the memories to check. A shortcut changes the selection and shows a note under the buttons:
   - **Low Freq (≤3)** selects memories that OMMS has seen 3 times or fewer. This is the default.
   - **Same Category (3+)** selects every memory in a category that holds 3 or more memories. The category names must match exactly, so run **Clean up categories** first to select more. Memories with no category are left out.
   - **Select All** and **Deselect All** clear the note.
2. The green box under the list shows how many memories are selected.
3. **Analyze Selected** starts the cleanup. OMMS sends the selection to the model in batches of up to 100 memories, one batch at a time. A batch holds one kind of memory. Memories with the same category go in the same batch, if the category has 100 selected memories or fewer. OMMS splits a larger category across batches. The window shows the progress, such as "Batch 3 of 14", and a **Stop** button.
   - You can close the window. The cleanup keeps running. Open **AI Cleanup** again to see the progress, or the review when the cleanup is done.
   - **Stop** ends the cleanup and shows your selection again. Nothing is saved.
4. Review each merge and each removal. When a batch failed, a note says how many batches failed. Their memories stay unchanged.
5. **Apply Changes** saves only the changes you ticked. Every other memory stays exactly as stored, including a memory that the model reworded but did not merge. There is no undo, and the profile keeps only its last 5 versions. Copy `~/.omms/data/user-profiles.db` first.

A finished review stays for 30 minutes, or until the web app restarts. **Back** discards it and shows the selection again.

When every batch fails, the window shows the error with **Retry** and **Back**. **Retry** runs the same selection again. If the error says "Profile changed", the profile was saved after you opened the page. Reload the page, then try again.

A call to an external API must finish in 60 seconds. A call through an OpenCode session model has a limit of 300 seconds. A reasoning model can take longer: on one profile, a batch of 100 took 95 seconds with reasoning and 17 seconds without. If the error says "The model did not answer in time", do one of these:

1. Turn reasoning off, if your provider supports it: `"memoryExtraParams": { "thinking": { "type": "disabled" } }`. This setting applies to every external API call, including memory capture.
2. Choose a faster model in **Settings**.

See [TDR-051](tdr/051-ai-cleanup-timeout-on-large-selections.md).

Profile learning can save while the cleanup runs. Apply then puts your ticked changes into the newer profile. It skips a change when learning changed or removed one of its memories, and says how many changes it skipped.

The model merges memories only inside one batch. Two duplicates in different batches both stay. Run AI Cleanup again after Apply to find them.

**Undo last automatic cleanup** shows beside **History** while OMMS has an automatic cleanup from the last 30 days that you have not undone. See [Using memory: Automatic cleanup](using-memory.md#automatic-cleanup).

1. Select the button. A window shows when the cleanup ran, how many groups of memories it merged and how many it removed.
2. Select **Undo cleanup** to put the original memories back. Select **Cancel** to change nothing.
3. A message says how many changes were restored and how many were not found. A change is not found when learning changed or removed the merged memory after the run.

Undo keeps the other memories that OMMS learned or updated after the cleanup. It replaces each merged memory with its originals, so an update that learning made to a merged memory after the cleanup is lost. Undo does not undo **Apply Changes** in the AI Cleanup window.

## Settings page

Open `http://127.0.0.1:4747/settings`, select **Settings**, or select the sidebar cogwheel. Its arrow opens the section list.

- **External API.** Configure and test your endpoint and key.
- **Models.** Choose live capture and profile-learning models.
- **Embedding.** Change and test the embedder, then re-embed stored memories.
- **Keys and access.** Manage API tokens and the browser password.
- **Capture diagnostics.** Inspect outcomes, retries and debug traces.
- **Health.** Check OMMS components.
- **Claude Code folder.** Configure the host's data folder.
- **Profiles.** Choose or merge profile identities. The card appears with more than one active profile.
- **Web app.** Control the login item and check versions.
- **Log.** Read metadata logs.

[Settings page](web-ui-settings.md) explains these controls. The moved memory operations appear only on Memory. Their existing API paths under `/api/settings` stay valid.

## Opening the page through a terminal proxy

Some terminals send local addresses through their own proxy. For example, Orca opens links as `*.orca.localhost` addresses, not the `http://127.0.0.1:4747` address OMMS prints. Both reach the same server. If the proxied address does not load or asks for a token, open the printed `127.0.0.1` address.

## Network access

Keep `webServerHost` on `127.0.0.1` unless you mean to open the web app to other computers. Loopback means your own computer only.

A web app on a non-loopback host, such as `0.0.0.0`, starts only when one of these exists:

- an API token that has not expired;
- a browser password (HTTP Basic Auth).

Otherwise it refuses to start. The error tells you to create an API token on the Settings page, set a browser password, or bind to `127.0.0.1`.

### API tokens

Create API tokens on the Settings page, in the **Keys and access** card. See [Settings page: API tokens](web-ui-settings.md#api-tokens).

- Each token has a name and an expiry: 7, 30, or 90 days, or never.
- The page shows the value once. OMMS keeps only a SHA-256 hash in `~/.omms/api-tokens.json` (mode `0600`).
- A script sends the token as `Authorization: Bearer <token>` or in the `X-Omms-Token` header. The old `X-Opencode-Mem-Token` header still works.
- An expired or revoked token gets `401`.
- Only a caller on this computer with the local token file (`~/.omms/.auth-token`) can create, list, or revoke tokens.

API tokens replace `webServerApiToken`. At the first start after the upgrade, OMMS imports that config value once as the token `from config file`, with no expiry. From then on, OMMS does not read the key. See [Upgrading: API tokens](upgrading.md#api-tokens-replace-webserverapitoken).

The hosts, the Claude Code hooks, the page, and the `om-memory-system web` commands use the local token file. They need no API token.

## HTTP Basic Auth

On a network address, anyone on the network can reach the web app. Add a password with HTTP Basic Auth.

To set it on the Settings page, open **Keys and access**, then **Browser password**. The page saves the password to a private key file and writes the config keys for you. See [Settings page: Browser password](web-ui-settings.md#browser-password). Restart the web app to use a new password.

You can also set it in the global config:

```jsonc
{
  "webServerHost": "0.0.0.0", // optional: reach the web app from your network
  "webServerAuthPassword": "pick-a-strong-one",
  "webServerAuthUsername": "admin", // optional, defaults to your user name
}
```

| Field                   | Default                    | Effect                                                                  |
| ----------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `webServerAuthPassword` | empty                      | When set, every request needs the user name and password. Empty is off. |
| `webServerAuthUsername` | your operating system user | The user name the browser asks for.                                     |

`webServerAuthPassword` accepts the same formats as `memoryApiKey`:

- a literal value, which is fine on a personal computer;
- `env://SOME_VARIABLE`, read from the environment when OMMS starts;
- `file:///path/to/secret`, read from a file. Use `chmod 600`; OMMS warns when others can read the file.

The browser asks for the user name and password once, and forgets them when you close all its windows.

- OMMS compares the password in constant time.
- The "unauthorised" reply is never cached.
- With Basic Auth on, other tools on your network can use the API after they sign in.

Some Settings actions are refused on a network address without Basic Auth: turning on capture traces and saving a pasted API key.

## Re-embedding

Change the embedder on the Settings page, in the **Embedding** card. See [Settings page: Embedding](web-ui-settings.md#embedding). OMMS re-embeds a store file when its vector size or its stored model name differs from the configured embedder. A store file from an older version with no stored model name is re-embedded only when its size differs.

A re-embed migrates each memory store file safely:

1. OMMS makes every new embedding first.
2. It writes them into a temporary file and checks the row count.
3. Only then does it replace the original file.

A failed migration leaves the original file unchanged.
