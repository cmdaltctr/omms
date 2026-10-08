# ADR-025: Memory workspace with sequential web imports

- **Date:** 2026-10-08
- **Status:** Accepted
- **Deciders:** OMMS maintainer

## Context

History imports, profile catch-up, memory limits and folder resolution shared Settings with model configuration and access controls. Import skip flags obscured the two outputs. Users needed a reviewed flow across Pi, OpenCode and Claude Code without losing each host's source, model rules or ledger identity.

The existing web job owner holds one in-memory slot. `runHistoryImport` owns host claims, execution and ledger progress. Profile import also drains shared waiting prompts. Browser-owned sequencing would lose ownership during navigation. Parallel children would overlap their profile steps.

## Decision

Put memory operations on `/memory` with five sections: Import chat history, Automatic import, Profile learning, Memory limits and Resolve missing project folders. Keep Project memories and User profile as browsing pages. Settings retains model/API configuration, access, diagnostics and conditional Profiles identity controls.

Resolve legacy Settings anchors before rendering Memory. Replace the old URL entry and preserve host disclosure links and in-page folder drafts. Reuse the existing settings writer and shared revision channel for moved controls.

Show positive Project memories and User profile choices, both selected by default. Keep Pi and Current project as initial choices. All hosts explicitly selects supported histories and leaves scope unchanged. Require a current preview and model-call confirmation in the web flow.

Extend the existing web endpoints with a `hosts` array and shared options. Preserve legacy single-host payloads and response fields. `SettingsImportJobs` owns the slot; `web-import-group.ts` executes selected children in Pi, OpenCode, Claude Code order. Each child completes memory and profile work before the next starts.

Preflight all children before paid calls. Recheck queued sources, pinned selections and readiness before each child. Preserve existing per-host claims. A thrown error, failed memory unit or profile error fails the group and prevents later children starting. Cancellation keeps completed results and cancels queued work.

Retry through existing host ledgers and once-only `#profile-rebuild` identities. Keep orchestration in memory. A server restart ends the group; fresh listings, preview and confirmation recover unfinished work. Add no persistent scheduler, data migration or dependency.

Analyse waiting prompts retains catch-up's stored backlog and lease rules. Re-analyse chat history presets a forced profile-only import without starting work or erasing the profile. Estimates count eligible history and shared waiting identities once; extra matching and retry calls remain possible.

## Consequences

### Positive

- Page ownership makes the source and outputs of memory actions visible.
- Server ownership survives browser navigation and reload without resubmission.
- Existing ledgers retain completed work after a failed or cancelled group.

### Negative

- Sequential execution increases elapsed time compared with parallel hosts.
- One blocked or failed child prevents later paid work until a reviewed retry.
- Server restart loses the current group view and requires fresh source selections.

### Neutral

- CLI commands, flags, host model rules and profile email resolution stay unchanged.
- All hosts creates no merged profile or shared host ledger identity.
- Automatic import keeps its fixed cutoff and existing config. Memory limits retain defaults, validation, units and safe-save rules.
- Combined reports retain memory units and profile batches as separate measures. Historical badges remain independent of group outcomes.

## Alternatives Considered

| Option                                 | Rejected because                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| Keep memory operations inside Settings | Page ownership would remain unclear.                                                   |
| Browser loop over hosts                | Navigation would interrupt queue ownership.                                            |
| Parallel host imports                  | Profile steps would overlap and partial failure would be harder to report.             |
| Persistent scheduler                   | It adds storage and restart recovery beyond the approved scope.                        |
| Reset and rebuild the profile          | It changes preservation and replay rules; existing forced import supports re-analysis. |

## References

- [Approved design](../../openspec/changes/memory-workspace/design.md)
- [Memory capability](../../openspec/changes/memory-workspace/specs/web-memory/spec.md)
- [Grouped import capability](../../openspec/changes/memory-workspace/specs/multi-host-import/spec.md)
- [Memory page guide](../web-ui-memory.md)
- [Web API contract](../developers.md#web-history-import-api)
- [Job owner](../../src/importer/web-import-jobs.ts)
- [Sequential executor](../../src/importer/web-import-group.ts)
- [Profile estimate](../../src/importer/web-import-profile-estimate.ts)
- [Group tests](../../tests/web-import-group.test.ts)
- [Pinned fixture tests](../../tests/web-import-group-fixtures.test.ts)
- [Memory section and legacy anchor registry](../../web/src/lib/memory-sections.ts)
- [Memory view](../../web/src/lib/components/memory/MemoryView.tsx)
- [ADR-008: Pinned session selections](008-session-first-web-import.md)
- [ADR-014: Shared web app](014-one-shared-web-app-for-every-host.md)

Implementation verification completed with strict OpenSpec validation and the full local CI gate. The design records the rendered-zoom fallback and the unexecuted native GUI zoom check.
