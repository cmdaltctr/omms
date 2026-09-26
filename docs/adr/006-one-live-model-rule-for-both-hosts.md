# ADR-006: One live-model rule for OpenCode and Pi

**Date:** 2026-09-26
**Status:** Accepted
**Deciders:** Project maintainer

## Context

Live auto-capture and profile learning chose their model differently on each host:

- **OpenCode:** `opencodeProvider`/`opencodeModel` (`"inherit"` = the session model), else the external API (`memoryModel`/`memoryApiUrl`/`memoryApiKey`). With neither set, it captured nothing. A failing OpenCode model fell back to the external API.
- **Pi:** `piProvider`/`piModel`, else the session model. It had no external-API option and no fallback, and `"inherit"` was not a recognised value.

The maintainer asked for the same capabilities on both hosts, including pinning the same model (`gpt-5.6-luna`) in each.

## Decision

Both hosts follow one rule, implemented as pure functions in `src/services/ai/live-model-choice.ts`:

1. **Host model:** `opencodeProvider`/`opencodeModel` or `piProvider`/`piModel`. `"inherit"` follows the session's model.
2. **External API:** used when no host model is set and `memoryModel`, `memoryApiUrl` and `memoryApiKey` are all set.
3. **Session model:** used when neither is set.

If the host model fails, or a pinned Pi model is not in Pi's list, the external API takes over when it is configured, with a "Using fallback provider" notice. A partly configured external API (any `memory*` value set, but not all of them) leaves auto-capture off and reports the missing settings instead of switching silently.

OpenCode call sites use `resolveOpencodeHostModel(CONFIG)`: capture, profile learning, dedup and conflict checks, description evolution, and AI cleanup. Pi uses `createPiLiveModels(ctx)` in `src/adapters/pi/live-model.ts`. `getAutoCaptureProviderStatus` gains a `session` mode.

## Consequences

### Positive

- The same settings mean the same behaviour on both hosts. A user can pin one model, follow the session, or use an API key on either.
- Pi gains the external API and the fallback; OpenCode gains a working default with no configuration.
- Existing Pi users with no settings keep capturing with the session model.

### Negative

- OpenCode installs with nothing configured now start capturing with the session model, which spends model calls they did not spend before. Set `"autoCaptureEnabled": false` to opt out.
- In OpenCode, `"inherit"` paths that are not tied to a prompt (profile learning, cleanup) use OpenCode's most recent model from `model.json`, which may differ from the active session's model.

### Neutral

- Keeping the rules free of `config.ts` imports lets tests stub `config.js` without also stubbing the rules.
- The AI-cleanup path no longer falls back to the hard-coded `bs-aigw`/`deepseek-v4-flash` model.
- History imports are unaffected: they follow ADR-005 and always use the invoking session's model or `--model`.

## Alternatives Considered

| Option                                                          | Rejected Because                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Copy OpenCode's rule exactly (nothing configured = no capture)  | Silently stops capture for existing Pi users after an upgrade.       |
| Leave the hosts different                                       | The maintainer requires the same capabilities on both.               |
| Map "nothing configured" to fake `"inherit"` values in `CONFIG` | Hides user settings behind synthetic values in logs and diagnostics. |

## References

- `src/services/ai/live-model-choice.ts`, `src/config.ts`
- `src/adapters/pi/live-model.ts`, `src/adapters/pi/extension.ts`, `src/adapters/pi/profile.ts`
- `src/adapters/opencode/auto-capture-summary.ts`, `src/services/user-memory-learning.ts`
- `src/services/user-profile/user-profile-manager.ts`, `src/services/user-profile/ai-cleanup.ts`
- `tests/live-model-choice.test.ts`
- README "Auto-Capture AI Provider", `docs/pi-adapter.md`
- ADR-005
