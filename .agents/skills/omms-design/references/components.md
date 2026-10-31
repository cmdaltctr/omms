# Component guidance

Read [visual foundations](foundations.md) before applying target styles. The paths and APIs below exist in OMMS. Proposed styling belongs in those owners during an approved implementation.

## Owners

| UI element                    | OMMS file                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| Button and variants           | `web/src/lib/components/ui/button.tsx`                                                   |
| Input / textarea              | `web/src/lib/components/ui/input.tsx`, `textarea.tsx` in the same directory              |
| Select                        | `web/src/lib/components/ui/select.tsx`                                                   |
| Label / checkbox              | `web/src/lib/components/ui/label.tsx`, `checkbox.tsx` in the same directory              |
| Dialog                        | `web/src/lib/components/ui/dialog.tsx`                                                   |
| Badge / tooltip               | `web/src/lib/components/ui/badge.tsx`, `tooltip.tsx` in the same directory               |
| Sidebar                       | `web/src/lib/components/explorer/AppSidebar.tsx`                                         |
| Memory row/card               | `web/src/lib/components/explorer/MemoryCard.tsx`, `MemoryList.tsx` in the same directory |
| Edit dialog                   | `web/src/lib/components/explorer/EditMemoryDialog.tsx`                                   |
| Settings composition          | `web/src/lib/components/settings/SettingsView.tsx`                                       |
| Settings sections and anchors | `web/src/lib/settings-sections.ts`                                                       |
| App layout                    | `web/src/App.tsx`                                                                        |
| Paged list                    | `web/src/lib/components/paged-list/` (`index.ts` exports the API)                        |
| Chart primitives and cards    | `web/src/lib/components/ui/chart.tsx`, `web/src/lib/components/skills/charts/`           |
| History timeline              | `web/src/lib/components/skills/SkillHistory.tsx`, `HistoryEntry.tsx`                     |

## Buttons

Use `$lib/components/ui/button`. Current variants are `default`, `outline`, `secondary`, `ghost`, `destructive`, and `link`. Sizes are `default`, `xs`, `sm`, `lg`, `icon`, `icon-xs`, `icon-sm`, and `icon-lg`. OMMS currently has no `chip` variant.

Keep the current variant API in the first pass. Apply the tinted primary treatment and target dimensions in the shared `buttonVariants`. Avoid local wrappers or repeated height overrides. The current default is `h-8`; the proposed default is `h-9`. Check toolbars and dialogs when this changes.

This example uses existing keys and the installed icon library:

```tsx
import { Plus } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";

export function AddMemoryAction({ onAdd }: { onAdd: () => void }) {
  const { t } = useI18n();
  return (
    <Button type="button" onClick={onAdd}>
      <Plus aria-hidden="true" />
      {t("btn-add-memory")}
    </Button>
  );
}
```

For icon-only actions, give the button a translated accessible name. Mark its decorative icon `aria-hidden="true"`. Keep native button behaviour, including `type`, disabled state, and form submission. The current OMMS primitive forwards `type`; callers must specify `type="button"` for non-submit actions inside forms.

## Feedback after a click

Every action gives the reader a visible answer at once. A disabled button alone is not an answer: the reader cannot tell a slow job from a click that did nothing.

1. Show a status line next to the control as soon as the request starts. Use `role="status"`, a spinning Lucide `Loader` marked `aria-hidden="true"`, and a translated message that names the wait, for example "Finding past sessions…" or "Drafting… This can take a few minutes."
2. Give a job that runs longer than a few seconds a progress bar with counts (`role="progressbar"` plus `aria-valuenow`). Poll its status; do not wait for the start request to return the end result.
3. When the job ends, replace the status line with the result: a count, a "Saved." line, or an error with `role="alert"` that says what to do next, such as "Try again."
4. Keep the web app answering while a job runs. Long server loops yield between steps (`await new Promise((resolve) => setImmediate(resolve))`), so status and progress requests still answer.
5. A link that jumps to a card scrolls at once (`scrollIntoView({ block: "start" })`) and outlines the card for a moment with `flashAnchor` from `web/src/lib/settings-navigation.ts`. Smooth scrolling did not move the page in Orca's built-in browser.

Check each new action in the browser: click it and confirm that something visible changes within a moment, and again when it ends.

## Inputs and selects

Keep `Input`, `Textarea`, `Label`, and the existing `Select` API. The select accepts `<option>` children and reports `event.target.value`; it is not OpenChamber's select and has no `size="settings"` prop.

```tsx
import { Input } from "$lib/components/ui/input";
import { useI18n } from "$lib/i18n";

export function MemorySearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={t("placeholder-search")}
      placeholder={t("placeholder-search")}
      className="min-w-0"
    />
  );
}
```

