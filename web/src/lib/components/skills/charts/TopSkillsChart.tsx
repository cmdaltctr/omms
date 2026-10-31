import { useState } from "react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { Button } from "$lib/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "$lib/components/ui/chart";
import { Tooltip } from "$lib/components/ui/tooltip";
import { useSettingsText } from "$lib/i18n/settings";
import { cn } from "$lib/utils";
import { TOP_STEP, moreTop, withSuccess } from "$lib/skill-activity";
import type { TopSkill } from "$lib/skills-api";
import { fill } from "$lib/skills-model";
import { ChartCard } from "./ChartCard";
import { SEGMENT_GAP, UsesLegend, useUseConfig } from "./UseMarks";

/** Height of one skill row. The name list and the bars share it, so they line up. */
const ROW = 26;
/** Past this many rows the list scrolls, so the card stops growing. */
export const SCROLL_ROWS = 16;

type ViewProps = {
  /** The loaded top skills, most used first. */
  skills: readonly TopSkill[];
  /** Distinct skills used in the window; `skills` may hold fewer. */
  total: number;
  /** Rows shown now. */
  shown: number;
  onShown: (shown: number) => void;
  onOpen: (skill: TopSkill) => void;
  className?: string;
};

/**
 * The most used skills as horizontal bars, failed part on the end. Each name
 * is a button that opens the skill and shows the full name on hover and on
 * keyboard focus. A click on a bar opens the skill too. Show more adds 8 rows.
 */
export function TopSkillsChartView({
  skills,
  total,
  shown,
  onShown,
  onOpen,
  className,
}: ViewProps) {
  const s = useSettingsText();
  const config = useUseConfig();
  const data = skills.slice(0, shown).map(withSuccess);
  const top = data[0];
  const open = (row: unknown) => {
    const skill = (row as { payload?: TopSkill } | undefined)?.payload;
    if (skill) onOpen(skill);
  };
  return (
    <ChartCard
      className={className}
      interactive
      title={s("Most used skills")}
      summary={
        top
          ? fill(s("{name} leads with {uses} uses. Click a bar to open the skill."), {
              name: top.name,
              uses: top.uses,
            })
          : undefined
      }
      emptyText={data.length === 0 ? s("No skill was used in the last 30 days.") : ""}
      table={{
        columns: [s("Skill"), s("Uses"), s("Failed")],
        rows: data.map((skill) => [skill.name, skill.uses, skill.failed]),
      }}
    >
      {/* A scrolling box clips each name's popover above its row, so the box
          starts with room for the popover of the first row. */}
      <div
        className={cn(
          "flex gap-2",
          data.length > SCROLL_ROWS && "overflow-y-auto overscroll-contain pt-8"
        )}
        style={data.length > SCROLL_ROWS ? { maxHeight: `${SCROLL_ROWS * ROW + 32}px` } : undefined}
      >
        <ol className="w-[6.5rem] shrink-0" aria-label={s("Most used skills")}>
          {data.map((skill) => (
            <li
              key={`${skill.name}\n${skill.path ?? ""}`}
              className="flex h-[26px] items-center justify-end"
            >
              <Tooltip content={skill.name} className="min-w-0 max-w-full">
                <button
                  type="button"
                  className="block max-w-full truncate rounded-sm text-end text-xs hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => onOpen(skill)}
                >
                  {skill.name}
                </button>
              </Tooltip>
            </li>
          ))}
        </ol>
        <div aria-hidden="true" className="min-w-0 flex-1">
          <ChartContainer
            config={config}
            className="aspect-auto w-full"
            style={{ height: `${data.length * ROW}px` }}
          >
            <BarChart
              data={data}
              layout="vertical"
              accessibilityLayer={false}
              margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
            >
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="name" hide />
              <ChartTooltip
                cursor={{ fill: "var(--interactive-hover)" }}
                content={<ChartTooltipContent />}
              />
              <Bar
                dataKey="succeeded"
                stackId="uses"
                fill="var(--color-succeeded)"
                cursor="pointer"
                onClick={open}
                {...SEGMENT_GAP}
              />
              <Bar
                dataKey="failed"
                stackId="uses"
                fill="var(--color-failed)"
                radius={[0, 2, 2, 0]}
                cursor="pointer"
                onClick={open}
                {...SEGMENT_GAP}
              />
            </BarChart>
          </ChartContainer>
        </div>
      </div>
      <div aria-hidden="true">
        <UsesLegend />
      </div>
      {total > TOP_STEP ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {fill(s("Showing {shown} of {total}"), { shown: data.length, total })}
          </p>
          <div className="flex gap-2">
            {data.length < skills.length ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onShown(moreTop(shown, skills.length))}
              >
                {s("Show more")}
              </Button>
            ) : null}
            {data.length > TOP_STEP ? (
              <Button type="button" variant="outline" size="sm" onClick={() => onShown(TOP_STEP)}>
                {s("Show less")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </ChartCard>
  );
}

/** Starts at 8 rows. Give it a new `key` for a new range to start again. */
export function TopSkillsChart(props: Omit<ViewProps, "shown" | "onShown">) {
  const [shown, setShown] = useState(TOP_STEP);
  return <TopSkillsChartView {...props} shown={shown} onShown={setShown} />;
}
