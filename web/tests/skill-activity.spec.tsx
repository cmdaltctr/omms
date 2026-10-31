import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillActivityView } from "../src/lib/components/skills/charts/SkillActivity.tsx";
import { STATE_COLOUR } from "../src/lib/components/skills/charts/PipelineChart.tsx";
import { UsesChart } from "../src/lib/components/skills/charts/UsesChart.tsx";
import {
  DEFAULT_RANGE,
  dayRows,
  normaliseActivity,
  pipelineCounts,
  withSuccess,
} from "../src/lib/skill-activity.ts";
import type { Proposal } from "../src/lib/skills-api.ts";

const zeroDays = Array.from({ length: 30 }, (_, i) => ({
  day: `2026-10-${String(i + 1).padStart(2, "0")}`,
  uses: 0,
  failed: 0,
}));

const view = (over: Partial<Parameters<typeof SkillActivityView>[0]> = {}) =>
  renderToStaticMarkup(
    <SkillActivityView
      activity={normaliseActivity({ days: zeroDays, topSkills: [], totals: {} })}
      range={DEFAULT_RANGE}
      loading={false}
      onRange={() => {}}
      error=""
      proposals={[]}
      onOpen={() => {}}
      {...over}
    />
  );

it("explains that the charts appear after recording when no skill was used", () => {
  const html = view();
  expect(html).toContain("Activity");
  expect(html).toContain("The use charts appear after OMMS records agent turns that use a skill.");
  expect(html).not.toContain("Uses per day");
  expect(html).not.toContain("Most used skills");
  expect(html).toContain("Proposal pipeline");
  expect(html).toContain("No proposals yet.");
  expect(html).toContain("Active skills");
});

it("shows a loading line, then an error that leaves the page working", () => {
  expect(view({ activity: null })).toContain("Loading…");
  const failed = view({ activity: null, error: "Not found" });
  expect(failed).toContain('role="alert"');
  expect(failed).toContain("Activity could not load. Not found");
  expect(failed).not.toContain("Loading…");
});

it("shows the empty state on a detail chart with no uses", () => {
  const html = renderToStaticMarkup(
    <UsesChart rows={dayRows(zeroDays)} title="Uses in the last 30 days" />
  );
  expect(html).toContain("No uses in the last 30 days.");
  expect(html).not.toContain("<table");
});

it("reads an activity reply with missing fields as empty", () => {
  expect(normaliseActivity(null)).toEqual({
    bucket: "day",
    series: [],
    days: [],
    topSkills: [],
    topTotal: 0,
    totals: { uses: 0, failed: 0, activeSkills: 0 },
    available: { months: [], years: [] },
  });
  const data = normaliseActivity({
    days: [{ day: "2026-10-01", uses: 4 }, { uses: 2 }],
    topSkills: [{ name: "deploy", uses: 3, failed: 1 }],
    totals: { uses: 4, failed: -1, activeSkills: 1 },
  });
  expect(data.days).toEqual([{ day: "2026-10-01", uses: 4, failed: 0 }]);
  expect(data.topSkills[0]).toEqual({ name: "deploy", path: null, uses: 3, failed: 1 });
  expect(data.totals.failed).toBe(0);
});

it("splits uses into successful and failed parts that add up", () => {
  expect(withSuccess({ uses: 5, failed: 2 })).toMatchObject({ succeeded: 3, failed: 2 });
  expect(withSuccess({ uses: 1, failed: 4 })).toMatchObject({ succeeded: 0, failed: 1 });
});

it("counts proposals per state in pipeline order", () => {
  const states = ["applied", "pending", "applied", "undone"] as Proposal["state"][];
  expect(pipelineCounts(states.map((state) => ({ state })))).toEqual([
    { state: "pending", count: 1 },
    { state: "applied", count: 2 },
    { state: "rejected", count: 0 },
    { state: "stale", count: 0 },
    { state: "undone", count: 1 },
  ]);
});

it("gives every proposal state its own colour in the pipeline chart", () => {
  const states = pipelineCounts([]).map((row) => row.state);
  const colours = states.map((state) => STATE_COLOUR[state]);
  expect(colours.every(Boolean)).toBe(true);
  expect(new Set(colours).size).toBe(states.length);
});