The current input has a transparent fill, `h-8`, and primary-coloured text selection. Adapt its shared styles to an elevated fill, the target height, semantic selection, and visible focus. Labels, validation, and required state stay intact. Keep narrow fields within their row; let memory search fill the available toolbar space.

## Dialogs

Reuse the Radix-backed exports in `$lib/components/ui/dialog`. Retain focus trapping, Escape behaviour, focus return, accessible titles, and existing confirmation rules.

For editing a memory, reuse the existing component:

```tsx
import { EditMemoryDialog } from "$lib/components/explorer/EditMemoryDialog";

// Inside the existing owner, retain its draft and save callbacks.
<EditMemoryDialog
  open={editOpen}
  content={editContent}
  onOpenChange={setEditOpen}
  onSave={saveEditedMemory}
/>;
```

`editOpen`, `editContent`, `setEditOpen`, and `saveEditedMemory` represent the existing owner's values and callbacks. This usage example does not introduce a new save implementation.

Style the shared dialog with elevated background, restrained border/shadow, and capped width. Keep its body scrollable when content exceeds the available height. Verify actions stay reachable in a mobile browser viewport and at 200% zoom.

The current shared close button contains English `Close` and physical `right-4` positioning. When touching this primitive, route its accessible label through OMMS i18n and check logical end positioning for Arabic. This is an implementation requirement to verify, not a claim that the current dialog already satisfies it.

## Sidebar

Keep `AppSidebar` and its current props. `App.tsx` supplies translated labels. Preserve routes, profile/settings anchors, mobile dismissal, desktop collapse, language-menu keyboard handling, and persisted collapse/tree state. Every main link that has sections (User profile, Skills, Memory, Settings) gets the same arrow and indented list. A section link needs a page element with the same id and `scroll-mt-4`, and its id pattern in `revealPageAnchor` (`web/src/lib/settings-navigation.ts`).

The present expanded width is `w-64`, with `md:w-14` when collapsed. The first styling pass keeps these dimensions. It already uses logical `start-0` and `border-e`; preserve its directional drawer transforms.

Apply neutral selection through `bg-sidebar-accent` and readable foreground text. Keep the unselected state quieter. Icons stay Lucide, with the existing GitHub brand-icon exception. Use consistent 16px icons for normal rows; leave action-specific indicators meaningful.

The sidebar's current navigation row pattern is:

```tsx
const stateClass = active
  ? "bg-sidebar-accent text-sidebar-accent-foreground"
  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground";
```

`active` comes from the existing route state. Change appearance through the shared row classes and semantic variables. Avoid creating a second navigation component or changing route selection logic.

## Settings rows

OMMS currently renders section components within `SettingsView` and has no `SettingsFieldRow`, `SettingsPageLayout`, or OpenChamber save-status API. Keep existing section IDs and `SETTINGS_SECTIONS` order. They connect the sidebar tree to scroll anchors.

Use a flat label/control arrangement where the existing content supports it. For example, this presentational row uses a real settings message and accepts the current owner's state:

```tsx
import { useSettingsText } from "$lib/i18n/settings";

export function LoginPreferenceRow({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const s = useSettingsText();
  return (
    <label className="flex min-w-0 items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0">{s("Start web app at login")}</span>
    </label>
  );
}
```

This illustrates composition; it does not require extracting a new component. Reuse the shared checkbox where compatible with the existing behaviour. Keep state and persistence with the section owner.

Use logical alignment and allow labels to wrap. Stack label/control rows in narrow panels. Container queries are useful when the panel width differs from the viewport; add a container before using its query classes. Preserve existing viewport-responsive app navigation.

Keep visible helper text, warnings, save feedback, and validation messages in the first pass. Changing their visibility requires approval. Standardise repeated row styles after the pattern is established; avoid importing OpenChamber's runtime-dependent primitives.

## Long lists: page size 5, sort, custom size, footer

Page every list that can grow past 5 rows. Use the shared module in `web/src/lib/components/paged-list/`. Do not copy the controls into a list.

1. For rows held in the browser, call `usePagedList({ storageKey, items, sorts, resetKey })`. It returns `view` and `pageItems`.
2. For rows the server pages, call `usePaging({ storageKey, total, sorts })`. Ask the server for `serverWindow(view.page, view.perPage, total, oldestFirst)`.
3. Wrap the rows in `<PagedList view={view} totalLabel={...}>`. It draws the toolbar, the rows and the footer.

Rules:

