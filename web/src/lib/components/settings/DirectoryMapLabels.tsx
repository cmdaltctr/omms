import type { IgnoreReason, MapConfidence } from "$lib/directory-maps";

type Text = (message: string) => string;

/** The visible label for a map suggestion's confidence. */
export function confidenceLabel(s: Text, confidence: MapConfidence): string {
  if (confidence === "exact") return s("Exact");
  if (confidence === "name") return s("Name match");
  return s("Guess");
}

/** Why a directory is proposed for Ignore. */
export function ignoreReasonLabel(s: Text, reason: IgnoreReason): string {
  if (reason === "temporary") return s("Temporary folder");
  if (reason === "node_modules") return s("node_modules folder");
  if (reason === "app-data") return s("App data folder");
  return s("Skills folder");
}
