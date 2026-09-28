# TDR-014: Read OpenCode v2 models through a private `opencode serve`

**Date:** 2026-09-28
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** opencode, web-ui, settings, security

## Context

The login web app and `om-memory-system web` run without an OpenCode session. The Settings page could not list OpenCode's signed-in models there, because the only list came from the OpenCode plugin's client. The OpenSpec change `standalone-opencode-models` makes OMMS start a private `opencode serve`, read the list over HTTP, and stop the server.

Tests on 2026-09-28 used OpenCode CLI v2.0.18 and `@opencode-ai/sdk` 1.18.25. No 2.x SDK exists on npm.

### Root Cause Analysis

The SDK and the v2 server do not match:

- `createOpencodeServer()` waits for the line `opencode server listening`. OpenCode v2 prints `server listening on <url>`, so the SDK always times out.
- `client.provider.list()` calls `GET /provider`. On v2 that route returns the web app's HTML page. The v2 routes are `GET /api/model` and `GET /api/provider` (see `/openapi.json`).
- `opencode serve` v2 requires a password. Without `OPENCODE_SERVER_PASSWORD`, every request gets 401.
- `/api/model` loads on the first request. It returned 0 models at 117 ms, 32 models from 4 providers at 372 ms, and all 420 at 647 ms.
- Each `/api/model` record has `settings.apiKey` with the provider key in plain text.
- `opencode models` prints nothing on v2. Without `--standalone` it also starts the user's background service.

## Decision

`src/importer/opencode-standalone-models.ts` does this:

1. It finds `opencode` in `~/.opencode/bin`, on `PATH`, then in `/opt/homebrew/bin`, `/usr/local/bin`, and `~/.bun/bin`. On Windows it uses `PATHEXT` and starts `.cmd` files through `cmd.exe`.
2. It runs `opencode serve --hostname=127.0.0.1 --port=0` with `node:child_process`, in the home folder. It sets `OPENCODE_SERVER_PASSWORD` to `randomBytes(24)` for that start.
3. It reads the URL from the first output line that matches `listening on (https?://\S+)`. The pattern matches v1 and v2.
4. It calls `GET /api/model` with `Authorization: Basic opencode:<password>` every 250 ms. It stops when two replies in a row have the same non-empty count. On 404 or a non-JSON reply it uses the v1 route `GET /provider`.
5. It maps each record to `{ provider: providerID, model: id, name }` as soon as the JSON is parsed. `id` can differ from `modelID`, for example `gpt-6-luna-fast` and `gpt-6-luna`. The in-session path uses `id`, so this path does too.
6. It sends `SIGTERM` to the child's process group, and `SIGKILL` after 5 s. OpenCode v2.0.18 takes about 3.6 s to exit on `SIGTERM` once its list is loaded. The stop runs in the background, so the page does not wait for it. On Windows it runs `taskkill /T /F`. `WebServer.stop()` waits for every child that is still running.

The start limit is 10 s and the list limit is 5 s. A listed result is kept for 5 minutes, and a failed one for 30 s.

## Consequences

### Positive

- The standalone web app lists the same models as an OpenCode session.
- Provider keys never reach the log, the cache, errors, or the page.

### Negative

- A cold read costs about 1 s and one process start.
- Project-level OpenCode providers are not listed, because the server reads the global config.
- `/api/model` is marked experimental in OpenCode. A change to it gives the "cannot read" reason until OMMS is updated.

### Neutral

- If OMMS crashes during a read, one `opencode serve` can stay on a random loopback port. It needs the password, which only that OMMS process had.

## Alternatives Considered

| Option                                             | Rejected Because                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| SDK `createOpencodeServer()` and `provider.list()` | It cannot parse the v2 start line, sets no password, and gets HTML from v2. |
| `opencode models`                                  | It prints nothing on v2 and can start the background service.               |
| Read `auth.json` and the models.dev cache          | OMMS would have to copy OpenCode's provider rules and keep them in step.    |

## How to Recognise / Handle This Again

1. The OpenCode card says "OpenCode took too long" or "cannot read" on a machine where OpenCode works.
2. Run `opencode serve --hostname=127.0.0.1 --port=0` with `OPENCODE_SERVER_PASSWORD` set. Check the start line and `GET /openapi.json` for the model route.
3. Update the pattern or the route in `opencode-standalone-models.ts`, and update `tests/fixtures/opencode-v2-api-model.json` from a real reply with the keys replaced.

Never print a raw `/api/model` reply. It holds provider keys.

## Revisit Triggers

- An `@opencode-ai/sdk` 2.x release that supports the v2 server.
- A change to OpenCode's start line, password rule, or model route.

## References

- `openspec/changes/standalone-opencode-models/`
- `src/importer/opencode-standalone-models.ts`
- `src/v2/legacy-client.ts` (the in-session path)
- [Settings page: Model lists](../web-ui-settings.md#model-lists)
