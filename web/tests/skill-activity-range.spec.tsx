import { afterEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityRangeControl } from "../src/lib/components/skills/charts/ActivityRangeControl.tsx";
import { SkillActivityView } from "../src/lib/components/skills/charts/SkillActivity.tsx";
import { TopSkillsChartView } from "../src/lib/components/skills/charts/TopSkillsChart.tsx";
import { UsesChart, axisWidth } from "../src/lib/components/skills/charts/UsesChart.tsx";
import {
  DEFAULT_RANGE,
  checkRange,
  moreTop,
  normaliseActivity,
  periodLabel,
  periodName,
  pickerOptions,
  rangeForBucket,
  rangeFromPicker,
  rangeRequest,
  rangeText,
  readRange,
  type ActivityRange,
} from "../src/lib/skill-activity.ts";

const gb = { locale: "en-GB", choice: { date: "auto", time: "auto" } as const };
const available = { months: ["2026-10", "2026-01", "2025-03"], years: [2026, 2025, 2024] };
const identity = (message: string) => message;
const savedTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = savedTz;
});

describe("range to request", () => {
  it("asks for 30 days, one month by day, one year by month, or every year", () => {
    expect(rangeRequest(DEFAULT_RANGE)).toEqual({ bucket: "day", days: 30 });
    expect(rangeRequest({ bucket: "day", month: "2026-10" })).toEqual({
      bucket: "day",
      month: "2026-10",
    });
    expect(rangeRequest({ bucket: "month", year: 2025 })).toEqual({ bucket: "month", year: 2025 });
    expect(rangeRequest({ bucket: "year" })).toEqual({ bucket: "year" });
  });

  it("starts Days at the last 30 days and Months at this year", () => {
    expect(rangeForBucket("day", 2026)).toEqual(DEFAULT_RANGE);
    expect(rangeForBucket("month", 2026)).toEqual({ bucket: "month", year: 2026 });
    expect(rangeForBucket("year", 2026)).toEqual({ bucket: "year" });
  });

  it("reads the picker value for the current choice", () => {
    expect(rangeFromPicker(DEFAULT_RANGE, "2025-03")).toEqual({ bucket: "day", month: "2025-03" });
    expect(rangeFromPicker({ bucket: "day", month: "2025-03" }, "last-30")).toEqual(DEFAULT_RANGE);
    expect(rangeFromPicker({ bucket: "month", year: 2026 }, "2024")).toEqual({
      bucket: "month",
      year: 2024,
    });
  });
});

describe("saved range", () => {
  it("round-trips every range through its saved text", () => {
    const ranges: ActivityRange[] = [
      DEFAULT_RANGE,
      { bucket: "day", month: "2026-01" },
      { bucket: "month", year: 2024 },
      { bucket: "year" },
    ];
    for (const range of ranges) expect(readRange(rangeText(range))).toEqual(range);
  });

  it("reads missing or malformed text as the last 30 days", () => {
    for (const raw of [null, "", "week", "day:2026-13", "day:26-01", "month:abc", "month:"]) {
      expect(readRange(raw), String(raw)).toEqual(DEFAULT_RANGE);
    }
  });

  it("keeps a range that still has data and falls back when its month or year is gone", () => {
    const month: ActivityRange = { bucket: "day", month: "2026-01" };
    const year: ActivityRange = { bucket: "month", year: 2024 };
    expect(checkRange(month, available)).toBe(month);
    expect(checkRange(year, available)).toBe(year);
    expect(checkRange(DEFAULT_RANGE, available)).toBe(DEFAULT_RANGE);
    const years: ActivityRange = { bucket: "year" };
    expect(checkRange(years, available)).toBe(years);
    expect(checkRange({ bucket: "day", month: "2023-05" }, available)).toEqual(DEFAULT_RANGE);
    expect(checkRange({ bucket: "month", year: 2019 }, available)).toEqual(DEFAULT_RANGE);
  });
});

describe("labels", () => {
  it("labels days, months and years short on the axis and in full in the tooltip", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(periodLabel("day", "2026-10-12", false, gb)).toBe("12 Oct");
    expect(periodLabel("day", "2026-10-12", true, gb)).toBe("12 Oct 2026");
    expect(periodLabel("month", "2026-01", false, gb)).toBe("Jan");
    expect(periodLabel("month", "2026-01", true, gb)).toBe("January 2026");
    expect(periodLabel("year", "2026", false, gb)).toBe("2026");
    expect(periodLabel("year", "2026", true, gb)).toBe("2026");
  });

  it("names Gregorian months in Arabic, not the Hijri calendar", () => {
    const ar = { ...gb, locale: "ar-SA" };
    expect(periodLabel("month", "2026-10", true, ar)).toContain("أكتوبر");
  });

  it("names the window of the shown numbers", () => {
    const series = (keys: string[]) => keys.map((key) => ({ key, uses: 0, failed: 0 }));
    expect(periodName(DEFAULT_RANGE, [], gb, identity)).toBe("Last 30 days");
    expect(periodName({ bucket: "day", month: "2026-10" }, [], gb, identity)).toBe("October 2026");
    expect(periodName({ bucket: "month", year: 2025 }, [], gb, identity)).toBe("2025");
    expect(periodName({ bucket: "year" }, series(["2024", "2025", "2026"]), gb, identity)).toBe(
      "2024 to 2026"
    );
    expect(periodName({ bucket: "year" }, series(["2026"]), gb, identity)).toBe("2026");
  });

  it("offers the last 30 days and each month with data, or the years newest first", () => {
    expect(pickerOptions(DEFAULT_RANGE, available, 2026, gb, "Last 30 days")).toEqual([
      { value: "last-30", label: "Last 30 days" },
      { value: "2026-10", label: "October 2026" },
      { value: "2026-01", label: "January 2026" },
      { value: "2025-03", label: "March 2025" },
    ]);
    const noData = { months: [], years: [] };
    expect(pickerOptions({ bucket: "month", year: 2024 }, noData, 2026, gb, "")).toEqual([
      { value: "2026", label: "2026" },
      { value: "2024", label: "2024" },
    ]);
    expect(pickerOptions({ bucket: "year" }, available, 2026, gb, "")).toEqual([]);
  });
});

