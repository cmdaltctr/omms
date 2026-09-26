import { randomUUID } from "node:crypto";
import { CONFIG } from "../../config.js";
import { buildBoundedSummaryPrompt } from "../../core/capture-context.js";
import { parseCaptureSummary } from "../../core/extraction.js";
import type {
  AutoCaptureNotification,
  CaptureSummary,
  CaptureSummaryRequest,
} from "../../core/host.js";
import { log } from "../../services/logger.js";
import { loadOpencodeProvider } from "../../services/ai/opencode-provider-loader.js";

type Notify = (notification: AutoCaptureNotification) => Promise<void> | void;

function buildSystemPrompt(languageName: string): string {
  return `You are a technical memory recorder for a software development project.

RULES:
1. ONLY capture technical work (code, bugs, features, architecture, config)
2. SKIP non-technical by returning type="skip"
3. NO meta-commentary or behavior analysis
4. Include specific file names, functions, technical details
5. Generate 2-4 technical tags (e.g., "react", "auth", "bug-fix")
6. You MUST write the summary in ${languageName}.

FORMAT:
## Request
[1-2 sentences: what was requested, in ${languageName}]

## Outcome
[1-2 sentences: what was done, include files/functions, in ${languageName}]

SKIP if: greetings, casual chat, no code/decisions made
CAPTURE if: code changed, bug fixed, feature added, decision made`;
}

export async function generateOpenCodeAutoCaptureSummary(
  request: CaptureSummaryRequest,
  notify?: Notify
): Promise<CaptureSummary | null> {
  let opencodeProviderError: unknown;

  if (CONFIG.opencodeProvider && CONFIG.opencodeModel) {
    try {
      if (CONFIG.memoryModel) {
        log("opencodeProvider takes precedence over memoryModel for auto-capture");
      }

      const { isProviderConnected, getV2Client, generateStructuredOutput } =
        await loadOpencodeProvider();

      let providerID = CONFIG.opencodeProvider;
      let modelID = CONFIG.opencodeModel;
      if (modelID === "inherit") {
        if (!request.prompt?.providerId || !request.prompt?.modelId) {
          throw new Error(
            "omms: opencodeModel is 'inherit' but no session model was recorded for this prompt"
          );
        }
        providerID = request.prompt.providerId;
        modelID = request.prompt.modelId;
      }

      if (!isProviderConnected(providerID)) {
        throw new Error(
          `opencode provider '${providerID}' is not connected. Check your opencode provider configuration.`
        );
      }

      const v2Client = getV2Client();
      if (!v2Client) {
        throw new Error(
          "omms: v2 client not initialized; cannot perform structured-output capture"
        );
      }

      const { detectLanguage, getLanguageName } =
        await import("../../services/language-detector.js");
      const targetLang =
        CONFIG.autoCaptureLanguage === "auto" || !CONFIG.autoCaptureLanguage
          ? detectLanguage(request.userPrompt)
          : CONFIG.autoCaptureLanguage;
      const systemPrompt = buildSystemPrompt(getLanguageName(targetLang));

      const { z } = await import("zod");
      const schema = z.object({
        summary: z.string(),
        type: z.string(),
        tags: z.array(z.string()),
      });
      const aiPrompt = buildBoundedSummaryPrompt(
        request.context,
        systemPrompt,
        z.toJSONSchema(schema)
      );

      const result = await generateStructuredOutput({
        client: v2Client,
        providerID,
        modelID,
        systemPrompt,
        userPrompt: aiPrompt,
        schema,
      });

      return {
        summary: result.summary,
        type: result.type,
        tags: (result.tags || []).map((tag: string) => tag.toLowerCase().trim()),
      };
    } catch (error) {
      opencodeProviderError = error;
      log("auto-capture: opencode provider failed, falling back to external API", {
        error: String(error),
      });
    }
  }

  if (!CONFIG.memoryModel || !CONFIG.memoryApiUrl) {
    if (opencodeProviderError) throw opencodeProviderError;
    throw new Error("External API not configured for auto-capture");
  }

  if (opencodeProviderError && CONFIG.showErrorToasts && notify) {
    const errMsg =
      opencodeProviderError instanceof Error
        ? opencodeProviderError.message
        : String(opencodeProviderError);
    const shortReason = errMsg.length > 100 ? errMsg.substring(0, 100) + "..." : errMsg;
    await Promise.resolve(
      notify({
        title: "Using fallback provider",
        message: `OpenCode provider failed (${shortReason}); using configured fallback.`,
        variant: "warning",
        duration: 5000,
      })
    ).catch(() => {});
  }

  const { AIProviderFactory } = await import("../../services/ai/ai-provider-factory.js");
  const { buildMemoryProviderConfig } = await import("../../services/ai/provider-config.js");
  const { detectLanguage, getLanguageName } = await import("../../services/language-detector.js");

  const providerConfig = buildMemoryProviderConfig(CONFIG);
  const provider = AIProviderFactory.createProvider(CONFIG.memoryProvider, providerConfig);
  const targetLang =
    CONFIG.autoCaptureLanguage === "auto" || !CONFIG.autoCaptureLanguage
      ? detectLanguage(request.userPrompt)
      : CONFIG.autoCaptureLanguage;
  const systemPrompt = buildSystemPrompt(getLanguageName(targetLang));

  const toolSchema = {
    type: "function" as const,
    function: {
      name: "save_memory",
      description: "Save the conversation summary as a memory",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Markdown-formatted summary of the conversation",
          },
          type: {
            type: "string",
            description:
              "Type of memory: 'skip' for non-technical conversations, or technical type (feature, bug-fix, refactor, analysis, configuration, discussion, other)",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "List of 2-4 technical tags related to the memory",
          },
        },
        required: ["summary", "type", "tags"],
      },
    },
  };

  const aiPrompt = buildBoundedSummaryPrompt(request.context, systemPrompt, toolSchema);
  const captureSessionID = `auto-capture-${request.prompt?.id ?? request.sessionId}-${randomUUID()}`;

  const result = await provider.executeToolCall(
    systemPrompt,
    aiPrompt,
    toolSchema,
    captureSessionID
  );

  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to generate summary");
  }

  const rawReply = JSON.stringify(result.data);
  const summary = parseCaptureSummary(rawReply);
  if (!summary) {
    log("OpenCode capture: model reply was not a valid capture summary", {
      provider: CONFIG.memoryProvider,
      modelId: CONFIG.memoryModel,
      // The reply can carry conversation content, so log only its size.
      replyLength: rawReply.length,
    });
    throw new Error("omms: OpenCode extraction returned an invalid summary payload");
  }
  return summary;
}
