# Web UI

The OpenCode plugin serves a memory explorer at `http://127.0.0.1:4747`. Use it to browse the memory–prompt timeline, inspect captures, edit memories and manage your user profile. Pi does not start the web UI; when both run, OpenCode owns the port.

The sidebar footer shows the current language as EN, ZH, or AR. Select the code to open the language menu, then choose English, Chinese, or Arabic. Opening or closing the menu keeps the current language. The choice is saved for the next visit.

## Settings page

Open `http://127.0.0.1:4747/settings` or select the cogwheel in the sidebar footer. OpenCode serves the page. Pi uses the same global config and store, but does not serve the page itself.

- **Models:** Choose the session model or a signed-in model for each host. Manual mode shows a model picker when the server can list models. Type `provider/model` when it cannot. The cards show the effective model and the read-only external API fallback. Project overrides take precedence. The page shows whether credentials are configured, without showing their values. An isolated preview cannot list OpenCode models because it has no OpenCode client; the plugin-hosted page can.
- **Capture diagnostics:** Select 1, 7, 30, or 90 days to see outcomes, failure reasons, and recent attempts. You can set attempt and trace retention, enable tracing, and inspect or delete trace files. Traces can contain conversation content after redaction. Turn tracing on only when you need it.
- **Health:** Run config, store, embedding, web binding, model-selection, and capture failure checks. An optional model test sends a fixed short prompt. A session model needs an active host session to test; the OpenCode server cannot call a Pi session model.
- **Import and backfill:** See [Importing from the page](#importing-from-the-page).
- **Log:** View the most recent OMMS log lines. Filter for capture attempts or copy the log path.

Saves change only the global config. Existing comments and unrelated keys remain. If the file changed while the page was open, review the reloaded settings before saving again. A first save from a legacy-only install copies that file into `~/.config/omms/omms.jsonc` and leaves the old file unchanged. New capture and profile work in running hosts picks up the saved settings without a restart.

## Importing from the page

1. Choose Pi or OpenCode and select **List sessions**. The list shows each session's date, ID, project directory, and how that directory was found. It never shows prompts or replies. The default is the current project.
2. Tick sessions, or choose **Select all matching**, which covers every page. Untick sessions to leave them out.
3. Select **Preview (dry run)**. It reports the sessions and turns that would be imported and makes no model calls or writes.
4. Select **Start import**. Progress updates every second. **Cancel after current unit** stops at a safe point, and a later run imports the rest. The page and the CLI share one ledger, so nothing is imported twice.

What the page guarantees:

- **The preview and the import use the same sessions.** If a new session appears after you list, or a selected session disappears, the page asks you to refresh the list instead of changing the selection.
- **Newer turns wait for the next run.** Turns written after you listed the sessions are held back, and the report says how many. List the sessions again and import to include them. Nothing is lost or duplicated.
- **Changing the scope, project, source, or directory maps** asks you to refresh the list before you can preview or import.

**Advanced options** hold the source, scope, project, prompt dates, directory maps, profile batch size, and the force and skip switches.

- **Source.** Pi takes a sessions folder or one `.jsonl` session file. OpenCode takes a database file, which contains many sessions. Enter an absolute path, including one on a mounted volume. **Browse** lists one folder at a time, and only when the server is bound to loopback. On a network bind, enter the path instead. The browser never uploads files; the server reads them in place and never changes them.
- **Prompt dates** are inclusive whole days in your browser's time zone. They filter the turns inside each session, not the session list. Turns without a timestamp are always included and counted in the preview.
- **Directory maps** (`old=new`, one per line) take precedence over the recorded directory. Sessions whose directory no longer exists appear under **All projects** with the recorded path, and you can import them once a map resolves them. In the current-project view the page shows how many there are.
- **Large OpenCode databases.** While OpenCode is running, its database has a write-ahead log, so the server reads a private copy. It checks that the temporary folder has room for the database, its log, and a margin before copying, and it says how much space is needed if not. The listing, preview, and import share one copy, which is removed after 30 minutes idle and when OpenCode stops. A copy of a database on another volume, or over 1 GB, is tried once; if OpenCode changes the database during that copy, quit OpenCode or choose a checkpointed backup.

**Model readiness.** A real import needs a model that OpenCode is connected to, or a complete saved external API (`memoryProvider`, `memoryModel`, `memoryApiUrl`, and `memoryApiKey`). Pi sign-ins cannot run a web import, because the OpenCode process cannot call Pi models. The page checks readiness inside the OpenCode process, so an `env://` key that exists only in your shell shows as missing. "Configured, not tested" means the settings are present; use **Health** to test a call. A preview needs no model. Pi previews and imports need the Pi SDK (`@earendil-works/pi-coding-agent`) installed where OpenCode loads the plugin; the page says so when it is missing.

## Network binding

Keep `webServerHost` on `127.0.0.1` unless you intentionally expose the UI. Binding to `0.0.0.0` (or any non-loopback host) requires `webServerApiToken`; all `/api/*` requests must then send `Authorization: Bearer <token>` or `X-Omms-Token` (the legacy `X-Opencode-Mem-Token` header is still accepted). Open the UI with `?apiToken=<token>` so the browser stores and sends it.

## HTTP Basic Auth

When `webServerHost` is set to anything other than loopback (for example `0.0.0.0`), the web UI is reachable by anyone on the network. To keep your memories off the LAN, gate the web server with HTTP Basic Auth via the same config file used for everything else:

```jsonc
{
  "webServerHost": "0.0.0.0", // optional: reach the UI from the LAN
  "webServerAuthPassword": "pick-a-strong-one",
  "webServerAuthUsername": "admin", // optional, defaults to the current OS user
}
```

| Field                   | Default           | Effect                                                                                                                       |
| ----------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `webServerAuthPassword` | _(empty)_         | When set, the server demands HTTP Basic Auth credentials on every request. Leave empty to keep the open-by-default behavior. |
| `webServerAuthUsername` | OS user (`$USER`) | Username required by the Basic Auth challenge.                                                                               |

`webServerAuthPassword` accepts the same secret formats as `memoryApiKey`:

- a literal string (simple, fine for personal machines),
- `env://SOME_ENV_VAR` to pull the value from the environment at startup,
- `file:///path/to/secret` to read it from a file (`chmod 600` recommended — the plugin will warn if the file is world-readable).

The browser will pop its native Basic Auth dialog and remember the credentials for the current session; closing all browser windows discards them, so reopening the browser requires signing in again. Credentials are compared with a constant-time check, and the unauthenticated 401 response carries `Cache-Control: no-store` so no intermediate cache will replay it. CORS is also relaxed once auth is on, so other tools on the same LAN can talk to the API after authenticating.

## Re-embedding

Dimension migrations generate every new embedding first, import them into a temporary indexed shard, verify the row count, and only then replace the original file. Failed migrations leave the source shard untouched.
