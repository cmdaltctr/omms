# For developers

## Public subpath exports

The package has one stable subpath that other OpenCode plugins can import.
Use it to read or write the same memory store without copying the
container tag rules.

The other exports are plugin entry points: `.` and `./server` (V1 and V2
plugin, `dist/plugin.js`) and `./v2` (`dist/v2/plugin.js`).

### `om-memory-system/tags`

Container tag helpers. OMMS uses the same functions to scope the memories it
captures.

```ts
import { getProjectTagInfo, getUserTagInfo, getTags } from "om-memory-system/tags";

// Project tag from cwd (git remote URL if present, else the project root
// path). Format: `omms_project_<sha16>`. Rows written by older versions are
// migrated automatically on first start.
const projectTag = getProjectTagInfo(process.cwd()).tag;

// User tag from `git config user.email`.
// Format: `omms_user_<sha16>`.
const userTag = getUserTagInfo().tag;

// Both at once.
const { user, project } = getTags(process.cwd());
```

- These tags match the tags that automatic capture writes.
- A plugin that calls `POST /api/memories` with these tags writes to the same shards as the rest of OMMS.
- `/api/stats` and `/api/memories` ignore tags that do not contain `_project_` or `_user_`. Use the helpers to avoid this.

## Development and contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full workflow: setup,
checks, commit messages, and pull requests.

To build and check locally:

1. Install dependencies: `bun install --frozen-lockfile`.
2. Install web UI dependencies: `(cd web && bun install --frozen-lockfile)`.
3. Run format check, lint, and typecheck: `bun run check`.
4. Build `dist/` and the web UI: `bun run build`.
5. Run the full gate before a push to a pull request: `bun run ci:local`.

See [CI](ci.md) for what each command does.

Contributions are welcome: bug fixes, features, documentation, and more
embedding models. If you are blocked or have an idea, open a pull request.

## Platforms and storage

**CI-tested platforms:** Linux, Windows, and macOS 15 and macOS 26 on Intel
(`darwin/x64`) and Apple Silicon (`darwin/arm64`). The matrix does not block
older macOS releases. They are only outside the current GitHub-hosted runner
set.

- Turso/libSQL stores and searches the vector embeddings. Inserts update the vector index automatically.
- Vector search uses the libSQL DiskANN index through `vector_top_k` (approximate nearest neighbours).
- Automatic capture and user profile learning need an AI model that can return structured (tool-call) output.
- Memory search, add, and list work without a capture model.

Architecture: [shared core](shared-core.md), [OpenCode adapter](opencode-adapter.md), [Pi adapter](pi-adapter.md), [CI](ci.md).

## Web history-import API

The Memory page uses the existing `/api/settings/imports` endpoints. Their paths stay unchanged. Grouped requests add `hosts` and shared `options`; legacy single-host requests and response fields remain valid. No combined CLI command is added.

Requests retain authentication, origin and JSON guards. Send `X-Omms-Token` with the local token on loopback, or use the configured API access. Invalid authentication gets `401`, a disallowed origin gets `403`, and a POST without JSON content type gets `415`. Errors use `{ "error": "reason" }` without secrets or conversation content.

### Sources and session lists

