# ADR-011: Shared code never imports a host adapter

**Date:** 2026-09-28
**Status:** Proposed
**Deciders:** OMMS maintainers

## Context

OMMS stands for Opinionated Modular Memory System. One shared engine runs behind two hosts, OpenCode and Pi, and each host has a thin adapter in `src/adapters/<host>/`.

Some shared code had started to reach into adapter code:

- `src/importer/profile-import.ts` imported `isInternalPrompt` from the OpenCode adapter.
- `src/importer/importer.ts` and `src/importer/session-loader.ts` imported Pi's conversation parser from the Pi adapter.

Each import worked, but it tied shared code to one host. A new host, or a change inside one adapter, could then break the other host or the shared importer. The boundary tests covered `src/core/` and `src/services/`, not `src/importer/`, so nothing caught it.

## Decision

Dependencies point one way. Adapters may import shared code. Shared code (`src/core/`, `src/services/`, `src/importer/`, `src/types/`) never imports an adapter.

- Code that knows a host's history format is shared, because the importer, the CLI, and the web app all read history without that host running. It lives in `src/importer/`: `opencode-reader.ts` for OpenCode, and `pi-conversation.ts` with `session-loader.ts` for Pi. The Pi adapter imports `pi-conversation.ts` from there for live capture.
- Code that is the same on every host lives in `src/core/`. `src/core/internal-prompt.ts` recognises omms's own summary and profile prompts.
- Host SDKs load only through dynamic `import()`, only when that host's code runs.
- `tests/pi-adapter-boundary.test.ts` fails when any file in `src/core/`, `src/services/`, `src/types/`, or `src/importer/` refers to `adapters/pi` or `adapters/opencode`.

Adding a host means adding `src/adapters/<host>/` and, when it has importable history, a reader in `src/importer/`. The other hosts do not change.

## Consequences

### Positive

- Each adapter can change, or be removed, without breaking shared code or the other host.
- A test enforces the rule, so it cannot quietly erode again.

### Negative

- Host-format readers sit in the importer rather than beside their adapter, so a host's code is in two places.

### Neutral

- The OpenSpec change `move-opencode-model-code-to-adapter` moved OpenCode's own model code from `src/services/` into `src/adapters/opencode/`. Shared code now reaches OpenCode models through registrations: `registerHostProfileModel` for profile calls and `registerOpencodeHostModels` for web imports, Health, and Settings. The standalone web app registers neither, so it reports OpenCode models as unavailable, as before.
- Follow-up: OpenCode and Pi still run separate profile learning loops (`src/adapters/opencode/profile-learning.ts` and the Pi adapter). One shared loop is future work.
- Follow-up: the OpenCode V2 plugin (`src/v2/`) still wraps the V1 plugin (`src/index.ts`) through a fake V1 client (`legacy-client.ts`). Rebuild it on the native V2 API and drop V1 support in a separate breaking change (4.0.0).

## Alternatives considered

- **Keep host readers in each adapter and let the importer import them.** This is the dependency this ADR removes.
- **A registry that adapters fill at start-up.** The CLI and the login web app read history with no host running, so nothing would register the readers.
