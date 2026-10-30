import { expect, it } from "bun:test";
import {
  autoLocale,
  formatDateTimeWith,
  formatDayWith,
  formatTimeWith,
  parseDateStyle,
  parseTimeStyle,
  relativeDay,
  type DateFormatChoice,
} from "../src/lib/date-format.ts";

// Local time, so the expected text does not depend on the test machine's time zone.
const evening = new Date(2026, 9, 28, 17, 43);
const choice = (date: DateFormatChoice["date"], time: DateFormatChoice["time"]) => ({ date, time });

it("formats each date style with a 24-hour clock", () => {
  expect(formatDateTimeWith(evening, choice("dmy", "h23"), "en-US")).toBe("28 Oct 2026, 17:43");
  expect(formatDateTimeWith(evening, choice("mdy", "h23"), "en-US")).toBe("Oct 28, 2026, 17:43");
  expect(formatDateTimeWith(evening, choice("iso", "h23"), "en-US")).toBe("2026-10-28, 17:43");
});

it("formats a 12-hour clock", () => {
  expect(formatTimeWith(evening, choice("dmy", "h12"), "en-GB")).toBe("5:43 PM");
  expect(formatTimeWith(evening, choice("dmy", "h23"), "en-US")).toBe("17:43");
});

it("keeps the language's own format when both are automatic", () => {
  const expected = evening.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  expect(formatDateTimeWith(evening, choice("auto", "auto"), "en-US")).toBe(expected);
});

it("gives a day and month, keeping the year only for ISO", () => {
  expect(formatDayWith(evening, choice("dmy", "auto"), "en-US")).toBe("28 Oct");
  expect(formatDayWith(evening, choice("mdy", "auto"), "en-US")).toBe("Oct 28");
  expect(formatDayWith(evening, choice("iso", "auto"), "en-US")).toBe("2026-10-28");
});

it("falls back to automatic for an unknown stored value", () => {
  expect(parseDateStyle("weird")).toBe("auto");
  expect(parseTimeStyle(null)).toBe("auto");
  expect(parseTimeStyle("h23")).toBe("h23");
});

it("follows the page language, and the browser's English variant for English", () => {
  expect(autoLocale("en", "en-GB")).toBe("en-GB");
  expect(autoLocale("en", "fr-FR")).toBe("en-US");
  expect(autoLocale("zh", "en-GB")).toBe("zh-CN");
  expect(autoLocale("ar")).toBe("ar-SA");
});

it("names today and yesterday by local calendar day", () => {
  const now = new Date(2026, 9, 30, 0, 5);
  expect(relativeDay(new Date(2026, 9, 30, 0, 1), now)).toBe("today");
  expect(relativeDay(new Date(2026, 9, 29, 23, 59), now)).toBe("yesterday");
  expect(relativeDay(new Date(2026, 9, 28, 12), now)).toBe("earlier");
});
