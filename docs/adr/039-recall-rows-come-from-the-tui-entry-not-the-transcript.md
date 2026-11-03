# ADR-039: Recall rows come from the TUI entry, not the transcript

- **Date:** 2026-11-03
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Change:** [`add-opencode-v2-visible-recall`](../../openspec/changes/archive/2026-11-03-add-opencode-v2-visible-recall/proposal.md)

## Context

OpenCode v2 recalls memories for each prompt and adds them to the model's system context. The user sees nothing. Claude Code already shows each recall as a fold row. OpenCode needs the same visibility.

The `opencode-v2-adapter` spec requires that memory injection does not add a message to the session transcript. The OpenCode TUI plugin API has no hook that draws inside a reply.

## Decision

1. **The server entry records a summary of each recall and serves it over plugin RPC.** It keeps the latest 20 summaries per session in memory. A session with a parent session (a subagent) records none.
2. **The existing `./tui` entry pulls the summaries and draws the rows.** It uses the `session.composer.top` slot, above the prompt box. A second claim on the `app` slot owns the `/omms-recall` command (see TDR-061).
3. **The rows are on the user's screen only.** They run no second search, add no message to the transcript, and do not change the model context.
4. **The summary builder is host-neutral** (`src/core/recall-summary.ts`), so another host can use it.
5. **One setting, `visibleRecall`:** global, default on. A project config can turn it off but never on.

## Alternatives rejected

- **A marker message in the transcript.** It would show in every frontend. It breaks the rule that injection adds no message, adds durable history, and either doubles the model context or moves injection out of system context.
- **A toast for each recall.** A toast is short-lived, cannot fold, and cannot list results.
- **A session panel (`ui.panel`).** It opens full screen and hides the session (TDR-060).
- **Reporting from the V1 plugin.** The per-prompt recall is a V2 hook.

## Consequences

- OpenChamber and other frontends that do not load the TUI entry show nothing new.
- The row sits above the prompt box, not above the reply text.
- Pi has no rows yet. This is a recorded exception to the host parity rule.

## Revisit triggers

- OpenCode adds a per-message render hook, so rows could sit above the reply.
- The user decides that rows in every frontend matter more than a clean transcript. That needs a spec change.
