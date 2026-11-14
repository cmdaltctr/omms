## Why

The Memorisation page filters by label, and a filter can already mean "all of these" (comma) or "any of these" (bar, such as `server|reactjs,api`). The only way to build an OR filter is to type that syntax into the recall box or the address bar. Typing a bar and remembering the rule is awkward, and the user cannot see which labels exist. Users want to pick labels with the mouse.

## What Changes

- Add a **Filter by label** control above the list. It opens a picker that shows the labels in use, each with its record count.
- The picker works in groups. A group is a set of labels where a record needs at least one. Groups combine with AND. This is the same rule as the comma and bar syntax, so one group of `server` and `reactjs` plus one group of `api` is the filter `server|reactjs,api`.
- The picker shows a plain summary of the filter, such as "Showing: (server or reactjs) and (api)", and applies it to the list and the address on **Apply**.
- Add `GET /api/memorisations/labels`, which returns every label with its record count across the active space and its linked spaces.
- The recall box, the address syntax, the `memory` tool and the CLI stay as they are. They already take the same groups, so CLI and MCP users keep full parity with the picker.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-memorisation`: adds the label picker, its summary and the label list route. Existing requirements stay unchanged.

## Impact

- Web: a new picker component under `web/src/lib/components/memorisation/`, a small change to `MemorisationView` and `useMemorisationLabels`, one API call in `memorisation-api.ts`, English, Chinese and Arabic strings.
- Server: one route in `src/services/memorisation-routes.ts`, one store function, one pure counting function in `src/core/memorisation.ts`.
- Docs: `docs/web-ui-memory.md` and `docs/using-memory.md`.
- No change to stored data, to the `memory` tool or to the CLI. No new dependency.
