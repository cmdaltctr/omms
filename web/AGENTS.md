# Web UI: rules for every agent

## Before you start

- Read the repository AGENTS.md first. It wins on workflow, tests and security.
- Load the `omms-design` skill and read the reference that matches your task.
- Copy the nearest page that already follows the standard. Do not invent a new pattern.
- Verify the worktree root and branch before changing files.

## Stack

- React 19, Tailwind CSS v4 (CSS-first, no `tailwind.config`), Radix primitives and Lucide icons.
- Theme values are CSS variables in `src/app.css`. Use the semantic classes (`bg-card`, `border-border`, `text-muted-foreground`). Never write a hex colour.
- Use the shared controls in `src/lib/components/ui/`. Never write a raw `<button>`, `<select>`, `<input>` or `<label>`.
- Paths use `$lib/` and `@/` as in the files around yours.

## Page patterns

### Card grid (Memory and Spaces pages)

One card for each thing the user can open or manage. The owners are `src/lib/components/memory/MemoryOverview.tsx` and `HostCard.tsx` for hosts, and `src/lib/components/spaces/SpacesView.tsx` and `SpaceCard.tsx` for spaces.

- Small fixed cards (hosts) use `ul.grid.grid-cols-2.items-stretch.gap-3.lg:grid-cols-4`. Cards that hold text and several buttons (spaces) use `ul.grid.grid-cols-1.items-stretch.gap-3.sm:grid-cols-2`, because four columns squeeze the buttons. Each item is `li.min-w-0`.
- A page of cards that hold actions offers a Grid and a List view with two icon buttons (`SpaceViewToggle`). The choice is saved in `localStorage` with a `try` block. A list card is one row from `sm` up (`sm:flex-row`).
- A card is `rounded-xl border border-border bg-card p-4`. Stack its parts with `flex flex-col gap-3`.
- A card starts with a chip, then the name (`text-subsection-title font-semibold`), then a status line (`text-xs text-muted-foreground`).
- The avatar is a `size-10 rounded-[10px]` square. It shows two letters (colour from the name), a chosen icon from `HOST_ICONS`, or an uploaded image cropped to the square. Use `SpaceChip` for spaces (it takes the `look` from the server) and `HostAvatar` for hosts.
- A card that the user can customise has a pencil at the top-end corner: a ghost `icon-sm` `Button` at `absolute end-2 top-2`, with `aria-label` "Edit space: <name>" and `title` "Edit". It opens a dialog built on `AvatarEditorDialog` (`src/lib/components/avatar/`). Hosts (`AvatarDialog`) and spaces (`SpaceEditDialog`) share that dialog. Pass extra fields as `extra`, and save in `onSave`. Do not copy the dialog.
- A page that lists things that are out of the way (archived spaces) uses the style of the Backups list: the shared paged-list toolbar, then one bordered `rounded-xl border border-border bg-card p-3` card for each item (`list-row.ts`), with the avatar and name, one muted details line, and the actions. Do not build a table. `ArchivedSpaces.tsx` and `SpaceBackups.tsx` are the examples. Sort a missing date last.
- Actions are shared `Button` components at the end of the card. The main action of a card that can be turned on is a default-variant `Button` with a `Play` icon (`Activate`), like the Pause and Resume buttons on the host cards. The active card has no such button, because its state line says it is active.
- Secondary actions are icon-only `Button`s (`size="icon-sm"`, `variant="outline"`) with a Lucide icon and an `aria-label`. A delete uses `variant="destructive"` and `Trash2`. Use `SpaceActionButton` (`src/lib/components/spaces/`). Each one has the standard `Tooltip` (`ui/tooltip.tsx`) with the action name.
- A blocked action stays visible and disabled. Its tooltip gives the reason in words. A disabled button gets no hover or focus, so it sits in a `span tabIndex={0}` inside the `Tooltip`, and an `sr-only` line holds the reason that the button names in `aria-describedby`. Never show a bare greyed button.
- Give each card an `id` so a link can open it. The Spaces page uses `space-card-<id>`. Add a new id prefix to `revealPageAnchor` in `src/lib/settings-navigation.ts`.
- Show a status in words ("Active", "Archived"). Never use colour alone.

### Content cards

- A card that shows stored text (memory, profile item, skill proposal) puts the body in one inner card: `rounded-lg border border-border bg-muted p-3`. Header, actions and footer stay outside it. A `MemoryCard` user prompt is the one exception: its label and date sit inside its own inner card. See `omms-design` (`references/components.md`, "Content cards").

### Sidebar tree