const activity = (over: Record<string, unknown>) =>
  normaliseActivity({
    topSkills: [{ name: "deploy", path: null, uses: 3, failed: 1 }],
    totals: { uses: 3, failed: 1, activeSkills: 1 },
    available,
    ...over,
  });

const view = (range: ActivityRange, data: ReturnType<typeof normaliseActivity>, loading = false) =>
  renderToStaticMarkup(
    <SkillActivityView
      activity={data}
      range={range}
      shownRange={range}
      loading={loading}
      error=""
      proposals={[]}
      onOpen={() => {}}
      onRange={() => {}}
    />
  );

describe("Activity section by range", () => {
  it("shows the day chart for the last 30 days with the choice and picker", () => {
    const html = view(
      DEFAULT_RANGE,
      activity({ bucket: "day", series: [{ key: "2026-10-12", uses: 3, failed: 1 }] })
    );
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/aria-checked="true"[^>]*>Days</);
    expect(html).toContain('role="combobox"');
    expect(html).toContain("Last 30 days");
    expect(html).toContain("Uses per day");
    expect(html).toContain("Last 30 days: 3 uses, 1 with a failed tool call");
    expect(html).toContain('<th scope="col">Day</th>');
    expect(html).toContain("Uses in 30 days");
  });

  it("shows 12 months of a year with a month table", () => {
    const series = Array.from({ length: 12 }, (_, i) => ({
      key: `2025-${String(i + 1).padStart(2, "0")}`,
      uses: i === 2 ? 3 : 0,
      failed: i === 2 ? 1 : 0,
    }));
    const html = view({ bucket: "month", year: 2025 }, activity({ bucket: "month", series }));
    expect(html).toMatch(/aria-checked="true"[^>]*>Months</);
    expect(html).toContain("Uses per month");
    expect(html).not.toContain("Uses per day");
    expect(html).toContain('<th scope="col">Month</th>');
    expect(html).toContain("March 2025");
    expect(html).toContain("2025: 3 uses, 1 with a failed tool call");
    expect(html).toContain("Uses in 2025");
    expect(html).toContain('aria-label="Year to show"');
  });

  it("shows one bar per year with no picker", () => {
    const series = ["2024", "2025", "2026"].map((key) => ({ key, uses: 1, failed: 0 }));
    const html = view({ bucket: "year" }, activity({ bucket: "year", series }));
    expect(html).toMatch(/aria-checked="true"[^>]*>Years</);
    expect(html).not.toContain('role="combobox"');
    expect(html).toContain("Uses per year");
    expect(html).toContain('<th scope="col">Year</th>');
    expect(html).toContain("2024 to 2026: 3 uses");
  });

  it("keeps the shown chart and marks it busy while a new range loads", () => {
    const data = activity({ bucket: "day", series: [{ key: "2026-10-12", uses: 3, failed: 1 }] });
    const busy = renderToStaticMarkup(
      <SkillActivityView
        activity={data}
        range={{ bucket: "month", year: 2026 }}
        shownRange={DEFAULT_RANGE}
        loading
        error=""
        proposals={[]}
        onOpen={() => {}}
        onRange={() => {}}
      />
    );
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain("Uses per day");
    expect(busy).toMatch(/aria-checked="true"[^>]*>Months</);
    expect(busy).toMatch(/role="status"[^>]*>Loading…</);
    expect(view(DEFAULT_RANGE, data)).not.toContain('aria-busy="true"');
  });

  it("says which month or year has no uses", () => {
    const zero = (bucket: string, keys: string[]) =>
      activity({ bucket, series: keys.map((key) => ({ key, uses: 0, failed: 0 })), topSkills: [] });
    expect(view({ bucket: "day", month: "2026-01" }, zero("day", ["2026-01-01"]))).toContain(
      "No skill uses are recorded in January 2026."
    );
    expect(view({ bucket: "month", year: 2024 }, zero("month", ["2024-01"]))).toContain(
      "No skill uses are recorded in 2024."
    );
    expect(view({ bucket: "year" }, zero("year", ["2026"]))).toContain(
      "No skill uses are recorded yet."
    );
  });
});

