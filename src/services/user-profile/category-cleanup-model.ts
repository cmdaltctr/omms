import { applySafeExtraParams } from "../ai/providers/base-provider.js";
import type { MemoryModelSettings } from "./memory-model-settings.js";
import { completeStructured, resolveHostProfileModel } from "./profile-model.js";

/**
 * Time limit per model call. A reasoning model took about 110 s per batch on the
 * live profile (TDR-044), so the 60 s profile cleanup limit timed out every batch.
 */
export const CATEGORY_CLEANUP_MODEL_TIMEOUT_MS = 180_000;

/** Rejects with the message when the work takes longer than the limit, and always clears its timer. */
export async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Sends one prompt and returns the parsed JSON reply; throws on any failure. */
export type CleanupModel = (systemPrompt: string, userPrompt: string) => Promise<unknown>;

/** The host model when one is registered, else the external API, else none. */
export async function resolveCleanupModel(
  settings: MemoryModelSettings
): Promise<CleanupModel | null> {
  const hostModel = await resolveHostProfileModel();
  if (hostModel) {
    const { z } = await import("zod");
    const schema = z.object({
      groups: z.array(z.object({ group: z.string(), keep: z.array(z.string()), name: z.string() })),
    });
    return (systemPrompt, userPrompt) =>
      withTimeout(
        completeStructured(hostModel, systemPrompt, userPrompt, schema),
        CATEGORY_CLEANUP_MODEL_TIMEOUT_MS,
        "category cleanup timeout"
      );
  }
  if (settings.memoryModel && settings.memoryApiUrl) {
    return async (systemPrompt, userPrompt) => {
      const requestBody: Record<string, unknown> = {};
      if (settings.memoryExtraParams) applySafeExtraParams(requestBody, settings.memoryExtraParams);
      Object.assign(requestBody, {
        model: settings.memoryModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      });
      const response = await fetch(`${settings.memoryApiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.memoryApiKey || ""}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(CATEGORY_CLEANUP_MODEL_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`API request failed: ${response.status}`);
      const data: any = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("No content in API response");
      return JSON.parse(content);
    };
  }
  return null;
}
