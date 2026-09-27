import { CONFIG } from "../../config.js";
import { buildBoundedSummaryPrompt } from "../../core/capture-context.js";
import {
  buildCaptureReplyInstruction,
  buildCaptureSystemPrompt,
  captureSummaryToolSchema,
  classifyCaptureReply,
  normalizeStopReason,
  parseCaptureSummary,
} from "../../core/extraction.js";
import type { CaptureSummary, CaptureSummaryRequest } from "../../core/host.js";
import { detectLanguage, getLanguageName } from "../../services/language-detector.js";

/**
 * Structural view of a Pi ExtensionContext's model surfaces, so the resolver
 * stays testable without importing Pi runtime types.
 */
export interface PiModelContext {
  modelRegistry: any;
  model: any;
}

/**
 * Active-model-first resolution: the explicit `piProvider`/`piModel`
 * configuration when both are set, otherwise the active `ctx.model`.
 * A supplied import override resolves strictly through Pi's model registry.
 */
export function resolveModelFromContext(
  ctx: PiModelContext,
  override?: string
): PiModelHandle | null {
  const registry = ctx?.modelRegistry;
  if (!registry) return null;

  let model: any = null;
  if (override !== undefined) {
    const separator = override.indexOf("/");
    if (separator < 1 || separator === override.length - 1) return null;
    model = registry.find(override.slice(0, separator), override.slice(separator + 1)) ?? null;
    if (!model) return null;
  } else {
    if (CONFIG.piProvider && CONFIG.piModel) {
      model = registry.find(CONFIG.piProvider, CONFIG.piModel) ?? null;
    }
    if (!model) model = ctx?.model ?? null;
  }
  return toModelHandle(registry, model);
}

/**
 * History-import resolution: an explicit `provider/id` through Pi's model
 * registry, otherwise the session's current model. `piProvider`/`piModel`
 * steer live capture only; an import follows the session the user is in.
 */
export function resolveImportModel(ctx: PiModelContext, override?: string): PiModelHandle | null {
  if (override !== undefined) return resolveModelFromContext(ctx, override);
  const registry = ctx?.modelRegistry;
  return registry ? toModelHandle(registry, ctx.model) : null;
}

function toModelHandle(registry: any, model: any): PiModelHandle | null {
  if (!model) return null;

  return {
    provider: typeof model.provider === "string" ? model.provider : "unknown",
    modelId:
      typeof model.id === "string"
        ? model.id
        : typeof model.modelId === "string"
          ? model.modelId
          : "unknown",
    complete: (context: Parameters<typeof registry.complete>[1]) =>
      registry.complete(model, context),
  };
}

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
        throw new Error("omms: no Pi model available for auto-capture");
      }

      const targetLang =
        CONFIG.autoCaptureLanguage === "auto" || !CONFIG.autoCaptureLanguage
          ? detectLanguage(request.userPrompt)
          : CONFIG.autoCaptureLanguage;
      const systemPrompt = buildCaptureSystemPrompt(getLanguageName(targetLang));
      const replyInstruction = buildCaptureReplyInstruction();
      // The instruction is counted as schema bytes so the context budget leaves room for it.
      const userPrompt = `${buildBoundedSummaryPrompt(request.context, systemPrompt, {
        schema: captureSummaryToolSchema,
        replyInstruction,
      })}\n\n${replyInstruction}`;

      const diagnostics = request.diagnostics;
      if (diagnostics) {
        diagnostics.path = "host-model";
        diagnostics.provider = model.provider;
        diagnostics.model = model.modelId;
        diagnostics.systemPrompt = systemPrompt;
        diagnostics.userPrompt = userPrompt;
      }

      let reply: PiAssistantReply;
      try {
        reply = await model.complete({
          systemPrompt,
          messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
        });
      } catch (error) {
        if (diagnostics) diagnostics.failureReason = "call-error";
        throw error;
      }

      const rawReply = replyText(reply);
      if (diagnostics) {
        diagnostics.stopReason = normalizeStopReason(reply.stopReason);
        diagnostics.blockTypes = reply.content.map((block) => block.type);
        diagnostics.rawReply = rawReply;
      }

      if (reply.stopReason === "error") {
        if (diagnostics) diagnostics.failureReason = "call-error";
        throw new Error(
          `omms: Pi extraction call failed: ${reply.errorMessage || "unknown error"}`
        );
      }

      const summary = parseCaptureSummary(rawReply);
      if (!summary) {
        // The capture pipeline logs the attempt's metadata; never the reply.
        if (diagnostics) {
          diagnostics.failureReason =
            classifyCaptureReply({ text: rawReply, stopReason: reply.stopReason }) ??
            "schema-mismatch";
        }
        throw new Error("omms: Pi extraction returned an invalid summary payload");
      }
      return summary;
    },
  };
}
