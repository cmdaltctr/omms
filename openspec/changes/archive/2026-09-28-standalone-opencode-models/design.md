# Design

## Context

`GET /api/settings/models?host=opencode` calls `listOpencodeSettingsModels` in `src/importer/settings-models.ts`. That function uses the OpenCode client that the plugin registers through `registerOpencodeHostModels`. The login web app and `om-memory-system web` have no plugin, so no client is registered and the list is always unavailable. Pi's list works everywhere because the Pi SDK reads Pi's sign-ins in process.

Findings from tests on 2026-09-28 (OpenCode CLI v2.0.18, `@opencode-ai/sdk` 1.18.25):

- In an OpenCode v2 session the current path works. `src/v2/legacy-client.ts` reads `ctx.model.list()`. It returned 419 models and no keys.
- The SDK's `createOpencodeServer()` always times out on v2. It waits for the line `opencode server listening`, but v2 prints `server listening on <url>`.
- The SDK 1.18 `client.provider.list()` gets an HTML page from a v2 server. The v2 routes are `GET /api/model` and `GET /api/provider`.
- `opencode serve` v2 requires a password. With `OPENCODE_SERVER_PASSWORD` set by the caller, HTTP Basic auth as `opencode:<password>` works. Without it, requests get 401.
- `--port=0` makes OpenCode choose a free port. The server was listening in about 100 ms.
- The first `/api/model` reply had an empty `data` list. About 1 s later it had the full list.
- Each `/api/model` record includes `settings.apiKey` with the provider key in plain text.
- `opencode models` prints nothing on v2. Without `--standalone` it also starts the user's background service.

## Goals / Non-Goals

**Goals:**

- List OpenCode's signed-in models in any web app process, with or without a session.
- Keep provider keys out of memory longer than one parse, and out of logs, errors, cache, and responses.
- Leave no child process running after a read, on success, failure, or web server shutdown.

**Non-Goals:**

- Health checks, test calls, and history imports in the standalone web app. They run models, which needs a real host session.
- Using or starting OpenCode's background service (`opencode serve --service`).
- Upgrading `@opencode-ai/sdk`. No 2.x release exists on npm.

## Decisions

### 1. Start `opencode serve` directly, without the SDK launcher

OMMS runs `opencode serve --hostname=127.0.0.1 --port=0` with `node:child_process.spawn`, reads the URL from the first line that matches `listening on (https?://\S+)`, and calls the server with `fetch`.

- _Alternative: SDK `createOpencodeServer()`._ It cannot parse v2's start line and does not set a password. Rejected.
- _Alternative: `opencode models`._ It prints nothing on v2 and can start the background service. Rejected.
- _Alternative: read `auth.json` and the models.dev cache._ OMMS would have to copy OpenCode's provider rules and keep them in step. Rejected.

The regex matches both v1 (`opencode server listening on …`) and v2 (`server listening on …`).

### 2. Own password, Basic auth, loopback only

OMMS creates a random password with `crypto.randomBytes(24)` for each start. It passes the password only in the child's `OPENCODE_SERVER_PASSWORD` and in the `Authorization: Basic` header. The child binds to `127.0.0.1`. The password never appears in logs or errors; OMMS redacts it from any captured child output before that output is used.

### 3. Read v2 first, then v1

OMMS calls `GET /api/model`. On a JSON reply with a `data` array, it maps each record to `{ provider: providerID, model: id, name: name || id }` and drops every other field in the same step. If the reply is not JSON or the route returns 404, OMMS calls `GET /provider` and uses the v1 shape (`connected` and `all`) with the existing mapping in `listOpencodeClientModels`. Any other shape is the "cannot read" reason.

This keeps OpenCode v1 users working, because the package still supports the V1 plugin.

### 4. Poll until the list is ready

`/api/model` is empty at first and then fills in stages. On 2026-09-28 it returned 0 models at 117 ms, 32 models from 4 providers at 372 ms, and all 420 models at 647 ms. OMMS polls every 250 ms. It stops when two replies in a row have the same non-empty count, or at 5 s after the server starts listening. A non-empty list that is still growing at the limit is used as it is. An empty list at the limit is the "no signed-in models" reason. The start limit is 10 s, because a cold start after an OpenCode update can be slow. A start that misses the limit is the "took too long" reason.

### 5. Find the program without a shell profile

The login item runs with launchd's short `PATH`. OMMS checks, in order:

