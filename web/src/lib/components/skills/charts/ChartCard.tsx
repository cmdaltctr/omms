import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";

export type ChartTable = {
  columns: string[];
  rows: (string | number)[][];
};

/**
 * One compact chart. The visible summary line and a table for screen
 * readers carry the same numbers as the bars, so colour and shape are never
 * the only way to read them. An empty chart shows `emptyText` instead.
 * A chart with its own buttons sets `interactive` and hides its drawing
 * itself, so no button sits inside an `aria-hidden` box.
 */
export function ChartCard({
  title,
  summary,
  emptyText,
  table,
  children,
  className,
  interactive = false,
}: {
  title: string;
  /** One line with the headline numbers. Leave it out when the chart is empty. */
  summary?: string;
  /** Set when there is no data yet; replaces the chart. */
  emptyText?: string;
  table: ChartTable;
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {summary && !emptyText ? <CardDescription>{summary}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {emptyText ? (
          <p className="flex min-h-40 items-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <>
            {interactive ? children : <div aria-hidden="true">{children}</div>}
            <table className="sr-only">
              <caption>{title}</caption>
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, column) => (
                      <td key={column}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
