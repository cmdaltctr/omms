import type { z } from "zod";
import type { ModelPort } from "../../core/profile-analysis.js";
import { extractJsonObject } from "../../core/extraction.js";

type ResolveProfileModel = () => Promise<ModelPort | null>;

/**
 * The host model for profile dedup, conflict, description, and cleanup calls in
 * this process. A host registers it at start-up; with none, or when it resolves
 * to null, those calls use the external API.
 */
let hostProfileModel: ResolveProfileModel | null = null;

export function registerHostProfileModel(resolve: ResolveProfileModel | null): void {
  hostProfileModel = resolve;
}

export async function resolveHostProfileModel(): Promise<ModelPort | null> {
  return hostProfileModel ? hostProfileModel() : null;
}

export async function completeStructured<T>(
  model: ModelPort,
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodType<T>
): Promise<T> {
  if (model.completeStructured) {
    return model.completeStructured(systemPrompt, userPrompt, schema);
  }
  return schema.parse(extractJsonObject(await model.complete(systemPrompt, userPrompt)));
}
