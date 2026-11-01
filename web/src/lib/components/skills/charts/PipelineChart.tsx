import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "$lib/components/ui/chart";
import { useSettingsText } from "$lib/i18n/settings";
import { pipelineCounts } from "$lib/skill-activity";
import type { ProposalSummary } from "$lib/skills-api";
import { fill } from "$lib/skills-model";
import { ChartCard } from "./ChartCard";

/** One theme colour per state, so a state keeps its colour in every theme. */
export const STATE_COLOUR: Record<string, string> = {
  pending: "var(--status-info)",
  applied: "var(--status-success)",
  rejected: "var(--destructive)",
  stale: "var(--status-warning)",
  undone: "var(--muted-foreground)",
};

/**
 * Proposals per state, counted from the proposals the page already loaded.
 * Each state has its own colour. The name on the axis and the count on each
 * bar carry the meaning too.
 */
export function PipelineChart({ proposals }: { proposals: readonly ProposalSummary[] }) {
  const s = useSettingsText();
  const data = pipelineCounts(proposals).map((row) => ({ ...row, label: s(row.state) }));
  const config: ChartConfig = { count: { label: s("Proposals"), color: "var(--chart-1)" } };
  const pending = data[0]?.count ?? 0;
  return (
    <ChartCard
      title={s("Proposal pipeline")}
      summary={fill(s("{total} proposals, {pending} waiting for a decision"), {
        total: proposals.length,
        pending,
      })}
      emptyText={proposals.length === 0 ? s("No proposals yet.") : ""}
      table={{
        columns: [s("State"), s("Proposals")],
        rows: data.map((row) => [row.label, row.count]),
      }}
    >
      <ChartContainer config={config} className="aspect-auto h-44 w-full">
        <BarChart
          data={data}
          layout="vertical"
          accessibilityLayer={false}
          margin={{ top: 0, right: 28, left: 0, bottom: 0 }}
        >
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={104} tickLine={false} axisLine={false} />
          <ChartTooltip
            cursor={{ fill: "var(--interactive-hover)" }}
            content={<ChartTooltipContent hideLabel nameKey="count" />}
          />
          <Bar dataKey="count" fill="var(--color-count)" radius={[0, 2, 2, 0]}>
            {data.map((row) => (
              <Cell key={row.state} fill={STATE_COLOUR[row.state] ?? "var(--color-count)"} />
            ))}
            <LabelList dataKey="count" position="right" className="fill-foreground" />
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartCard>
  );
}
