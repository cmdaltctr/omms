export type BackfillHost = "pi" | "opencode";
export type BackfillState = { state: string } | null;

export function shouldPollBackfill(rows: Record<BackfillHost, BackfillState>): boolean {
  return rows.pi?.state === "running" || rows.opencode?.state === "running";
}

export function manualModelFieldVisible(typedMode: boolean | undefined, known: boolean): boolean {
  return typedMode ?? !known;
}

export function backfillModelEdit(host: BackfillHost, value: string): Record<string, string> {
  const slash = value.indexOf("/");
  if (value !== "inherit" && (slash < 1 || slash === value.length - 1)) {
    throw new Error("Enter a model as provider/model.");
  }
  return { [`${host}BackfillModel`]: value };
}
