# Design

## Context

See `proposal.md` for motivation and the delta specs for the behaviour contract.

The proposal now uses the combined `features-fixes` branch at `1997c05`, fast-forwarded into `feat/memory-context-controls`. This baseline contains the release-approval cache fix and the archived `directory-map-controls` and `status-navigation-and-heading-hierarchy` changes. Their code and synced specifications are available here.

Relevant current behaviour:

- `src/config.ts` defines the four existing defaults and reads global and project files. `refreshConfigIfChanged` retains the last good runtime config after an invalid live edit. Its project merge is shallow; this change must not redesign that merge.
- `src/services/client.ts` passes `CONFIG.maxMemories` to vector search. The manual search formatter applies the request's own result count afterwards.
- `buildRecentMemoriesSection` uses `chatMessage.maxMemories`. OpenCode V1 and Claude Code use this path at fresh session start. Pi and OpenCode V2 instead search with each prompt.
- `src/services/context.ts` combines the user profile and memory results without a size cap. `formatMemoriesForCompaction` is a separate shared formatter and also lacks a cap.
- The capture pipeline already applies `autoCaptureMaxContextBytes` with UTF-8 utilities and request reserves. Preserve those rules.
- `src/adapters/opencode/profile-learning.ts` calls its limit `userProfileMaxContextBytes` but compares JavaScript string length, then appends a marker outside the limit. Other hosts do not use this setting.
- The Claude Code hook has a fixed 9500-character added-context safety limit. Keep it as a transport limit.
- Settings snapshot and writer lists exclude all five proposed card fields. The writer currently passes `[key]` to the JSONC editor, so accepting a dotted key alone would write the wrong property.
- `SETTINGS_SECTIONS` drives both Settings composition and sidebar children. Existing sidebar links scroll after navigation; direct hash reload needs explicit coverage.
- Integrated Settings titles use H2 with `text-section-title` and H3 with `text-subsection-title`. The application owns H1 with `text-page-title`; the body role is 14px. Reuse these roles for Memory.
- `DirectoryMapHost.tsx` owns collapsed host disclosures. Host-specific badges and automatic-import links use `revealDirectoryMaps` in `web/src/lib/directory-map-navigation.ts` to open and focus the matching summary. The helper is host-specific and is not a generic Settings navigation API.

## Goals / Non-Goals

**Goals:**

- Use the same file keys and runtime values for the UI and hand-edited configuration.
- Keep packing host-neutral and testable without a model, embedding download, or store write.
- Count the final memory text and avoid truncating generated section delimiters.
- Preserve existing save security and independent process operation.

**Non-Goals:**

- Exact tokenisation for every provider, model output limits, or monthly spending controls.
- Graphify settings or truncation of manual memory tool and CLI results.
- A new profile input limit for Pi, Claude Code, or shared history-profile batches.
- New injection surfaces, changes to injection timing, or changes to model selection.
- Store changes, data cleanup, re-embedding, or dependency additions.
- A redesign of project config merging, the integrated heading roles, or the existing Directory maps disclosures and navigation.

## Decisions

### 1. Keep the existing keys and add one budget key

Use `retrievalMaxTokens` with a default of 2000. The four requested values keep their current defaults. Validate the values according to the new capability's table, at startup, live reload, and Settings save.

Keep the byte fields in bytes. The UI shows readable defaults such as `131,072`, while inputs and files use plain integers. Label the new unit **Approximate tokens**. Do not convert a byte field to tokens when saving.

Put new pure validation logic in its own module if shared use warrants it. Pass values or configuration into that module. Avoid adding helper exports to `src/config.ts` that partial test mocks would need to reproduce.

Alternative: one generic budget for retrieval, capture, and profiles. Rejected because these operations have different effects and existing keys.

### 2. Use a stable token estimate with no new dependency

Define the estimate as `Math.ceil(utf8ByteLength(text) / 4)`. The internal byte ceiling is therefore `retrievalMaxTokens * 4`. Count every character OMMS emits as memory context, including the shared wrapper where used. The host's unrelated system and user prompts are outside this setting.

This is a predictable output-size control. The UI and guides must state that a provider can count more or fewer tokens. Exact tokenisation would need model-specific behaviour and an approved dependency, which would add scope to this feature.

### 3. Pack content before emitting complete sections

Add a small pure helper in the shared layer, using `src/utils/context-limit.ts`. Keep it independent of `CONFIG` and host SDKs.

Reserve fixed headers, generated delimiters, host retrieval wrappers, and marker bytes before assigning payload space. Give profile payload up to one quarter of that remaining space. Unused profile space becomes available to memories.

Process memories in their incoming order. Keep full entries while they fit. Shorten the next oversized entry with the existing Unicode-safe utility and a visible marker, then stop. Do not replace a top-ranked entry with smaller low-ranked entries. Account for each memory's own formatting before sizing its body. Assemble the final section only from bounded payloads and complete delimiters, then verify the final byte ceiling.

Use the same budget in `formatContextForPrompt` and `formatMemoriesForCompaction`. A compaction section has no profile allocation. Preserve each format's current headings and tags. Include any `omms-retrieval` wrapper in the reserved overhead for the callers that use it. Avoid applying a fresh full budget separately to multiple sections emitted in the same host request; they share one total allowance.

