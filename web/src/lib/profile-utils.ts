import { jsonrepair } from "jsonrepair";
import type { ProfileItem } from "./types";

export function parseProfileField(field: unknown): ProfileItem[] {
  if (!field) return [];
  let result: unknown = field;
  let lastResult: unknown = null;
  while (typeof result === "string" && result !== lastResult) {
    lastResult = result;
    try {
      result = JSON.parse(jsonrepair(result));
    } catch {
      break;
    }
  }
  if (!Array.isArray(result)) return [];
  const flattened: ProfileItem[] = [];
  const walk = (item: unknown) => {
    if (Array.isArray(item)) item.forEach(walk);
    else if (item && typeof item === "object") flattened.push(item as ProfileItem);
  };
  walk(result);
  return flattened;
}

export function findDescById(
  id: string,
  profileData?: { preferences?: ProfileItem[]; patterns?: ProfileItem[]; workflows?: ProfileItem[] }
): string | null {
  if (!profileData || !id.includes("_")) return null;
  const [prefix, idxStr] = id.split("_");
  const idx = parseInt(idxStr, 10);
  if (Number.isNaN(idx)) return null;
  if (prefix === "pref") return profileData.preferences?.[idx]?.description ?? null;
  if (prefix === "pat") return profileData.patterns?.[idx]?.description ?? null;
  if (prefix === "wf") return profileData.workflows?.[idx]?.description ?? null;
  return null;
}

export function findStepsById(
  id: string,
  profileData?: { preferences?: ProfileItem[]; patterns?: ProfileItem[]; workflows?: ProfileItem[] }
): string[] | null {
  if (!profileData || !id.includes("_")) return null;
  const [prefix, idxStr] = id.split("_");
  const idx = parseInt(idxStr, 10);
  if (Number.isNaN(idx) || prefix !== "wf") return null;
  return profileData.workflows?.[idx]?.steps || null;
}

export type ConfidenceLevel = "high" | "medium" | "low" | "poor";

/** Confidence bands for the profile badge: 80% and up, 60–79%, 40–59%, below 40%. */
export function confidenceLevel(percent: number): ConfidenceLevel {
  if (percent >= 80) return "high";
  if (percent >= 60) return "medium";
  if (percent >= 40) return "low";
  return "poor";
}

/** Badge colours per band, readable in light and dark themes. */
export const CONFIDENCE_CLASSES: Record<ConfidenceLevel, string> = {
  high: "border-green-600/40 bg-green-500/15 text-green-700 dark:text-green-400",
  medium: "border-blue-600/40 bg-blue-500/15 text-blue-700 dark:text-blue-400",
  low: "border-orange-600/40 bg-orange-500/15 text-orange-700 dark:text-orange-400",
  poor: "border-red-600/40 bg-red-500/15 text-red-700 dark:text-red-400",
};
