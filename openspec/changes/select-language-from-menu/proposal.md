# Proposal

## Why

The sidebar's language button changes the language as soon as it is clicked. People cannot see the available languages before changing the page, and its "Language EN" label takes up unnecessary space.

## What Changes

- Show only the current language code in the sidebar control: EN, ZH, or AR.
- Open a menu when the control is selected, without changing the page language.
- List English, Chinese, and Arabic by name and code; change language only after a choice is selected.
- Keep the existing saved-language preference and right-to-left behaviour for Arabic.

## Capabilities

### New Capabilities

- `web-language-selection`: Compact sidebar language control and explicit language selection.

### Modified Capabilities

None.

## Impact

- Web UI: `web/src/lib/components/explorer/AppSidebar.tsx`, `web/src/App.tsx`, and translation labels in `web/src/lib/i18n/`.
- Tests for the sidebar menu and persisted language choice; `docs/web-ui.md` for the updated control.
- No server API or additional dependency is required.
