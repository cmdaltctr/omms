import { getLanguage } from "./i18n";
import {
  autoLocale,
  formatDateOnlyWith,
  formatDateTimeWith,
  formatDayWith,
  formatTimeWith,
  getDateFormat,
  type DateFormatChoice,
} from "./date-format";

type DateValue = string | number | Date;

const toDate = (value: DateValue) => (value instanceof Date ? value : new Date(value));
const locale = () =>
  autoLocale(getLanguage(), typeof navigator === "undefined" ? undefined : navigator.language);

/** A date and time in the user's chosen format. */
export function formatDate(value: DateValue): string {
  return formatDateTimeWith(toDate(value), getDateFormat(), locale());
}

/** A date with its year, without a time. */
export function formatDateOnly(value: DateValue): string {
  return formatDateOnlyWith(toDate(value), getDateFormat(), locale());
}

/** A day and month, for example `28 Oct`. */
export function formatDay(value: DateValue): string {
  return formatDayWith(toDate(value), getDateFormat(), locale());
}

export function formatTime(value: DateValue, choice = getDateFormat()): string {
  return formatTimeWith(toDate(value), choice, locale());
}

/** The locale and date style the page formats dates with, for pure label helpers. */
export function dateContext(): { locale: string; choice: DateFormatChoice } {
  return { locale: locale(), choice: getDateFormat() };
}

/** A date in a given format choice, for the examples in Settings. */
export function formatDateOnlyAs(value: DateValue, choice: DateFormatChoice): string {
  return formatDateOnlyWith(toDate(value), choice, locale());
}

const BYTE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;

/** A size in the page language, for example `1.5 MB`. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let step = 0;
  while (value >= 1024 && step < BYTE_UNITS.length - 1) {
    value /= 1024;
    step++;
  }
  return new Intl.NumberFormat(locale(), {
    style: "unit",
    unit: BYTE_UNITS[step],
    unitDisplay: "short",
    maximumFractionDigits: step === 0 ? 0 : 1,
  }).format(value);
}
