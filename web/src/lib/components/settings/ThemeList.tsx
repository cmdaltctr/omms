import { Check } from "lucide-react";
import { Badge } from "$lib/components/ui/badge";
import { useSettingsText } from "$lib/i18n/settings";
import { isDefaultTheme, themesOf, type ThemeDefinition } from "$lib/themes/catalogue";

/** A small picture of the theme: its canvas, a line of text, a muted line and the accent. */
function Swatch({ theme }: { theme: ThemeDefinition }) {
  const { canvas, elevated, text, textSecondary, accent, border } = theme.colours;
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-14 shrink-0 flex-col justify-center gap-1 rounded-md border px-1.5"
      style={{ background: canvas, borderColor: border }}
    >
      <span className="h-1.5 w-8 rounded-full" style={{ background: text }} />
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-5 rounded-full" style={{ background: textSecondary }} />
        <span
          className="size-2.5 rounded-full"
          style={{ background: accent, boxShadow: `0 0 0 2px ${elevated}` }}
        />
      </span>
    </span>
  );
}

type Props = {
  variant: "light" | "dark";
  selected: string;
  /** Lower-case text the theme names must contain. */
  filter: string;
  /** True while this list's theme is the one on screen. */
  inUse: boolean;
  onSelect: (id: string) => void;
};

/** The light or dark themes as a radio list, each with its swatch. Themes come from OpenChamber (MIT). */
export function ThemeList({ variant, selected, filter, inUse, onSelect }: Props) {
  const s = useSettingsText();
  const title = variant === "light" ? s("Light theme") : s("Dark theme");
  const themes = themesOf(variant).filter((theme) => theme.name.toLowerCase().includes(filter));

  return (
    <fieldset aria-label={title} className="flex min-w-0 flex-col gap-2">
      <legend className="flex w-full items-center gap-2 pb-2">
        <span className="text-ui font-semibold">{title}</span>
        {inUse ? <Badge>{s("On screen now")}</Badge> : null}
      </legend>
      {themes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{s("No theme matches.")}</p>
      ) : (
        // `relative` keeps the visually hidden radios inside the scroll box.
        <div className="relative flex max-h-80 min-w-0 flex-col overflow-y-auto rounded-[10px] border border-border p-1">
          {themes.map((theme) => {
            const checked = theme.id === selected;
            return (
              <label
                key={theme.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-interactive-hover has-[:checked]:bg-selection has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-2px] has-[:focus-visible]:outline-ring"
              >
                <input
                  type="radio"
                  name={`theme-${variant}`}
                  value={theme.id}
                  checked={checked}
                  onChange={() => onSelect(theme.id)}
                  className="sr-only"
                />
                <Swatch theme={theme} />
                <bdi className="min-w-0 flex-1 truncate text-ui">{theme.name}</bdi>
                {isDefaultTheme(theme) ? (
                  <span className="text-xs text-muted-foreground">{s("Default")}</span>
                ) : null}
                {checked ? (
                  <Check aria-hidden="true" className="size-4 shrink-0 text-primary-label" />
                ) : null}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