| Method and path                               | Request                                                                                                                             | Success                                                                                                  | Errors                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /api/settings/imports/readiness`         | No body.                                                                                                                            | `200`: `external`, `opencode`, `piReader` and `claudeCode` readiness. Configuration is not a model test. | Existing authentication guards.                                                                 |
| `POST /api/settings/imports/sources/validate` | `{ host, path }`.                                                                                                                   | `200`: `kind`, `displayPath` and signed `sourceToken`.                                                   | `400`: unsupported host or invalid path.                                                        |
| `POST /api/settings/imports/sessions`         | `{ host, source?, scope?, project?, pathMaps?, offset?, limit?, refresh? }`. `source` is a signed token; omission uses the default. | `200`: `source`, `total`, `offset`, `rows`, `unresolvedCount`, `revision`, `listedAt`.                   | `400`: invalid request/token; `409`: source changed. An expired snapshot needs a fresh listing. |

Session rows contain `key`, `sessionId`, `createdAt`, `recordedDirectory`, resolved `directory`, `via` and `selectable`. No prompt or reply is returned. Scope defaults to `current-project`; project defaults to the server's working directory. `project`, when supplied, must be absolute. Page size defaults to 50 and is bounded at 200. `refresh: true` takes a fresh OpenCode snapshot; paging can reuse it.

A job selection is either:

```json
{ "mode": "all", "excludedKeys": [], "revision": "FROM_LIST", "listedAt": 1000 }
```

or `{ "mode": "ids", "sessions": [{ "key": "FROM_ROW", "directory": "/absolute/project" }], "listedAt": 1000 }`. Use the actual listing time, revision and source token. Explicit selection accepts 1–1,000 rows. All-matching selection can retain a valid empty grouped child.

### Start a preview or import

`POST /api/settings/imports` accepts this additive shape:

```json
{
  "hosts": [
    {
      "host": "pi",
      "source": "SIGNED_TOKEN_FROM_LIST",
      "selection": { "mode": "all", "excludedKeys": [], "revision": "FROM_LIST", "listedAt": 1000 },
      "modelChoice": "external"
    }
  ],
  "options": {
    "dryRun": true,
    "scope": "current-project",
    "skipMemories": false,
    "skipProfile": false
  }
}
```

`hosts` accepts one to three distinct entries named `pi`, `opencode` or `claude-code`. The server normalises their order to Pi, OpenCode, Claude Code. Every child retains its own signed source, pinned selection and `modelChoice`. Child-specific `options`, mixed grouped/single-host shapes and unknown grouped fields are refused. Shared options apply to every child.

`modelChoice` is `external` or an available connected OpenCode `provider/model`. Claude Code accepts external only and defaults to it. Pi sign-in alone supplies no web model. For a real Pi or OpenCode child, supply the chosen ready model. Preview needs a readable source, without model readiness; a model blocker remains visible in its row.

Success is `202` with the job object directly, not `{ job }`. A real request preflights every child before model calls. Invalid hosts, options, sources or models get `400`; stale selections and a busy web slot get `409`. A later execution error appears in the polled job, since acceptance already returned `202`.

The UI requires a fresh successful preview and paid-work confirmation. The API retains its request shape without adding a preview-ID or confirmation field; clients must provide that review step before setting `dryRun: false`.

| Shared option    | Type and meaning                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `dryRun`         | Boolean; preview without model calls or memory-store writes.                                                       |
| `force`          | Boolean; reprocess handled work for selected outputs, with once-per-prompt forced profile replay.                  |
| `skipMemories`   | Boolean; inverse of the web's Project memories choice.                                                             |
| `skipProfile`    | Boolean; inverse of the web's User profile choice. Both skip options true is invalid.                              |
| `scope`          | `current-project` or `all-projects`; defaults to current project.                                                  |
| `project`        | Absolute path for current-project scope; omission uses the server's working directory.                             |
| `since`, `until` | Date strings or epoch milliseconds, inclusive. The web converts local calendar days to their start/end timestamps. |
| `profileBatch`   | Positive safe integer; default 50.                                                                                 |
| `pathMaps`       | Array of `{ from, to }` strings; per-run maps override matching saved maps.                                        |

Unknown options are refused. Session, maximum-session and raw source flags stay outside options; pinned selections and source tokens replace them.

### Poll or cancel

| Method and path                             | Request    | Success                                                          | Errors                          |
| ------------------------------------------- | ---------- | ---------------------------------------------------------------- | ------------------------------- |
| `GET /api/settings/imports/current`         | No body.   | `200`: `{ job: <job or null> }`. Reading does not resubmit work. | Existing authentication guards. |
| `POST /api/settings/imports/current/cancel` | JSON `{}`. | `200`: `{ job: <cancelling job> }`.                              | `409`: no running import.       |

One in-memory slot holds a grouped or legacy job, including previews. The server completes each child's memory and profile phases before starting the next. Thrown errors, reported failed units and profile errors fail real groups and mark later hosts `not-run`. Dry runs can continue collecting other hosts' counts after a preview error.

Cancellation sets the abort signal, stops at the existing safe boundary and prevents queued children starting. It preserves completed reports and ledger work. Queued sources and readiness are rechecked before model preparation. A competing host claim is respected; the group never replaces another process's claim.

Reload or navigation can reconnect through GET current. Server restart discards orchestration state and invalidates issued source tokens. Refresh listings, preview and confirm again. Retry uses existing per-host ledger keys, including `#profile-rebuild`. Normal retries skip completed work; `force` intentionally reprocesses selected outputs under existing replay rules. No persistent grouped queue or All hosts ledger identity is created.