Alternative: slice the complete rendered string at the ceiling. Rejected because that can leave an open retrieval tag and broken formatting.

### 4. Refresh and snapshot limits at operation boundaries

Reuse `refreshConfigIfChanged(directory)` before each relevant operation. Capture the selected limits before asynchronous retrieval or model work starts, then pass those values to formatting. A later config reload must not change the allowance halfway through an operation.

Audit the existing injection paths in OpenCode V1, OpenCode V2, Pi, and Claude Code. Their timing and storage behaviour stay unchanged. Claude Code must satisfy both the shared allowance and its fixed hook limit. No shared module may import an adapter or host SDK.

### 5. Make the profile byte field accurate within its existing scope

Replace the character-based OpenCode profile truncation with the existing UTF-8 limiter. Include the marker in the configured ceiling. Keep the same prompt construction and stored prompt data.

Show **OpenCode profile-learning input** in the card. Do not broaden the control to other hosts as part of this change. Adding a shared profile input budget would require a separate decision about which portions of each host's request it covers.

### 6. Extend the existing Settings snapshot and writer

Expose the five fields through `GET /api/settings`, including their global values, effective values, sources, and defaults. For the nested field, resolve the effective value using the current runtime merge rules. A project `chatMessage` object can cause defaulted siblings under the existing shallow merge, so do not infer the source solely from a dotted-property presence check.

Use `PATCH /api/settings` with its existing `{ edits, revision }` body. The request identifier `chatMessage.maxMemories` maps explicitly to the JSONC path `["chatMessage", "maxMemories"]`. Other supported fields map to their existing top-level paths.

Use a fixed allowlist. Do not split arbitrary user-supplied dotted paths. Validate every edit before any write; refuse unsupported nested edits. Preserve nested sibling properties and comments, including when the `chatMessage` object is created for the first time.

Keep revision conflict checks, atomic writes, the save queue, legacy migration, origin checks, and authentication. After success, reload and publish the Settings snapshot so all cards receive the new revision. No secret fields are added to the response.

### 7. Add one Memory card and one sidebar entry

Add `MemorySection.tsx` under the existing Settings components. Register `settings-section-memory` immediately after **Models** in `SETTINGS_SECTIONS` and in `SettingsView`'s component map. The sidebar reads the same list.

Use the existing table styles and shared inputs/buttons. Give the Memory card an H2 with `text-section-title font-semibold`; use H3 with `text-subsection-title font-semibold` only for actual subsections. Keep identifiers, effects, and units as table content, not headings. The card contains one form and five table rows, with a visible **Affects** column. Add associated help and error text, global versus effective project values, Save, and Cancel. Preserve drafts when the page's language changes. Reuse snapshot-generation protection so an older response cannot replace a newer saved revision.

Keep table overflow within the card. Use logical spacing and left-to-right isolation for technical identifiers. Add English, Chinese, and Arabic strings through the existing Settings translation system.

Support `/settings#settings-section-memory` on first load and reload. Reuse the existing page/sidebar navigation owners and fix only the missing anchor handling needed by this new link. Do not call `revealDirectoryMaps` for Memory: it opens a host disclosure, whereas Memory is a Settings card. Preserve that helper, the `directory-maps-{host}` summary anchors, and both general Directory maps anchors. Navigation must not reset unsaved directory-map targets or selections. Run the integrated navigation and heading regression tests alongside the new Memory tests.

## Risks / Trade-offs

- Approximate tokens differ across languages and providers. Mitigation: show the formula and label every token value approximate.
- A default of 2000 can omit memories previously injected in full. Mitigation: mark shortened content, keep manual search complete, and document how to increase the limit.
- A long profile can crowd out project memories. Mitigation: limit its share to one quarter of the available payload.
- True UTF-8 profile limiting shortens multibyte input earlier than the old character limit. Mitigation: add Unicode regression tests and state the byte unit clearly.
- Nested edits can overwrite `chatMessage` siblings. Mitigation: map only the named leaf and test comment-preserving JSONC saves.
- Existing project overrides can confuse a global edit. Mitigation: show global and effective values with their sources, and preserve current merge rules.
- New Memory navigation can regress the integrated host links or headings. Mitigation: retain existing anchors and section order apart from Memory, use the shared typography roles, and run the directory-map, status-navigation, and heading regression tests.

## Migration Plan

No store migration or install-time rewrite is needed. Missing `retrievalMaxTokens` resolves to 2000 when the new code runs. New generated config templates include all five fields and their effects; existing files gain values only through an explicit save or hand edit.

Hand-edited configuration example:

```jsonc
{
  // Maximum memory search results.
  "maxMemories": 10,
  "chatMessage": {
    // Recent memories at fresh session start in OpenCode V1 and Claude Code.
    "maxMemories": 3,
  },
  // Shared memory-summary input limit in UTF-8 bytes.
  "autoCaptureMaxContextBytes": 131072,
  // OpenCode profile-learning input limit in UTF-8 bytes.
  "userProfileMaxContextBytes": 32768,
  // Automatic memory context. Approximate tokens = ceil(UTF-8 bytes / 4).
  "retrievalMaxTokens": 2000,
}
```

Rollback restores the prior package. It ignores the unknown new key; stored memories and profiles need no recovery. Raising `retrievalMaxTokens` within its accepted range restores more automatic context without a re-import.
