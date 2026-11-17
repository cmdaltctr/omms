/** The display name of each memory provider id. Product names are not translated. */
const PROVIDER_NAMES: Record<string, string> = {
  "openai-chat": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
  anthropic: "Anthropic",
  minimax: "MiniMax",
  orcarouter: "OrcaRouter",
  "google-gemini": "Google Gemini",
};

/** The name to show for a provider id. An id this list does not know shows as it is. */
export function providerName(id: string): string {
  return PROVIDER_NAMES[id] ?? id;
}
