// The user's date and time format, kept per browser, and the functions that apply it.
// The formatting functions are pure on purpose: callers pass the choice and the language,
// so tests need no browser and no stored value.
import { readPreference, writePreference } from "./preferences";

export const DATE_STYLES = ["auto", "dmy", "mdy", "iso"] as const;
export const TIME_STYLES = ["auto", "h23", "h12"] as const;
export type DateStyle = (typeof DATE_STYLES)[number];
export type TimeStyle = (typeof TIME_STYLES)[number];
export type DateFormatChoice = { date: DateStyle; time: TimeStyle };
type Lang = "en" | "zh" | "ar";

const DATE_KEY = "omms-date-format";
const TIME_KEY = "omms-time-format";

export function parseDateStyle(value: string | null): DateStyle {
  return (DATE_STYLES as readonly string[]).includes(value ?? "") ? (value as DateStyle) : "auto";
}

export function parseTimeStyle(value: string | null): TimeStyle {
  return (TIME_STYLES as readonly string[]).includes(value ?? "") ? (value as TimeStyle) : "auto";
}

/** Automatic follows the page language; English keeps the browser's own English variant. */
export function autoLocale(lang: Lang, browser?: string): string {
  if (lang === "zh") return "zh-CN";
  if (lang === "ar") return "ar-SA";
  return browser?.toLowerCase().startsWith("en") ? browser : "en-US";
}

const pad = (value: number) => String(value).padStart(2, "0");

function dateText(date: Date, style: DateStyle, locale: string, withYear: boolean): string {
  if (style === "iso")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (withYear) options.year = "numeric";
  const fixed = style === "dmy" ? "en-GB" : style === "mdy" ? "en-US" : locale;
  return new Intl.DateTimeFormat(fixed, options).format(date);
}

export function formatTimeWith(value: Date, choice: DateFormatChoice, locale: string): string {
  if (choice.time === "h23") {
    const options = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
    return new Intl.DateTimeFormat("en-GB", options).format(value);
  }
  if (choice.time === "h12") {
    const options = { hour: "numeric", minute: "2-digit", hourCycle: "h12" } as const;
    return new Intl.DateTimeFormat("en-US", options).format(value);
  }
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(value);
}

/** A day and month, for example `28 Oct`. The ISO style keeps the year. */
export function formatDayWith(value: Date, choice: DateFormatChoice, locale: string): string {
  return dateText(value, choice.date, locale, choice.date === "iso");
}

export function formatDateOnlyWith(value: Date, choice: DateFormatChoice, locale: string): string {
  return dateText(value, choice.date, locale, true);
}

export function formatDateTimeWith(value: Date, choice: DateFormatChoice, locale: string): string {
  if (choice.date === "auto" && choice.time === "auto") {
    return value.toLocaleString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return `${dateText(value, choice.date, locale, true)}, ${formatTimeWith(value, choice, locale)}`;
}

/** Whether `value` falls on the same local day as `now`, the day before, or earlier. */
export function relativeDay(value: Date, now: Date): "today" | "yesterday" | "earlier" {
  const start = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const days = Math.round((start(now) - start(value)) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return "earlier";
}

let current: DateFormatChoice = readChoice();
const listeners = new Set<() => void>();

function readChoice(): DateFormatChoice {
  if (typeof window === "undefined") return { date: "auto", time: "auto" };
  return {
    date: parseDateStyle(readPreference(DATE_KEY, DATE_KEY)),
    time: parseTimeStyle(readPreference(TIME_KEY, TIME_KEY)),
  };
}

export function getDateFormat(): DateFormatChoice {
  return current;
}

export function setDateFormat(change: Partial<DateFormatChoice>): void {
  current = { ...current, ...change };
  writePreference(DATE_KEY, current.date);
  writePreference(TIME_KEY, current.time);
  for (const listener of listeners) listener();
}

export function subscribeDateFormat(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
