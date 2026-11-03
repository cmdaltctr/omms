import { formatContextForPrompt } from "../services/context.js";
import { getTags } from "../services/tags.js";
import { utf8ByteLength } from "../utils/context-limit.js";
import { resolveCeiling, type ContextBudgetOptions } from "./context-budget.js";
import {
  retrievalWrapperBytes,
  searchablePrompt,
  searchSectionMemories,
  wrapRetrievalSection,
} from "./retrieval.js";

/**
 * The opening context (design D1c of change align-recall-host-parity): on the
 * first prompt of a main session, one extra search with the configured query,
 * added as a second retrieval section after the prompt's own. Shared by
 * OpenCode V2, Pi and Claude Code. Hosts read `CONFIG` and pass the values in;
 * this module does not import it, because many tests stub `src/config.js`.
 */

/**
 * The opening search query, or null when the option is off or the query is
 * empty. Pass `CONFIG.openingContext` and `CONFIG.openingContextQuery`.
 */
export function openingQueryFor(options: {
  openingContext: boolean;
  openingContextQuery: string;
}): string | null {
  if (!options.openingContext) return null;
  return options.openingContextQuery.trim() || null;
}

export interface FirstPromptSectionsInput {
  prompt: string;
  /** From `openingQueryFor`. Null runs no opening search. */
  openingQuery: string | null;
  directory: string;
  sessionId: string;
  /**
   * The request budget, as `buildRetrievalSection` takes it. `wrapperBytes` is
   * what the host adds around each section, the retrieval tag included; it
   * defaults to the tag alone.
   */
  budget: ContextBudgetOptions;
  /** Bytes the host adds to the opening section only, such as Claude Code's opening marker. */
  openingReserveBytes: number;
}

/**
 * The sections for the first prompt of a main session, each wrapped in the
 * retrieval tag. The prompt section is `wrapRetrievalSection` of what
 * `buildRetrievalSection` returns for the same budget, when the budget names
 * its `wrapperBytes` as every host passes it. Both searches run in parallel with the same rules
 * (`searchSectionMemories`). The opening section leaves out memories the
 * prompt search found, carries no user profile (the prompt section holds it),
 * and is packed with what the prompt section leaves of the budget, minus
 * `openingReserveBytes`. Either section is null when nothing fits or matches.
 */
export async function buildFirstPromptSections(
  input: FirstPromptSectionsInput
): Promise<{ promptSection: string | null; openingSection: string | null }> {
  // A fully private prompt gets no section at all, the opening section included.
  const promptQuery = searchablePrompt(input.prompt);
  if (!promptQuery) return { promptSection: null, openingSection: null };

  const tags = getTags(input.directory);
  const [promptSearch, openingSearch] = await Promise.all([
    searchSectionMemories(promptQuery, tags.project.tag, input.sessionId),
    input.openingQuery
      ? searchSectionMemories(input.openingQuery, tags.project.tag, input.sessionId)
      : null,
  ]);

  const wrapperBytes = input.budget.wrapperBytes ?? retrievalWrapperBytes();
  const promptResults = promptSearch?.results ?? [];
  const promptText =
    promptResults.length > 0
      ? await formatContextForPrompt(
          tags.user.userEmail || null,
          { results: promptResults },
          { ...input.budget, wrapperBytes },
          promptSearch?.queryVector
        )
      : "";

  const promptIds = new Set(promptResults.map((result) => result.id));
  const openingResults = (openingSearch?.results ?? []).filter(
    (result) => !promptIds.has(result.id)
  );
  const promptBytes = promptText ? utf8ByteLength(promptText) + wrapperBytes : 0;
  const remaining = resolveCeiling(input.budget) - promptBytes - input.openingReserveBytes;
  const openingText =
    openingResults.length > 0 && remaining > 0
      ? await formatContextForPrompt(
          null,
          { results: openingResults },
          { maxBytes: remaining, wrapperBytes }
        )
      : "";

  return {
    promptSection: promptText ? wrapRetrievalSection(promptText) : null,
    openingSection: openingText ? wrapRetrievalSection(openingText) : null,
  };
}