1. `~/.opencode/bin/opencode` (the official installer's folder)
2. Each folder on `PATH`
3. `/opt/homebrew/bin/opencode`, `/usr/local/bin/opencode`, and `~/.bun/bin/opencode`

On Windows OMMS checks `PATH` with the extensions in `PATHEXT`, and starts `.cmd` files through `cmd.exe`. Not found is the "could not find OpenCode" reason, and OMMS starts nothing.

### 6. Run the child in the home folder

The child runs with `cwd` set to the user's home folder, so it reads OpenCode's global config and sign-ins. A standalone web app is not tied to one project, so project-level OpenCode providers are not listed. This matches the typed fallback, which also accepts any `provider/model`.

### 7. Stop the child every time

OMMS sends `SIGTERM` after the read, and `SIGKILL` if the child has not exited 5 s later. On 2026-09-28 OpenCode v2.0.18 took about 3.6 s to exit on `SIGTERM` after it had loaded its model list, so a 2 s limit ended in `SIGKILL` on almost every read. The stop runs in the background: the read returns its result without waiting for the child to exit. OMMS does the same on every error path. When the web server stops, it waits for every stop to finish. The module keeps a set of live children for the shutdown hook. The child's stdout and stderr are read only to find the start line, and are capped at 16 KB.

### 8. Share and keep the result

One in-flight read serves all callers. The Models section and the Automatic import section both ask on page load, so they share one child. A successful list is kept for 5 minutes. A failed read is kept for 30 seconds, so a missing program does not cause a search on every request, and a fix is seen soon. Only the mapped `{ provider, model, name }` records are kept.

### 9. Where the code lives

A new module, `src/importer/opencode-standalone-models.ts`, holds the program search, start, read, and stop logic. It takes `spawn`, `fetch`, the clock, and the file check as arguments, so tests need no real OpenCode. `listOpencodeSettingsModels` calls it only when no client is passed and no OpenCode host is registered. The module imports nothing from `src/adapters/`, as the importer boundary test requires, and nothing from `src/config.ts`.

### 10. Reasons are fixed English sentences, translated on the page

The server returns one of a fixed set of English sentences in `reason`. The page passes `reason` through `s()`, as it does for other server text, and `settings.ts` holds the Chinese and Arabic text. The page shows the old generic line only when the server gave no reason, for example when the request itself failed.

| Case                                  | `reason`                                                                                                                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program not found                     | OMMS could not find OpenCode on this computer, so it cannot list OpenCode's models here. Type the model as provider/model, for example zai-coding-plan/glm-5.3. If OpenCode is installed, open an OpenCode session and reload this page. |
| Start or first reply missed the limit | OpenCode took too long to send its model list. Reload this page to try again, or type the model as provider/model.                                                                                                                       |
| Empty list at the limit               | OpenCode has no signed-in models. Run `opencode auth login`, then reload this page.                                                                                                                                                      |
| Unknown reply shape                   | This OpenCode version sent a model list OMMS cannot read. Type the model as provider/model. Update OMMS if this continues.                                                                                                               |
| Pi SDK cannot load                    | OMMS could not read Pi's model list. Type the model as provider/model.                                                                                                                                                                   |
| Pi has no signed-in models            | Pi has no signed-in models. Sign in to a provider in Pi, then reload this page.                                                                                                                                                          |

A test checks that every reason the server can return has Chinese and Arabic text. The existing i18n test only scans literal `s("…")` calls in the `.tsx` files, so it does not cover server text.

### 11. Logging

Each standalone read writes one log record: the outcome code (`listed`, `not_found`, `start_timeout`, `empty`, `unreadable`), the model count, and the times to start and to list. It never logs the URL's password, the reply body, or child output.

## Risks / Trade-offs

- [OpenCode's `/api/model` is marked experimental and may change] → Fall back to the v1 route, return the "cannot read" reason on an unknown shape, and pin the used fields in a test fixture taken from v2.0.18.
- [The reply holds provider keys] → Map to three fields as soon as the JSON is parsed, and never log or cache the raw body. A test puts a fake key in a fixture and checks that it is absent from the result, the log, and errors.
- [A child is left running if OMMS crashes during a read] → The child's life is short (under about 15 s). The web server's shutdown hook stops live children. A crash between start and stop can leave one `opencode serve` process on a random loopback port with a random password. It is not reachable without that password.
- [Each cold read costs about 1 s and one process start] → The 5-minute cache and the shared in-flight read limit this to one start per page load at most.
- [The list comes from global config only] → Project-level providers are not listed. The user can type them.
- [OpenCode's start line changes again] → The start limit gives the "took too long" reason. The page still accepts a typed model.

## Migration Plan

No data or config changes. Rolling back removes the standalone read, and the page returns to the generic line. The API shape does not change, so an older page works with a newer server and the other way round.