it("renders the range control with only the chosen button in the tab order", () => {
  const html = renderToStaticMarkup(
    <ActivityRangeControl
      range={{ bucket: "day", month: "2026-01" }}
      available={available}
      currentYear={2026}
      loading={false}
      onChange={() => {}}
    />
  );
  expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  expect(html).toContain('aria-label="Days to show"');
  expect(html).toContain("January 2026");
});

describe("most used skills", () => {
  const skills = Array.from({ length: 23 }, (_, i) => ({
    name: i === 0 ? "a-very-long-skill-name-that-needs-cropping" : `skill-${i}`,
    path: null,
    uses: 30 - i,
    failed: i % 3,
  }));
  const chart = (shown: number) =>
    renderToStaticMarkup(
      <TopSkillsChartView
        skills={skills}
        total={23}
        shown={shown}
        onShown={() => {}}
        onOpen={() => {}}
      />
    );

  it("grows by 8 up to every loaded skill", () => {
    expect(moreTop(8, 23)).toBe(16);
    expect(moreTop(16, 23)).toBe(23);
    expect(moreTop(23, 23)).toBe(23);
    expect(moreTop(8, 5)).toBe(5);
  });

  it("shows 8 rows, the count and Show more, then Show less when all are shown", () => {
    const first = chart(8);
    expect(first).toContain("Showing 8 of 23");
    expect(first).toContain("Show more");
    expect(first).not.toContain("Show less");
    expect(first.match(/<li class="flex h-\[26px\]/g)).toHaveLength(8);
    const all = chart(23);
    expect(all).toContain("Showing 23 of 23");
    expect(all).toContain("Show less");
    expect(all).not.toContain("Show more");
    expect(all.match(/<li class="flex h-\[26px\]/g)).toHaveLength(23);
  });

  it("scrolls the list past 16 rows so the card stops growing", () => {
    expect(chart(16)).not.toContain("overflow-y-auto");
    const long = chart(23);
    expect(long).toContain("overflow-y-auto");
    expect(long).toContain("max-height:448px");
  });

  it("crops long names at the end and shows the full name on hover and focus", () => {
    const html = chart(8);
    expect(html).toMatch(/<button[^>]*class="[^"]*truncate[^"]*"[^>]*>a-very-long-skill-name/);
    expect(html).toMatch(/role="tooltip"[^>]*>a-very-long-skill-name-that-needs-cropping/);
    expect(html).not.toContain("<title>");
  });

  it("keeps the name buttons and Show more outside every hidden box", () => {
    const html = chart(8);
    const before = (marker: string) => html.slice(0, html.indexOf(marker));
    // No hidden box opens before the name list, so the list is not inside one.
    expect(before('<ol class="w-[6.5rem]').match(/<div aria-hidden="true"/g)).toBeNull();
    // The last hidden box before Show more is the legend, and it has closed.
    const footer = before("Show more");
    expect(footer.slice(footer.lastIndexOf('<div aria-hidden="true">'))).toContain("</ul></div>");
  });

  it("shows no count line or buttons for 8 skills or fewer", () => {
    const html = renderToStaticMarkup(
      <TopSkillsChartView
        skills={skills.slice(0, 5)}
        total={5}
        shown={8}
        onShown={() => {}}
        onOpen={() => {}}
      />
    );
    expect(html).not.toContain("Showing");
    expect(html).not.toContain("Show more");
  });
});

describe("use colours and layout", () => {
  it("widens the Y axis for big year counts so no digit is cropped", () => {
    const rows = (uses: number) => [{ key: "2026", uses, failed: 0 }];
    expect(axisWidth(rows(4))).toBe(28);
    expect(axisWidth(rows(543))).toBeGreaterThanOrEqual(3 * 7 + 10);
    expect(axisWidth(rows(950))).toBeGreaterThanOrEqual(4 * 7 + 10);
    expect(axisWidth([])).toBe(28);
  });

  it("fills uses with the status tokens and draws failed uses without stripes", () => {
    const html = renderToStaticMarkup(
      <UsesChart rows={[{ key: "2026-10-12", uses: 3, failed: 1 }]} title="Uses per day" />
    );
    expect(html).toContain("--color-succeeded: var(--status-success)");
    expect(html).toContain("--color-failed: var(--destructive)");
    expect(html).not.toContain("repeating-linear-gradient");
    expect(html).not.toContain("<pattern");
    expect(html).not.toContain("--chart-2");
    expect(html).not.toContain("--chart-5");
  });

  it("gives the uses chart the whole row on wide screens and the other two half each", () => {
    const html = view(
      DEFAULT_RANGE,
      activity({ bucket: "day", series: [{ key: "2026-10-12", uses: 3, failed: 1 }] })
    );
    expect(html).toContain("lg:grid-cols-2");
    expect(html).toContain("lg:col-span-2");
    expect(html).not.toContain("lg:grid-cols-3");
  });
});