### Group response fields

| Field                            | Meaning                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `id`, `dryRun`, `state`          | Group ID, preview flag and overall `running`, `cancelling`, `cancelled`, `done` or `failed` state. |
| `activeHost`                     | Current child while execution is active; omitted when finished.                                    |
| `hosts`                          | Ordered child rows.                                                                                |
| `sessions`, `processed`, `total` | Sums of child selection and memory progress counts. These exclude profile batches.                 |
| `summary`                        | Combined structured reports available so far; no conversation text.                                |
| `profileEstimate`                | Combined preview estimate when profile work is enabled.                                            |
| `error`                          | Host-specific redacted failure reason, when present.                                               |

Each child has `host`, `state`, `sessions`, `phase`, `processed`, `total`, `profileProcessed` and `profileTotal`. Child states are `queued`, `running`, `done`, `failed`, `cancelled`, `no-work` and `not-run`. Phases are `preparing`, `memory` and `profile`. Rows can also contain `summary`, `profileEstimate`, a readiness `blocker` and an `error`.

Summary fields are `dryRun`, `sessionsDiscovered`, `sessionsLoaded`, `sessionsFilteredOut`, `unitsTotal`, `unitsImported`, `unitsWouldImport`, `unitsSkipped`, `unitsFailed`, `unitsAlreadyHandled`, `unitsHeldBack`, `unitsUntimed`, `projects`, `unresolved` and `loadErrors`. Combined numeric values sum available child reports. `projects` counts project report entries. For grouped children, `unresolved` comes from source resolution, excluding ignored directories. It includes sessions omitted from import keys because their project folder is missing, including no-work hosts. Each selected host contributes once. Without source-resolution metadata, it sums `report.unresolvedProjects[].sessions` and adds `report.unresolvableSessions.length`. The UI labels this session count **Unresolved sessions**. One OpenCode unresolved-project entry with five sessions contributes five. Combined counts sum available child reports without deduplicating across hosts. The UI also displays existing `unitsSkipped`, `unitsHeldBack`, `unitsUntimed` and `loadErrors` metadata as **Skipped memory units**, **Held-back turns**, **Untimed turns** and **Load errors**.

Optional `summary.profile` has `promptsRecorded`, `promptsWouldRecord`, `promptsAlreadyHandled`, `batchesBuilt`, `remaining` and `failed`. Combined `remaining` uses the latest child's queue reading; `failed` is true if any included profile report failed. Memory units and profile batches must retain separate labels.

Preview `profileEstimate` has `historyPrompts`, `waitingPrompts`, `totalPrompts` and `analysisCalls`. History prompts exclude overlaps with waiting identities. The combined union counts shared waiting prompts once. Per-host estimates also include the shared backlog, so clients must use the combined estimate rather than sum child estimates. Analysis calls use `ceil(totalPrompts / profileBatch)`, after private/trivial filtering and ledger eligibility checks. Matching, deduplication, retries and newly waiting prompts can add calls.

