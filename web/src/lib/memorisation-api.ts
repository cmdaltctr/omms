import { fetchAPI } from "$lib/api";
import type { BulkDeleteResult, Memorisation } from "./memorisation-model";

/** `a,b` for the `tags` parameter. Each label is encoded, so a space is `%20` and the comma stays. */
const tagList = (tags: readonly string[]) => tags.map(encodeURIComponent).join(",");

/** Calls for the Memorisation page. Delete is the ordinary memory delete: a memorisation is a memory row. */
export const memorisationApi = {
  /** With labels, only the records that carry all of them. */
  list: (tags: readonly string[] = []) =>
    fetchAPI<{ memorisations: Memorisation[] }>(
      tags.length > 0 ? `/api/memorisations?tags=${tagList(tags)}` : "/api/memorisations"
    ),
  /** `query` may be empty when `tags` is not. The server then returns the newest matches. */
  recall: (query: string, tags: readonly string[] = []) =>
    fetchAPI<{ count: number; matches: Memorisation[] }>(
      `/api/memorisations/recall?q=${encodeURIComponent(query)}${
        tags.length > 0 ? `&tags=${tagList(tags)}` : ""
      }`
    ),
  remove: (id: string) =>
    fetchAPI<{ deletedPrompt: boolean }>(`/api/memories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  /** One request for 1 to 500 IDs. The reply says which were deleted and which were skipped. */
  removeMany: (ids: readonly string[]) =>
    fetchAPI<BulkDeleteResult>("/api/memorisations/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
};
