## Context

The label filter is a list of strings in the address (`?labels=server%7Creactjs,api`). A string with a bar is one OR group. The server, the `memory` tool and the CLI already read this form through `parseTagGroups` and `matchesTagGroups` in `src/core/memorisation.ts`. The page holds the filter in `useMemorisationLabels`. The list route returns at most 200 records, so the page cannot count every label from the list alone. The picker therefore needs a server source for the labels in use.

## Goals / Non-Goals

**Goals:**

- Let a user build an AND and OR filter with check boxes and no typed syntax.
- Reuse the filter format that exists, so the picker adds no new matching rule.
- Keep CLI and `memory` tool behaviour unchanged. They need no picker because they already accept the groups.

**Non-Goals:**

- No change to the recall box, the address syntax or label pills.
- No search box inside the picker and no live count of matching records. A scroll area holds long label lists. Add either later if the label list proves long in practice.
- No label list for the CLI or the `memory` tool. `recall` with `tags` and the list of newest records already cover their needs.
- No rename, merge or delete of labels.

## Decisions

**One source of labels: a new route, not the loaded list.** `GET /api/memorisations/labels` counts labels over every memorisation of the active and linked spaces, the same set the list covers. The alternative, counting labels from the records already loaded, would miss records past the 200-record list limit and would shrink to the filtered list once a filter is on. The route reads through a new `listMemorisationLabels` function in `memorisation-store.ts`, which reads rows with the same `READ_CEILING` and kind filter as the list.

**Counting is a pure function.** `countLabels(recordTags[])` in `src/core/memorisation.ts` merges labels by `normaliseTag`, keeps the first spelling seen for display, drops the fixed `memorisation` tag through `visibleTags`, and sorts by count then name. A pure function keeps the store function thin and unit tests simple, and avoids a `CONFIG` import in `src/core/`.

**The picker holds groups as `string[][]` and converts at the edges.** Opening converts the filter with `parseTagGroups(labels.join(","))`, and Apply converts back with `group.join("|")`. The picker then needs no parser of its own and cannot drift from the server rule. Selecting a label with no other label in the group gives the plain label, so the address stays the same as for a pill.

**Dialog, not an inline panel.** The shared `Dialog` and `Checkbox` primitives exist, handle focus and the Escape key, and fit a 390 px screen as a full-width sheet. An inline panel would push the list down and need its own focus handling. The picker draft lives in the dialog and reaches the page only on **Apply**, so Cancel needs no undo.

**Summary built from the same groups.** One function formats the groups as `(a or b) and (c)` using the existing `memorisation-label-or` word and a new "and" string, so the picker summary and the filter bar use the same words in every language.

**Stale labels stay visible.** If the filter holds a label that no record carries, the picker adds it to its list with a count of 0, so the user can untick it. Without this the user could not see why a filter returns nothing.

**Host parity.** The picker is web-only UI. The CLI and the `memory` tool accept the same groups and need no change, as the proposal states.

## Risks / Trade-offs

- [A space with many labels makes a long list] → The list sits in a scroll area, ordered by count, so the common labels come first. A search box is a named non-goal and can follow.
- [The label list and the record list can disagree for a moment after a delete] → The picker loads the labels each time it opens, so the numbers are current when the user looks.
- [Reading every row to count labels costs time in a large store] → The store already reads rows with `READ_CEILING` for the list route. The route runs only when the picker opens, not on every page load.
