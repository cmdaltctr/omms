import { CONFIG } from "../../config.js";
import { buildBoundedSummaryPrompt } from "../../core/capture-context.js";
import type { CaptureSummaryProvider } from "../../core/host.js";
import type { ModelPort } from "../../core/profile-analysis.js";
import { loadOpencodeProvider } from "./opencode-provider-loader.js";

export interface OpencodeModelRef {
  providerID: string;
  modelID: string;
}

/** Capture and profile calls routed through OpenCode's sessionless generation. */
export async function createOpencodeImportModels(
  ref: OpencodeModelRef
): Promise<{ capture: CaptureSummaryProvider; profile: ModelPort }> {
  const { getOpencodeHost, generateStructuredOutput } = await loadOpencodeProvider();
  const host = getOpencodeHost();
  if (!host) throw new Error("the OpenCode plugin context is not ready; retry in a moment");
  const { z } = await import("zod");
  const { buildCaptureSystemPrompt, createUserProfileAnalysisSchema, parseCaptureSummary } =
    await import("../../core/extraction.js");
  const { detectLanguage, getLanguageName } = await import("../../services/language-detector.js");

  const captureSchema = z.object({
    summary: z.string().optional(),
    type: z.string(),
    tags: z.array(z.string()).optional(),
  });
  const capture: CaptureSummaryProvider = {
    async summarize(request) {
      const target =
        CONFIG.autoCaptureLanguage && CONFIG.autoCaptureLanguage !== "auto"
          ? CONFIG.autoCaptureLanguage
          : detectLanguage(request.userPrompt);
      const systemPrompt = buildCaptureSystemPrompt(getLanguageName(target));
      const result = await generateStructuredOutput({
        host,
        ...ref,
        systemPrompt,
        userPrompt: buildBoundedSummaryPrompt(
          request.context,
          systemPrompt,
          z.toJSONSchema(captureSchema)
        ),
        schema: captureSchema,
      });
      const parsed = parseCaptureSummary(JSON.stringify(result));
      if (!parsed) throw new Error("History capture returned an invalid summary");
      return parsed;
    },
  };
  const profileSchema = createUserProfileAnalysisSchema(z);
  const profile: ModelPort = {
    provider: ref.providerID,
    modelId: ref.modelID,
    async complete(systemPrompt, userPrompt) {
      const result = await generateStructuredOutput({
        host,
        ...ref,
        systemPrompt,
        userPrompt,
        schema: profileSchema,
      });
      return JSON.stringify(result);
    },
  };
  return { capture, profile };
}