Legacy `{ host, source, selection, options, modelChoice? }` requests retain `host`, `sessions`, `processed`, `total`, optional formatted `report`, structured `summary` and `error`, alongside `id`, `dryRun` and `state`. Poll and cancel retain their `{ job }` wrapper. Legacy `summary.unresolved` retains `(report.unresolvedProjects?.length ?? 0) + report.unresolvableSessions.length`, so an OpenCode project with five unresolved sessions contributes one entry. `summarizeHistoryImportReport` keeps this legacy meaning. Legacy `summary.profile` retains its existing fields without requiring `promptsAlreadyHandled`. Consumers must accept either legacy or grouped responses.

Selected response fields from the shared-backlog preview test in `tests/web-import-group.test.ts`:

```json
{
  "state": "done",
  "summary": { "unitsWouldImport": 6 },
  "profileEstimate": {
    "historyPrompts": 1,
    "waitingPrompts": 2,
    "totalPrompts": 3,
    "analysisCalls": 2
  }
}
```

This is an excerpt, not the complete job. The three fake children share prompt identities and `profileBatch: 2`. The combined estimate counts the overlap and backlog once while memory reports retain six work units. A completed preview can still carry model blockers; clients must inspect child rows before authorising a real run.

### Read-only preview example

Prerequisites: the local web app is running, all selected default histories exist, and Node 24 is available. This example lists all three histories across projects and submits a dry run. It makes no model calls. Listing can record unresolved-folder metadata and create an OpenCode snapshot.

```bash
BASE=http://127.0.0.1:4747
TOKEN=$(<"$HOME/.omms/.auth-token")
curl --fail-with-body -H "X-Omms-Token: $TOKEN" "$BASE/api/settings/imports/readiness"
curl --fail-with-body -H "X-Omms-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"host\":\"pi\",\"path\":\"$HOME/.pi/agent/sessions\"}" \
  "$BASE/api/settings/imports/sources/validate"
```

The next example obtains real source tokens, revisions and listing times instead of placeholder values:

```bash
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
const base = 'http://127.0.0.1:4747/api/settings/imports';
const headers = { 'X-Omms-Token': readFileSync(`${homedir()}/.omms/.auth-token`, 'utf8').trim(), 'Content-Type': 'application/json' };
async function post(path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}
const hosts = [];
for (const host of ['pi', 'opencode', 'claude-code']) {
  const page = await post('/sessions', { host, scope: 'all-projects', refresh: true });
  hosts.push({ host, source: page.source.sourceToken, modelChoice: 'external',
    selection: { mode: 'all', excludedKeys: [], revision: page.revision, listedAt: page.listedAt } });
}
const job = await post('', { hosts, options: { dryRun: true, scope: 'all-projects', skipMemories: false, skipProfile: false } });
console.log(JSON.stringify(job, null, 2));
JS
```

POST returns `202` before the preview finishes. Poll the current job:

```bash
curl --fail-with-body -H "X-Omms-Token: $TOKEN" "$BASE/api/settings/imports/current"
```

While a job runs, cancellation uses:

```bash
curl --fail-with-body -H "X-Omms-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{}' "$BASE/api/settings/imports/current/cancel"
```

Read the completed per-host summaries and combined estimate before a paid request. Correct blockers, refresh stale selections and obtain another preview as needed. Setting `dryRun: false` starts model work and requires the client's explicit review and confirmation. Original host histories remain unchanged.

The [Memory guide](web-ui-memory.md) covers the user workflow. [ADR-025](adr/025-memory-workspace-sequential-imports.md) records page ownership and the sequential queue. Contract fixtures are in `tests/web-import-request.test.ts`, `tests/web-import-group.test.ts`, `tests/web-import-group-fixtures.test.ts` and `tests/web-import-profile-estimate.test.ts`.
