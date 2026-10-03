# Localisation

## Existing owners

- `web/src/lib/i18n/index.ts` owns `useI18n()`, `setLanguage()`, `getLanguage()`, and language subscriptions.
- `web/src/lib/i18n/translations.ts` contains `en`, `zh`, and `ar` dictionaries with existing hyphenated keys.
- `web/src/lib/i18n/settings.ts` contains English settings messages paired with Chinese and Arabic translations. Use `useSettingsText()` or `translateSettings(message, language)` according to nearby precedent.

Preserve `omms-lang`, migration from `opencode-mem-lang`, and the preference helpers. Language updates set document `lang` and Arabic `dir="rtl"`. Keep the existing provider and reactive rendering; changing language must not remount the app.

## Rendered messages

```tsx
import { useI18n } from "$lib/i18n";

export function MemoryCount({ count }: { count: number }) {
  const { t } = useI18n();
  return <h2>{t("section-project", { count })}</h2>;
}
```

Resolve text inside React render or hook scope. For option definitions, retain a key and translate it during rendering. Pass translated values into non-React helpers, or pass the translator explicitly. Keep existing keys when styling a component.

New explorer messages need real translations in all three dictionaries. Follow nearby hyphenated key naming. Settings messages follow the existing English-message map and its Chinese/Arabic pairs. Do not migrate either system to OpenChamber's dotted-key convention as part of a visual change.

For settings, the existing pattern is:

```tsx
import { useSettingsText } from "$lib/i18n/settings";

export function WebAppHeading() {
  const s = useSettingsText();
  return <h2>{s("Web app")}</h2>;
}
```

The settings helper does not accept interpolation parameters. Inspect its signature before using it for dynamic text. Use the main translator for messages requiring `{count}` or other real values. Avoid inventing `label(locale)` or changing the translation API.

Translate tooltips, placeholders, empty/error/loading messages, toasts, visible labels, and accessible `aria-label`, `title`, and meaningful `alt` text. Keep product names, commands, model identifiers, paths, and user-generated content literal.

Both translation systems have fallback behaviour. A fallback displaying English is not proof that a translation exists. Check the relevant dictionary or settings pair for every new message.

## Complete sentences and counts

The main translator supports `{name}` replacement. It has no ICU plural engine. Use real values as parameters; keep grammatical pieces out of them.

For count-sensitive messages, add complete messages for the grammatical categories each language needs. Arabic may require zero, one, two, few, many, and other forms. If necessary, use `Intl.PluralRules(language)` to select complete-message keys in a focused implementation. Declare all chosen keys and translations before using them. Do not assume English singular/plural rules work for Arabic.

A sentence such as the existing project heading can use one count placeholder because it does not construct a noun ending. Optional clauses should also use complete messages.

## Arabic layout

Check the rendered Arabic UI in both themes and at narrow widths:

1. Confirm `<html lang="ar" dir="rtl">` after selecting Arabic through the language menu.
2. Use logical spacing and alignment: `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `border-s`, `border-e`, and `text-start`.
3. Preserve DOM reading and focus order. Do not use blanket row reversal to compensate for RTL.
4. Mirror directional chevrons and drawer motion where the action requires it. Keep brand icons, checkmarks, and other non-directional symbols unchanged.
5. Isolate unknown user text with `<bdi>`. Use `dir="ltr"` for commands, paths, and model IDs that must retain their technical order.
6. Check punctuation, mixed numbers, selection, and copy/paste around Arabic labels and English identifiers.
7. Confirm Arabic glyphs join correctly and remain unclipped. Allow label wrapping and adequate line height.
8. Check dialog close placement, sidebar collapse/expansion, and menu focus return.

Use `min-w-0` on shrinking flex/grid children. Translate accessible names as well as visible text. Test Chinese labels for wrapping too.

## State preservation

`App.tsx` currently reloads relevant memory/profile data when language changes. Preserve that behaviour. Theme and language toggles must retain the current route, sidebar state, unsaved dialog draft, and selected items unless an existing documented flow intentionally changes them.

Browser checks are required to confirm these outcomes. Reading the store implementation alone cannot establish that every component keeps its state.
