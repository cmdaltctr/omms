import { keySourceBody, type KeySource } from "$lib/external-api-settings";
import { urlOnThisMachine } from "$lib/credential-states";

/** Local servers come first: they cost nothing per memory. */
export const EMBEDDING_PRESETS = [
  { id: "ollama", label: "Ollama", url: "http://localhost:11434/v1" },
  { id: "llamacpp", label: "llama.cpp", url: "http://localhost:8080/v1" },
  { id: "openrouter", label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { id: "openai", label: "OpenAI", url: "https://api.openai.com/v1" },
  { id: "custom", label: "Custom", url: "" },
] as const;

export type EmbeddingKeyChoice = "none" | "saved" | KeySource;

export type EmbeddingFields = {
  kind: "builtin" | "server";
  url: string;
  model: string;
  key: EmbeddingKeyChoice;
  keyInput: { name: string; path: string; value: string };
};

/** The URL a preset fills in; Custom keeps what the user typed. */
export function presetUrl(id: string, current: string): string {
  const preset = EMBEDDING_PRESETS.find((entry) => entry.id === id);
  return preset && preset.url ? preset.url : current;
}

/** The request body for a candidate embedder; a pasted key goes only into this body. */
export function candidateBody(fields: EmbeddingFields) {
  if (fields.kind === "builtin") return { kind: "builtin", model: fields.model.trim() };
  const key =
    fields.key === "none" || fields.key === "saved"
      ? { source: fields.key }
      : keySourceBody(fields.key, {
          ...fields.keyInput,
          name: fields.keyInput.name || "embedding-api",
        });
  return { kind: "server", url: fields.url.trim(), model: fields.model.trim(), key };
}

/** Identifies the values a test covered, so an edit after the test disables Apply. */
export function candidateKey(fields: EmbeddingFields): string {
  return JSON.stringify([
    fields.kind,
    fields.kind === "server" ? fields.url.trim() : "",
    fields.model.trim(),
    fields.kind === "server" ? fields.key : "none",
    fields.kind === "server" ? fields.keyInput : null,
  ]);
}

export function canApply(passedKey: string | undefined, fields: EmbeddingFields): boolean {
  return passedKey !== undefined && passedKey === candidateKey(fields);
}

/** The memory count and the risks the confirmation names; the caller translates each risk. */
export function confirmation(memoryCount: number, fields: EmbeddingFields) {
  const hosted = fields.kind === "server" && !urlOnThisMachine(fields.url);
  return {
    count: memoryCount.toLocaleString("en-US"),
    risks: [
      ...(hosted
        ? ["The hosted server is called once for each memory, which may cost money."]
        : []),
      "Search results are poor until the re-embed ends.",
      "Restart open OpenCode and Pi sessions after the change.",
    ],
  };
}

/** The built-in model the card offers when no built-in model is saved. */
export const DEFAULT_BUILTIN_MODEL = "Xenova/nomic-embed-text-v1";

/**
 * The field change for a new kind. A server model name means nothing to the
 * built-in runner, so switching to Built-in model sets a built-in model.
 */
export function kindChange(
  kind: EmbeddingFields["kind"],
  builtinModel: string = DEFAULT_BUILTIN_MODEL
): Partial<EmbeddingFields> {
  return kind === "builtin" ? { kind, model: builtinModel } : { kind };
}

/** The key choice to show on unlock: "No key" when a saved server has none. */
export function keyChoiceFor(kind: EmbeddingFields["kind"], keySet: boolean): EmbeddingKeyChoice {
  return kind === "server" && keySet ? "saved" : "none";
}
