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

Keep `AppSidebar` and its current props. `App.tsx` supplies translated labels. Preserve routes, profile/settings anchors, mobile dismissal, desktop collapse, language-menu keyboard handling, and persisted collapse/tree state.

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
