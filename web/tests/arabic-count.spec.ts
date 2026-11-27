import { expect, it } from "bun:test";
import { arabicCount } from "../src/lib/i18n/arabic-count.ts";

it("picks the Arabic plural form for a count of days", () => {
  expect(arabicCount("{count} days", 1)).toBe("يوم واحد");
  expect(arabicCount("{count} days", 2)).toBe("يومان");
  expect(arabicCount("{count} days", 3)).toBe("3 أيام");
  expect(arabicCount("{count} days", 10)).toBe("10 أيام");
  expect(arabicCount("{count} days", 11)).toBe("11 يوماً");
  expect(arabicCount("{count} days", 30)).toBe("30 يوماً");
  expect(arabicCount("{count} days", 100)).toBe("100 يوم");
});

it("picks the Arabic plural form for a count of hours", () => {
  expect(arabicCount("{count} hours", 1)).toBe("ساعة واحدة");
  expect(arabicCount("{count} hours", 2)).toBe("ساعتان");
  expect(arabicCount("{count} hours", 5)).toBe("5 ساعات");
  expect(arabicCount("{count} hours", 72)).toBe("72 ساعة");
});

it("leaves other messages and counts that are not whole numbers to the table", () => {
  expect(arabicCount("{count} maps", 3)).toBeUndefined();
  expect(arabicCount("{count} days", "abc")).toBeUndefined();
});

it("the Settings card translator uses the Arabic form, and leaves other languages alone", async () => {
  const { cardText } = await import("../src/lib/i18n/settings-cards.ts");
  expect(cardText("{count} days", "ar", { count: "30" })).toBe("30 يوماً");
  expect(cardText("{count} hours", "ar", { count: "1" })).toBe("ساعة واحدة");
  expect(cardText("{count} days", "en", { count: "30" })).toBe("30 days");
  expect(cardText("{count} days", "zh", { count: "30" })).toBe("30 天");
});
