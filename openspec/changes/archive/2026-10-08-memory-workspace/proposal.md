# Proposal

## Why

OMMS puts history imports, profile analysis, and memory limits inside Settings, with labels that obscure what each action populates. Users need one Memory page that explains project memories and the user profile, and can import Pi, OpenCode, and Claude Code history in one reviewed run.

## What Changes

- Add a top-level **Memory** page at `/memory`, alongside Project memories, User profile, and Settings.
- Move **Import and backfill**, **Automatic import**, **Profile learning**, and **Memory limits** out of Settings. Move their related directory controls into **Resolve missing project folders** on Memory.
- Keep API/model configuration, credentials, health, diagnostics, app settings, and profile identity controls in Settings. Project memories and User profile remain their existing browsing pages.
- Rename the manual import section **Import chat history**. Explain that conversation content populates project memories and user prompts populate the user profile: preferences, patterns, and workflows.
- Replace **Skip memories** and **Skip profile** in the web UI with positive **Project memories** and **User profile** choices, both selected by default. Keep their existing backend and CLI meanings.
- Offer **All hosts** and individual host choices. Preview the selected histories together, then run them sequentially in the server, with per-host results and combined counts. A failure stops later hosts; completed work stays recorded for a retry.
- Give **Profile learning** two explicit actions: **Analyse waiting prompts** for prompts already waiting inside OMMS, and **Re-analyse chat history** for a forced profile-only history import. Explain the model calls and the existing once-per-prompt forced replay rule.
- Show source hosts, project scope, output choices, and preview results without opening Advanced options. Keep source overrides, date limits, batch size, and technical map overrides advanced.
- Retain automatic import's existing enable switch, fixed history cutoff, model choices, per-host actions, and progress. Explain that it populates both project memories and the user profile.
- Keep every memory-limit setting, default, validation rule, unit, host coverage note, and safe-save behaviour unchanged under **Memory limits**.
- Redirect old Settings section links to the corresponding Memory section, including host-specific unresolved-folder links. Support English, Chinese, and Arabic, desktop collapse, and the mobile drawer.

## Capabilities

### New Capabilities

- `web-memory`: A dedicated Memory page with task-focused navigation, clear explanations of outputs, positive import choices, and separate backlog-analysis and history-re-analysis actions.
- `multi-host-import`: A server-owned sequential web import batch over selected host histories, with pinned previews, preflight checks, per-host results, cancellation, and safe retries.

### Modified Capabilities

- `web-settings`: Relocate memory operations and limits, update import controls and links, and retain Settings configuration and access rules.
- `profile-learning`: Move catch-up controls to Memory, name their input clearly, and expose the existing forced profile-only history import as a separate action.
- `import-progress`: Show existing per-host progress on Memory and show the current host and phase of a grouped import.
- `import-directory-maps`: Move directory controls to Memory under Resolve missing project folders, while keeping their existing global map and review rules.

## Impact

- Frontend: `web/src/lib/routes.ts`, `web/src/App.tsx`, sidebar/section navigation, existing import/profile/limit/folder components, and translation tables.
- Importer: `src/importer/web-import-jobs.ts` and its API handlers gain an additive grouped request/response contract. Each child still calls `runHistoryImport`; host readers, ledgers, privacy rules, and the live-model order stay unchanged.
- Compatibility: Existing single-host web requests, terminal and in-session commands, config keys, and stored data remain valid. New batches reuse the existing one-web-job slot and per-host run claims. No database migration or new dependency is planned.
- Verification: Add route, legacy-link, output-selection, preview, sequential-execution, cancellation, retry, readiness, and failure tests. Check translated layouts with synthetic data through Orca before reporting implementation complete.
- Documentation: Update the web UI, Settings, memory usage, and host history-import guides. Record the page ownership and sequential-batch decision in an ADR during implementation.
- Scope: This proposal changes the web workflow. It does not add a combined CLI command, change automatic backfill defaults, change profile matching/decay, erase a profile, or guarantee a larger workflow count.
