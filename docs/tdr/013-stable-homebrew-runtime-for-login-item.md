# TDR-013: Store a stable Homebrew runtime path in the login item

**Date:** 2026-09-28
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** web-ui, login-item, macos, homebrew

## Context

`om-memory-system web install` writes a login item that starts the web app at sign-in. On macOS with Homebrew Node 26.9.0, the plist stored `/opt/homebrew/Cellar/node/26.9.0/bin/node`. After a Homebrew upgrade, the web app no longer started at login. The command also printed only `OMMS login item: installed`, so the user did not know the dashboard address.

### Root Cause Analysis

`resolveWebRuntime` stored `process.execPath`. Node resolves symlinks in `process.execPath`, so it points into the versioned `Cellar` folder and not to the `/opt/homebrew/bin/node` link. `brew upgrade` and `brew cleanup` delete the old `Cellar` folder. launchd then cannot find the program. The plist sends output to `/dev/null`, so nothing records the failure.

## Decision

`stableRuntime` in `src/services/web-autostart.ts` checks for a path that matches `<prefix>/Cellar/<formula>/<version>/bin/<name>`. It stores the first of these that resolves to the same file:

1. `<prefix>/bin/<name>`, for example `/opt/homebrew/bin/node`.
2. `<prefix>/opt/<formula>/bin/<name>`. This link exists for keg-only formulas such as `node@22`, which Homebrew does not link into `bin`.
3. The original path, when neither link exists.

This rule applies to both `process.execPath` and a runtime found on `PATH`.

`web install` also prints `OMMS web app: <url>`, and `web status` adds a `url` field. The URL comes from `webServerHost` and `webServerPort`.

## Consequences

### Positive

- A Homebrew upgrade does not break the login item.
- The user sees the dashboard address after install.

### Negative

- An existing item keeps the old path until `web install` runs again or a host session starts and rewrites it.

### Neutral

- Other version managers, for example nvm, fnm, and Volta, still store a versioned path. Their shims or paths are specific to each tool.

## Alternatives Considered

| Option                               | Rejected Because                                                        |
| ------------------------------------ | ----------------------------------------------------------------------- |
| Always look up `node` on `PATH`      | launchd and the host can have a different `PATH`; can pick another Node |
| Always use `<prefix>/bin/<name>`     | Does not exist for keg-only formulas                                    |
| Start through `/bin/sh -lc node ...` | Depends on shell profiles and adds another process                      |
| Send login item output to a log file | Makes failures visible but does not prevent them                        |

## How to Recognise / Handle This Again

1. The web app does not start at login after a runtime upgrade.
2. Run `om-memory-system web status` and check whether `item.runtime` still exists.
3. Run `om-memory-system web install` to rewrite the item with the current runtime.

## Revisit Triggers

- Homebrew changes its `Cellar` or `opt` layout.
- Users report the same failure with another version manager.

## References

- Issue [#43](https://github.com/cmdaltctr/omms/issues/43)
- `src/services/web-autostart.ts` (`stableRuntime`, `resolveWebRuntime`)
- `src/cli/web-command.ts`
- `tests/web-autostart.test.ts`, `tests/web-command.test.ts`
