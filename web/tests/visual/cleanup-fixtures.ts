/** Synthetic category cleanup job for the preview server. No request reaches a real job or model. */
type Reply = { status: number; body: unknown };

export type CleanupFixtureState = "none" | "grouping" | "checking" | "running" | "done" | "failed";

const STATES: readonly string[] = ["none", "grouping", "checking", "running", "done", "failed"];
const TOTAL = 6;
const preview = {
  before: 1257,
  after: 1189,
  // Every fifth group is one the model did not check, so the review starts them cleared.
  groups: Array.from({ length: 62 }, (_, index) => ({
    id: `group-${index}`,
    name: `Topic ${index + 1}`,
    checked: index % 5 !== 0,
    labels: [
      { label: `Topic ${index + 1}`, count: 4 },
      { label: `Topic ${index + 1} variant`, count: 2 },
    ],
  })),
};
let state: CleanupFixtureState = "none";
let done = 0;

function job() {
  const status = (() => {
    switch (state) {
      case "grouping":
        return { state: "grouping" };
      case "checking":
        return { state: "checking", done: 3, total: TOTAL };
      case "running":
        // Each request advances one batch, so the banner can be watched updating, then stopping.
        done = Math.min(done + 1, TOTAL);
        return done >= TOTAL
          ? { state: "done", preview }
          : { state: "checking", done, total: TOTAL };
      case "done":
        return { state: "done", preview };
      case "failed":
        return { state: "failed", error: "The profile model timed out after 180 seconds." };
      default:
        return null;
    }
  })();
  return status ? { id: "synthetic", startedAt: 0, status } : null;
}

/** GET returns the chosen job state. POST /api/__fixture/category-cleanup {state} chooses it. */
export function cleanupResponse(method: string, path: string, body?: unknown): Reply | null {
  if (method === "POST" && path === "/api/__fixture/category-cleanup") {
    const next = (body as { state?: string })?.state;
    if (typeof next !== "string" || !STATES.includes(next))
      return { status: 400, body: { success: false, error: "Unknown synthetic cleanup state" } };
    state = next as CleanupFixtureState;
    done = 0;
    return { status: 200, body: { success: true, data: { state } } };
  }
  if (path === "/api/user-profile/category-cleanup") {
    if (method !== "GET")
      return { status: 405, body: { success: false, error: "Mutation disabled in the preview" } };
    return { status: 200, body: { success: true, data: job() } };
  }
  return null;
}
