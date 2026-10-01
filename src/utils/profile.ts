export function isFrozen(item: any): boolean {
  return (item.driftBelowCount || 0) >= 2;
}

export function sortProfileItems(items: any[], metric: "confidence" | "frequency"): any[] {
  return [...items].sort((a, b) => {
    const aFrozen = isFrozen(a) ? 1 : 0;
    const bFrozen = isFrozen(b) ? 1 : 0;
    if (aFrozen !== bFrozen) return aFrozen - bFrozen;
    if (metric === "confidence") {
      return (b.confidence || 0) - (a.confidence || 0) || (b.frequency || 1) - (a.frequency || 1);
    }
    return (b.frequency || 0) - (a.frequency || 0);
  });
}

const PROFILE_FIELDS = ["preferences", "patterns", "workflows"] as const;

/** A copy of profile data without the per-item embedding vectors the browser never uses. */
export function stripProfileVectors<T extends Record<string, any>>(data: T): T {
  const copy: Record<string, any> = { ...data };
  for (const field of PROFILE_FIELDS) {
    if (!Array.isArray(copy[field])) continue;
    copy[field] = copy[field].map((item: any) => {
      if (!item || typeof item !== "object") return item;
      const { centroid: _centroid, anchor: _anchor, ...rest } = item;
      return rest;
    });
  }
  return copy as T;
}
