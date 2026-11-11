import { CONFIG } from "../../config.js";
import { resolveOpencodeHostModel } from "../../services/ai/live-model-choice.js";
import type { OpencodeHost } from "./opencode-host.js";
import { loadOpencodeProvider } from "./opencode-provider-loader.js";

/** The OpenCode plugin context for profile calls, once the host model's provider is signed in. */
export async function getOpencodeProfileHost(): Promise<OpencodeHost> {
  const hostModel = resolveOpencodeHostModel(CONFIG);
  if (!hostModel) {
    throw new Error("omms: live calls use the external API; no OpenCode model is configured");
  }

  const { isProviderConnected, getOpencodeHost, resolveOpencodeModelRef } =
    await loadOpencodeProvider();
  // "inherit" checks the provider of the model it resolves to.
  const { providerID: provider } = resolveOpencodeModelRef(hostModel);
  if (!isProviderConnected(provider)) {
    throw new Error(
      `opencode provider '${provider}' is not connected. Check your opencode provider configuration.`
    );
  }

  const host = getOpencodeHost();
  if (!host) throw new Error("omms: the OpenCode plugin context is not ready");
  return host;
}
