import { CONFIG } from "../../config.js";
import { buildBoundedSummaryPrompt } from "../../core/capture-context.js";
import {
  buildCaptureSystemPrompt,
  captureSummaryToolSchema,
  parseCaptureSummary,
} from "../../core/extraction.js";
import type { CaptureSummary, CaptureSummaryRequest } from "../../core/host.js";
import { detectLanguage, getLanguageName } from "../../services/language-detector.js";
import { log } from "../../services/logger.js";

/**
 * Structural view of the pieces we use from Pi's ModelRegistry/Model so the
 * bridge stays testable without importing Pi runtime types.
 */
export interface PiModelCallContext {
  systemPrompt?: string;
  messages: Array<{ role: "user"; content: string; timestamp: number }>;
}

export interface PiModelHandle {
  provider: string;
  modelId: string;
  complete(context: PiModelCallContext): Promise<PiAssistantReply>;
}

export interface PiAssistantReply {
  content: Array<{ type: string; text?: string }>;
  stopReason?: string;
  errorMessage?: string;
}

function replyText(reply: PiAssistantReply): string {
  return reply.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Bridge the shared structured-extraction port onto Pi's provider-aware model
 * runtime (`ctx.modelRegistry.complete()`). The Pi adapter resolves the model
 * (active `ctx.model`, or explicit `piProvider`/`piModel` configuration) and
 * supplies it through `resolveModel`; failures surface as exceptions so the
 * capture pipeline can defer or skip the work unit while manual memory
 * operations stay available.
 */
export function createPiCaptureProvider(resolveModel: () => PiModelHandle | null) {
  return {
    async summarize(request: CaptureSummaryRequest): Promise<CaptureSummary | null> {
      const model = resolveModel();
      if (!model) {
        throw new Error("opencode-mem: no Pi model available for auto-capture");
      }

      const targetLang =
        CONFIG.autoCaptureLanguage === "auto" || !CONFIG.autoCaptureLanguage
          ? detectLanguage(request.userPrompt)
          : CONFIG.autoCaptureLanguage;
      const systemPrompt = buildCaptureSystemPrompt(getLanguageName(targetLang));
      const userPrompt = buildBoundedSummaryPrompt(
        request.context,
        systemPrompt,
        captureSummaryToolSchema
      );

      const reply = await model.complete({
        systemPrompt,
        messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
      });

      if (reply.stopReason === "error") {
        throw new Error(
          `opencode-mem: Pi extraction call failed: ${reply.errorMessage || "unknown error"}`
        );
      }

      const summary = parseCaptureSummary(replyText(reply));
      if (!summary) {
        log("Pi capture: model reply was not a valid capture summary", {
          provider: model.provider,
          modelId: model.modelId,
        });
        throw new Error("opencode-mem: Pi extraction returned an invalid summary payload");
      }
      return summary;
    },
  };
}
