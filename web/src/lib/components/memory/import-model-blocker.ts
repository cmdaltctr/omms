import { hostLabel, type WebHost } from "$lib/host-label";
import type { ImportDraft, Readiness } from "./import-types";

const EXTERNAL_REASONS: Record<string, string> = {
  "missing-model": "The external API has no memoryModel in the global config",
  "missing-url": "The external API has no memoryApiUrl in the global config",
  "missing-key":
    "The external API key is missing in the OpenCode process; check memoryApiKey and its env:// or file:// source",
  "unsupported-provider": "The memoryProvider in the global config is not supported for imports",
};

/**
 * The first reason a real import cannot start for lack of a model, as text, or
 * null. A run that records only skill turns calls no model, so it never blocks.
 */
export function modelBlockedReason(
  hosts: readonly WebHost[],
  draft: ImportDraft,
  readiness: Readiness | null,
  s: (message: string) => string
): string | null {
  if (!draft.memories && !draft.profile) return null;
  return (
    hosts
      .map((host) => {
        const model = draft.hosts[host].modelChoice;
        let reason: string | null = null;
        if (!readiness) reason = "Model readiness is unknown. Reload the page.";
        else if (!model)
          reason =
            "No import model is ready. Connect a model in OpenCode or complete the external API settings.";
        else if (model === "external" && readiness.external.state !== "ready")
          reason = EXTERNAL_REASONS[readiness.external.state] ?? "The external API is not ready";
        else if (host === "claude-code" && model !== "external")
          reason = "Claude Code imports use the external API. Complete the external API settings.";
        else if (
          model !== "external" &&
          !readiness.opencode.models.some((item) => `${item.provider}/${item.model}` === model)
        )
          reason =
            "No import model is ready. Connect a model in OpenCode or complete the external API settings.";
        return reason ? `${hostLabel(host)}: ${s(reason)}` : null;
      })
      .find(Boolean) ?? null
  );
}
