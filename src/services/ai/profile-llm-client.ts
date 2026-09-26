import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { CONFIG } from "../../config.js";
import { resolveOpencodeHostModel } from "./live-model-choice.js";
import { loadOpencodeProvider } from "./opencode-provider-loader.js";

let _cachedClient: OpencodeClient | null = null;
let _cachedProvider: string | null = null;
let _cachedModel: string | null = null;

export async function getOpenCodeClient(): Promise<OpencodeClient> {
  const hostModel = resolveOpencodeHostModel(CONFIG);
  if (!hostModel) {
    throw new Error("omms: live calls use the external API; no OpenCode model is configured");
  }

  const { isProviderConnected, getV2Client, resolveOpencodeModelRef } =
    await loadOpencodeProvider();
  // "inherit" checks the provider of the model it resolves to.
  const { providerID: provider, modelID: model } = resolveOpencodeModelRef(hostModel);

  if (_cachedClient && _cachedProvider === provider && _cachedModel === model) {
    return _cachedClient;
  }

  if (!isProviderConnected(provider)) {
    throw new Error(
      `opencode provider '${provider}' is not connected. Check your opencode provider configuration.`
    );
  }

  const client = getV2Client();
  if (!client) {
    throw new Error("omms: v2 client not initialized");
  }

  _cachedClient = client;
  _cachedProvider = provider;
  _cachedModel = model;
  return client;
}
