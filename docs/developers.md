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
