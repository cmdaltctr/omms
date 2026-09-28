# ADR-010: Save a pasted external API key to a private key file

**Date:** 2026-09-28
**Status:** Proposed
**Deciders:** OMMS maintainers

## Context

The Settings page gains an External API card so that users can set up an external model (for example a Z.ai GLM endpoint) without editing `omms.jsonc` by hand, and choose it as a host's capture or backfill model with the value `external`. `memoryApiKey` already accepts a literal value, `env://NAME`, or `file://path`. The login web app is started by launchd, systemd, or the Windows Startup folder, which do not load a shell profile, so an `env://` variable set only in `~/.zshrc` does not resolve there. Users still need a way to give the page a key that works in every OMMS process, without the key ending up in the config file, the log, or an API response.

## Decision

The card offers three key sources: an environment variable name (saved as `env://NAME`), the path of an existing key file (saved as `file://path`), and a pasted key. A pasted key is written by the web server to `~/.config/omms/secrets/<name>.key`. The folder is created with mode `700` and the file with mode `600` on macOS and Linux; on Windows both get a user-only access list, using the same code that protects capture traces (moved to `src/services/private-path.ts`). The config then gets `file://` with that path. An existing key file is replaced only after the user confirms. The page never writes a literal key to the config, never logs the request body, and never returns the key. Saving a pasted key is refused on a non-loopback bind without Basic Auth.

An `env://` or `file://` key that does not resolve in a process is treated as not set there, so the card and readiness can report "does not resolve in the web app" instead of the config failing to load.

## Alternatives considered

- **OS keychain.** Needs native code or helper tools on three platforms, and every OMMS process (hosts, CLI, login web app) would need to read it. Rejected for now.
- **Only `env://`.** Does not work in the login web app, which is the main place a user without an open host would configure and run a backfill.
- **Store the literal key in `omms.jsonc`.** The file is often shared or synced, and the page would then write secrets into it. Rejected.

## Consequences

### Positive

- One key source works in every OMMS process, including the login web app.
- The config file and every response hold only a reference.

### Negative

- A key lands on disk in plain text, with the same trust model as the existing `file://` support. File permissions are the only protection.

### Neutral

- Older OMMS versions ignore the key file and read the `file://` reference as before.