- A list of tall cards may start smaller: pass `defaultPerPage: 3` (the proposal lists do). A saved size still wins. Other lists keep 5. The size menu offers 3, 5, 10, 25, 50 and 100.
- Give each list its own `storageKey`, for example `omms-list-skills`. The hook saves the page size and sort there in a `try`/`catch`.
- Define the sorts once, as in `web/src/lib/skills-sorts.ts`. Each sort has an English `label`, a `first` direction and an ascending `compare`. The toolbar translates the label.
- Pass the filter text as `resetKey`. A new filter, sort or page size returns to page 1. The page stays inside the list when the data shrinks.
- The toolbar reads "Show [5] results | Custom: [ ] | Sort by [menu] [arrow]", with the total on the right. Custom sizes apply on Enter or blur, are clamped to 1 to 200, and appear in the menu in sorted order. The separators hide on narrow screens.
- The footer reads "Showing X to Y of Z results" over Previous, page numbers with gaps, and Next. It renders nothing for one page. Previous and Next use a real `disabled`, so they leave the tab order. Narrow screens show only their icons.
- Keep the accessible names: "Results per page", "Custom results per page", "Sort by", "Sort ascending", "Sort descending", the `pagination` nav and `aria-current="page"`.
- Put the empty and loading states outside `PagedList`. A list with no rows shows its own sentence.

## Collapsible long sublists (3 default, 6 expanded, paged beyond)

A sublist inside a card, such as the evidence turns of a proposal, must not make the card long. See `web/src/lib/components/skills/EvidenceTurns.tsx`.

- Show 3 rows. With more than 3, add a ghost `Button` "Show N more" with a chevron and `aria-expanded`. N is the number of extra rows the click reveals, at most 3.
- Expanded shows up to 6 rows. With more than 6 rows, page the expanded view 6 to a page with `PagedFooter` and `paginate` from the paged-list module. Leave out the size and sort toolbar.
- "Show less" goes back to 3 rows and page 1.
- Long cards: header + 2-line summary + key facts collapsed, details behind Show more. Use a ghost `Button` with a chevron, `aria-expanded` and `aria-controls`; keep the actions visible. See `web/src/lib/components/skills/ProposalCard.tsx`.

## Done marker: green check beside the name, with a tooltip

Mark a finished or changed item with a `CircleCheck` icon in `text-status-success`, beside its name. See `web/src/lib/components/skills/ModifiedMark.tsx`.

- Wrap it in the shared `Tooltip`. The icon sits in a focusable `span`, so the tooltip shows on hover and on keyboard focus.
- Put the same sentence in an `sr-only` span, for example "Modified on {date}". The icon has `aria-hidden`.
- In a row that is one big button, place the mark as a sibling of the button, not inside it, so no interactive element sits inside another.

## Charts

Draw charts with the shadcn chart primitives in `web/src/lib/components/ui/chart.tsx` (Recharts). Wrap each chart in `ChartCard` from `web/src/lib/components/skills/charts/ChartCard.tsx`.

- Show a chart only when real data backs it. Do not add sample or placeholder data.
- Use the colour tokens in `web/src/app.css`. In every skill chart, `--status-success` (green) marks successful uses and `--destructive` (red) marks failed uses, the tokens of the success and error badges. Every theme sets both. A 1px `--card` edge leaves a gap between stacked parts. Both colours come from the theme, so they change with it. A single-series chart uses `--chart-1`. Each token has a light and a dark value. Run the dataviz palette validator after you change one.
- Colour is never the only code. Give each chart a legend for 2 or more series, a summary line with the headline numbers, and direct value labels where they fit.
- `ChartCard` hides the drawing from screen readers and adds a table with the same numbers. Pass `table` with translated column names.
- Give an empty chart `emptyText`. Say when data will appear, for example "Bars appear after OMMS records turns."
- Lay chart cards in a grid: 1 column on mobile, 2 columns on wide screens (`lg`), `gap-3`, `items-start`. A time series takes the whole row (`lg:col-span-2`).
- Give a time series one range control in its section header, shared by every chart in the section: a Days | Months | Years radio group, then one menu (last 30 days or a month; a year; none for Years). Remember the choice per browser and keep the old chart, dimmed, until the new data arrives.
- Crop a long category name at the end with an ellipsis. Show the full name in the shared `Tooltip` on hover and on keyboard focus. Put focusable labels outside the hidden drawing (`ChartCard interactive`).
- A chart that opens something on click needs a keyboard path to the same place, such as the list below it.

## History timelines

Show the changes of one item as a vertical timeline, newest first, paged with the shared paged list.

- Use an `<ol>` with a start border. Mark each entry with a small dot in its kind colour, taken from `keywordHue`.
- Each entry shows a `HuePill` with its kind, a `<time>`, the summary and the line counts as `+added −removed`. Give the counts an accessible name, for example "12 lines added, 3 lines removed".
- An action that changes state, such as **Revert to before this change**, asks for confirmation in a warning `Callout`. When the action also removes later changes, the callout says how many.
- When the action is not possible, keep the button visible and disabled. Add a short hint next to it, linked with `aria-describedby`, for example "Revert the newer change first."
- Follow [Feedback after a click](#feedback-after-a-click): a status line while the action runs, then a result message or an alert.
