import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "$lib/components/ui/chart";
import { dateContext } from "$lib/format";
import { useSettingsText } from "$lib/i18n/settings";
import { PERIOD_COLUMN, noUses, periodLabel, withSuccess } from "$lib/skill-activity";
import type { ActivityBucket, PeriodUse } from "$lib/skills-api";
import { countText, fill } from "$lib/skills-model";
import { ChartCard } from "./ChartCard";
import { SEGMENT_GAP, UsesLegend, useUseConfig } from "./UseMarks";

/**
 * Room for the longest Y axis number. A year can hold thousands of uses, so
 * a fixed width would crop the first digits. The top tick rounds up (950 can
 * show as 1000), so this allows a quarter more. About 7px per digit at 12px.
 */
export const axisWidth = (rows: readonly PeriodUse[]): number => {
  const top = Math.ceil(Math.max(0, ...rows.map((row) => row.uses)) * 1.25);
  return Math.max(28, String(top).length * 7 + 10);
};

/**
 * Uses per period as stacked bars: successful below, failed on top. The
 * Activity chart passes its `bucket` and `period`, and shows full labels in
 * the tooltip and table. Without `bucket` it is the per-skill chart of the
 * last 30 days, labelled as before.
 */
export function UsesChart({
  rows,
  bucket,
  period,
  title,
  className,
}: {
  rows: readonly PeriodUse[];
  bucket?: ActivityBucket;
  /** Names the window in the summary line, for example "October 2026". */
  period?: string;
  title: string;
  className?: string;
}) {
  const s = useSettingsText();
  const config = useUseConfig();
  const ctx = dateContext();
  const unit = bucket ?? "day";
  const data = rows.map(withSuccess);
  const uses = rows.reduce((sum, row) => sum + row.uses, 0);
  const failed = rows.reduce((sum, row) => sum + row.failed, 0);
  const tick = (key: unknown) => periodLabel(unit, String(key), false, ctx);
  const label = bucket ? (key: unknown) => periodLabel(unit, String(key), true, ctx) : tick;
  const counts = { uses: countText(uses), failed: countText(failed) };
  const emptyText = bucket
    ? s("No uses in this period. Bars appear after OMMS records turns.")
    : s("No uses in the last 30 days. Bars appear after OMMS records turns.");
  return (
    <ChartCard
      className={className}
      title={title}
      summary={
        period
          ? fill(s("{period}: {uses} uses, {failed} with a failed tool call"), {
              period,
              ...counts,
            })
          : fill(s("{uses} uses, {failed} with a failed tool call"), counts)
      }
      emptyText={noUses(rows) ? emptyText : ""}
      table={{
        columns: [s(PERIOD_COLUMN[unit]), s("Uses"), s("Failed")],
        rows: rows.map((row) => [label(row.key), row.uses, row.failed]),
      }}
    >
      <ChartContainer config={config} className="aspect-auto h-44 w-full">
        <BarChart data={data} accessibilityLayer={false} margin={{ top: 4, right: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="key"
            tickLine={false}
            axisLine={false}
            minTickGap={unit === "day" ? 24 : 8}
            tickFormatter={tick}
          />
          <YAxis
            width={axisWidth(rows)}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tickCount={3}
          />
          <ChartTooltip
            cursor={{ fill: "var(--interactive-hover)" }}
            content={<ChartTooltipContent labelFormatter={label} />}
          />
          <Bar dataKey="succeeded" stackId="uses" fill="var(--color-succeeded)" {...SEGMENT_GAP} />
          <Bar
            dataKey="failed"
            stackId="uses"
            fill="var(--color-failed)"
            radius={[2, 2, 0, 0]}
            {...SEGMENT_GAP}
          />
        </BarChart>
      </ChartContainer>
      <UsesLegend />
    </ChartCard>
  );
}
