# For developers

## Public subpath exports

In addition to the main plugin entry, `omms` exposes one stable subpath
that other opencode plugins can import directly. This avoids having to
reverse-engineer container-tag conventions when writing third-party tools that
read or write into the same memory store.

### `om-memory-system/tags`

Canonical container-tag helpers. The same functions omms itself uses
to scope auto-captured memories.

```ts
import { getProjectTagInfo, getUserTagInfo, getTags } from "om-memory-system/tags";

// Canonical project tag derived from cwd (git remote URL if present, else
// the project root path). Format: `omms_project_<sha16>`; rows written by
// older versions are migrated automatically on first start.
const projectTag = getProjectTagInfo(process.cwd()).tag;

// Canonical user tag derived from `git config user.email`.
// Format: `omms_user_<sha16>`.
const userTag = getUserTagInfo().tag;

// Both at once.
const { user, project } = getTags(process.cwd());
```

Tags produced by these helpers match what auto-capture writes, so third-party
plugins that call `POST /api/memories` will land in the same shards the rest
of the system already understands. Hand-rolled tags whose substring isn't
`_project_` or `_user_` end up in shadow shards that `/api/stats` and
`/api/memories` silently filter out — using these helpers avoids that pitfall.

## Development and contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full workflow: setup, checks, commit messages, and pull requests.

Build and test locally:

```bash
bun install
bun run build
bun run typecheck
bun run format
```

This project is actively seeking contributions to become the definitive memory plugin for AI coding agents. Whether you are fixing bugs, adding features, improving documentation, or expanding embedding model support, your contributions are critical. The codebase is well-structured and ready for enhancement. If you hit a blocker or have improvement ideas, submit a pull request - we review and merge contributions quickly.

## Platforms and storage

**CI-tested platforms:** Linux, Windows, macOS 15 and macOS 26 on both Intel (`darwin/x64`) and Apple Silicon (`darwin/arm64`). Older macOS releases are not excluded by that matrix; they are simply outside the current GitHub-hosted runner set.

- Vector embeddings are stored and searched directly in Turso/libSQL; inserts update the vector index automatically.
- Vector search uses libSQL's DiskANN index via `vector_top_k` (approximate nearest neighbors).
- Auto-capture and user profile learning require an AI provider that can return structured/tool-call output. Memory search/add/list still work without auto-capture provider configuration.

Architecture: [shared core](shared-core.md), [OpenCode adapter](opencode-adapter.md), [Pi adapter](pi-adapter.md), [CI](ci.md).