A sidebar item with children uses `ProfileTree` and `useSavedOpen` from `src/lib/components/explorer/ProfileTree.tsx`. Do not build a second tree.

- The Memory tree (`MemorySidebarLinks.tsx`) and the Spaces tree (`SpaceNav.tsx`) are the two examples to copy.
- A child shows a chip, a name that ends in an ellipsis with the full name in `title`, and an optional mark. Mark the active child with a dot in the success colour (`bg-status-success`) and an accessible label.
- A child opens a place. It never runs an action. An action belongs on the card.
- A tree can end with an overview child, like **Shared** in the Memory tree and **Archive** in the Spaces tree. It reuses the neutral round chip (`SharedMark`), always shows, links to a page of its own (`href` and `current` on the section), and is marked current when that page is open. Do not draw a lookalike chip.
- A collapsed desktop sidebar shows the icon only. Its `title` names the current state.
- `AppSidebar.tsx` is over the file size ceiling. It must not grow. Add new items in `sidebar-main-nav.tsx` or a new file.
- Data for a tree comes from a hook that reloads when the state it shows changes (`useSpaceTree`). Do not add a poll. A page that changes the data announces it (`spaces-store.ts`).

### Transfer, export and import dialogs

One dialog per space operation, in `src/lib/components/spaces/`. The owners are `TransferDialog.tsx` (with `TransferPreview.tsx`), `ExportDialog.tsx`, `ImportDialog.tsx` and `SpaceLinks.tsx`.

- A transfer applies nothing until the user has seen a preview. Apply stays disabled until a preview reports rows to copy, and any filter change clears the preview and disables Apply again.
- A move confirms with the counts before the request runs. A `transfer-busy` reply is said in words, keeps the preview and leaves Apply available.
- An export downloads raw bytes: read `response.blob()`, take the counts and warnings from the `x-omms-export-info` header, and offer the file through an anchor with `download`. Do not wrap this route in `fetchAPI`; an empty selection comes back as JSON, so branch on `content-type`. The profile opt-in checkbox is unticked by default.
- An import needs a file before anything else: the submit button stays disabled without one. Read the file in the browser (`await file.text()`, `JSON.parse`) and POST JSON; there is no multipart. Compose the model-mismatch warning on the client from the structured `embedding` fields of the check reply so the sentence is localised; never print the English `warning` string.
- Links list each linked space in a `<bdi>`, mark an unavailable link in words, and confirm both link and unlink first. Default never owns links.
- Every wait shows a `role="status"` line with a spinning `Loader`, and every result reports counts.

### Actions

- Every action that sends a request shows a visible answer at once and again when it ends (see the "Feedback after a click" section of the design reference).
- Every action that changes state opens a confirm dialog first (`SpaceConfirmDialog` is the example): a title that names the thing, a plain sentence on the effect, Cancel and a confirm button. Nothing is sent until the user confirms. The dialog shows progress while the request runs, shows a server error inside itself and stays open, and closes on success.
- A delete or another action that cannot be undone asks for the exact name in a dialog. The confirm button stays disabled until the text matches.
- Every clickable control shows a pointer cursor, and a disabled one does not. The shared `Button` carries `cursor-pointer` and `disabled:pointer-events-none`. A raw `<button>` needs `cursor-pointer` in its class. A link already shows a pointer.
- Show the server's reason when a request fails. Keep the previous state on screen.

## Text and languages

- Every visible string goes through `t(...)` and exists in `en`, `zh` and `ar`. Use real Arabic. `tests/web-translations-parity.test.ts` checks the three languages match.
- Group keys for a page in one file in `src/lib/i18n/`, as `spaces.ts` does.
- Layouts use logical classes (`start-`, `end-`, `ms-`, `me-`) so Arabic mirrors. Wrap user-supplied names in `<bdi>`.
- Write British English.

## Checks

- Write the test first and prove it fails. Specs are in `tests/`. Run one with `PATH=/opt/homebrew/bin:$PATH bash scripts/run-tests-isolated.sh web/tests/<file>.spec.tsx` from the repository root. A plain `bun test` refuses to run.
- Break the code on purpose once (a mutation check) and see the spec fail.
- Keep each `.ts` and `.tsx` file in `src/` at 500 lines or fewer.
- Build with `(cd web && bun run build)`. Run `bun run check` from the root.
- For a visual change, look at the page in a browser at 1280 px and at 390 px. Use a scratch home and your own port. Never use the app on port 4747.
- A new page or card pattern also goes into the `omms-design` skill (`references/components.md`).
