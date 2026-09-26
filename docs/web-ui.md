# Web UI

The OpenCode plugin serves a memory explorer at `http://127.0.0.1:4747`. Use it to browse the memory–prompt timeline, inspect captures, edit memories and manage your user profile. Pi does not start the web UI; when both run, OpenCode owns the port.

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
