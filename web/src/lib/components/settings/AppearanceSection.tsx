import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Input } from "$lib/components/ui/input";
import { compactField, Select } from "$lib/components/ui/select";
import {
  DATE_STYLES,
  TIME_STYLES,
  setDateFormat,
  type DateStyle,
  type TimeStyle,
} from "$lib/date-format";
import { formatDateOnlyAs, formatTime } from "$lib/format";
import { useI18n } from "$lib/i18n";
import { useSettingsText } from "$lib/i18n/settings";
import { setPalette, setThemeMode, useTheme, useThemeChoice, type ThemeMode } from "$lib/theme";
import { ThemeList } from "./ThemeList";

const MODES: { value: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

const DATE_LABELS: Record<DateStyle, string> = {
  auto: "Automatic",
  dmy: "Day month year",
  mdy: "Month day year",
  iso: "Year-month-day",
};
const TIME_LABELS: Record<TimeStyle, string> = {
  auto: "Automatic",
  h23: "24-hour",
  h12: "12-hour",
};

function ThemeSettings() {
  const s = useSettingsText();
  const choice = useThemeChoice();
  const onScreen = useTheme();
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  return (
    <div className="space-y-3">
      <h3 className="text-subsection-title font-semibold">{s("Theme")}</h3>
      <p className="text-sm text-muted-foreground">
        {s(
          "System follows your operating system and switches between the light and the dark theme. The choice stays in this browser."
        )}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <fieldset
          aria-label={s("Theme mode")}
          className="inline-flex rounded-[10px] border border-border p-0.5"
        >
          {MODES.map(({ value, label, Icon }) => (
            <label
              key={value}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-ui text-muted-foreground transition-colors duration-150 hover:bg-interactive-hover has-[:checked]:bg-selection has-[:checked]:text-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
            >
              <input
                type="radio"
                name="theme-mode"
                value={value}
                checked={choice.mode === value}
                onChange={() => setThemeMode(value)}
                className="sr-only"
              />
              <Icon aria-hidden="true" className="size-3.5" />
              {s(label)}
            </label>
          ))}
        </fieldset>
        <Input
          type="search"
          aria-label={s("Filter themes")}
          placeholder={s("Filter themes")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="w-full sm:w-60"
        />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
        <ThemeList
          variant="light"
          selected={choice.light}
          filter={needle}
          inUse={onScreen === "light"}
          onSelect={(id) => setPalette("light", id)}
        />
        <ThemeList
          variant="dark"
          selected={choice.dark}
          filter={needle}
          inUse={onScreen === "dark"}
          onSelect={(id) => setPalette("dark", id)}
        />
      </div>
    </div>
  );
}

function DateTimeSettings() {
  const s = useSettingsText();
  // The context re-renders this card when the choice changes.
  const { dateFormat } = useI18n();
  const now = new Date();
  return (
    <div className="space-y-3">
      <h3 className="text-subsection-title font-semibold">{s("Date and time")}</h3>
      <p className="text-sm text-muted-foreground">
        {s("How dates and times show in this web app. The choice stays in this browser.")}
      </p>
      <div className="flex flex-wrap gap-4">
        <label className="block space-y-1 text-sm">
          <span>{s("Date format")}</span>
          <div className={compactField}>
            <Select
              aria-label={s("Date format")}
              className="w-full"
              value={dateFormat.date}
              onChange={(event) => setDateFormat({ date: event.target.value as DateStyle })}
            >
              {DATE_STYLES.map((style) => (
                <option key={style} value={style}>
                  {`${s(DATE_LABELS[style])} · ${formatDateOnlyAs(now, { ...dateFormat, date: style })}`}
                </option>
              ))}
            </Select>
          </div>
        </label>
        <label className="block space-y-1 text-sm">
          <span>{s("Time format")}</span>
          <div className={compactField}>
            <Select
              aria-label={s("Time format")}
              className="w-full"
              value={dateFormat.time}
              onChange={(event) => setDateFormat({ time: event.target.value as TimeStyle })}
            >
              {TIME_STYLES.map((style) => (
                <option key={style} value={style}>
                  {`${s(TIME_LABELS[style])} · ${formatTime(now, { ...dateFormat, time: style })}`}
                </option>
              ))}
            </Select>
          </div>
        </label>
      </div>
    </div>
  );
}

/** Settings > Appearance: the theme and the date and time formats, kept in this browser. */
export function AppearanceSection() {
  const s = useSettingsText();
  return (
    <section
      className="space-y-6 rounded-xl border border-border bg-card p-4"
      aria-label={s("Appearance")}
    >
      <h2 className="text-section-title font-semibold">{s("Appearance")}</h2>
      <ThemeSettings />
      <DateTimeSettings />
    </section>
  );
}
