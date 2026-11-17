/**
 * Plain sentences for the codes a reranker test can return. The sentences are English and are
 * translated by the catalogue text table, so callers pass `message` through their translator.
 */
const MESSAGES: Record<string, string> = {
  reranker_unreachable:
    "OMMS could not reach the reranker server. Check the URL, and check that the server is running.",
  reranker_timeout:
    "The reranker server did not answer in time. Try a longer wait time, or a faster server.",
  reranker_http_error:
    "The reranker server answered with an error. Check the model name and the key.",
  reranker_invalid_reply:
    "The reranker server sent a reply that OMMS could not read. Check that the URL points to a reranker.",
  reranker_wrong_order:
    "The reranker answered, but it ranked the sample text in the wrong order. Check the model name.",
  reranker_not_configured:
    "The reranker is on, but its URL or model is missing. Add both, or turn it off.",
};

const GENERAL = "The reranker test failed.";

/** The sentence for a code. An unknown code gets a general sentence and comes back as `code`. */
export function rerankerMessage(code: string | undefined): { message: string; code?: string } {
  const message = code ? MESSAGES[code] : undefined;
  if (message) return { message };
  return code ? { message: GENERAL, code } : { message: GENERAL };
}

/** Every sentence this module can return, so the text table can be checked against it. */
export const RERANKER_SENTENCES: readonly string[] = [...Object.values(MESSAGES), GENERAL];
