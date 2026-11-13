import { useEffect, useRef, useState } from "react";
import { settingsRequest } from "$lib/settings-api";

export type OpenRouterModel = { id: string; name: string };

type ModelsReply = { ok: boolean; models?: OpenRouterModel[]; error?: string };

/**
 * Load the OpenRouter model list once, the first time `enabled` is true. A failed read leaves
 * the list empty and is not retried, so the Model field stays a plain text field.
 */
export function useOpenRouterModels(enabled: boolean): OpenRouterModel[] {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const requested = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || requested.current) return;
    requested.current = true;
    settingsRequest<ModelsReply>("/api/settings/external-api/openrouter-models")
      .then((reply) => {
        if (mounted.current && reply.ok && Array.isArray(reply.models)) setModels(reply.models);
      })
      .catch(() => {});
  }, [enabled]);

  return models;
}
