# TDR-055: OpenCode saved private text that profile learning could quote

- **ID:** TDR-055
- **Date:** 2026-10-18
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Tags:** privacy, opencode, profile, evidence

## Context

Profile learning asks the model for up to 3 example prompts as evidence per item, and the web UI shows that evidence. `<private>` text must never reach the store.

### Root Cause Analysis

`recordUserPrompt` (`src/adapters/opencode/user-prompt.ts`) saved the raw prompt. The Claude Code hook and the history importers already stripped private text. So an OpenCode prompt with a `<private>` block could be saved, sent to the learning model, and quoted into evidence.

## Decision

`recordUserPrompt` now removes `<private>` text with `stripPrivateContent` before saving, and does not save a fully private prompt (`isFullyPrivate`). Both OpenCode entry points (V1 `chat.message`, V2 `prompt`) use this function. Pi does not store live prompts. A test mocks the prompt manager and fails without the fix.

## Consequences

**Positive**

- New OpenCode prompts hold no private text.

**Negative**

- Prompts and evidence saved before this fix may still hold private text. They were not cleaned.

**Neutral**

- Evidence strings are written by a model and are not exact quotes.

## Alternatives Considered

| Option                                         | Rejected because                                             |
| ---------------------------------------------- | ------------------------------------------------------------ |
| Strip evidence strings when the API sends them | Leaves private text in the store                             |
| Strip inside `savePrompt`                      | Changes a shared function that the other paths already guard |

## How to Recognise / Handle This Again

- Search stored prompts and evidence for text the user marked private.
- Clean old rows only after a backup of `~/.omms/data/user-prompts.db` and `user-profiles.db`.

## Revisit Triggers

- A new host saves live prompts. It must strip before saving.

## References

- `src/adapters/opencode/user-prompt.ts`, `tests/opencode-record-prompt-privacy.test.ts`, `src/services/privacy.ts`
- [OpenSpec change `profile-evidence-popup`](../../openspec/changes/archive/2026-10-18-profile-evidence-popup/design.md)
