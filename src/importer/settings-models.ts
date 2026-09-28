import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { SettingsModel } from "./backfill-controls.js";

/** Connected models from an OpenCode client; null when the client returns no list. */
export async function listOpencodeClientModels(
  client: Pick<OpencodeClient, "provider">
): Promise<SettingsModel[] | null> {
  const result = await client.provider.list();
  if (!result.data) return null;
  const connected = new Set(result.data.connected);
  return result.data.all
    .filter((provider) => connected.has(provider.id))
    .flatMap((provider) =>
      Object.entries(provider.models).map(([model, info]) => ({
        provider: provider.id,
        model,
        name: info.name,
      }))
    );
}

export async function listOpencodeSettingsModels(client?: Pick<OpencodeClient, "provider">) {
  try {
    let models: SettingsModel[] | null;
    if (client) {
      models = await listOpencodeClientModels(client);
    } else {
      const { getOpencodeHostModels } = await import("./backfill-controls.js");
      const opencode = getOpencodeHostModels();
      models = opencode ? await opencode.listSettingsModels() : null;
    }
    if (!models) return { available: false as const, reason: "OpenCode model list unavailable" };
    return { available: true as const, models };
  } catch {
    return { available: false as const, reason: "OpenCode model list unavailable" };
  }
}

export async function listPiSettingsModels(
  loadSdk: () => Promise<typeof import("@earendil-works/pi-coding-agent")> = () =>
    import("@earendil-works/pi-coding-agent")
) {
  try {
    const { ModelRuntime } = await loadSdk();
    // Refresh local auth availability without fetching models or writing Pi credentials.
    const runtime = await ModelRuntime.create({ refreshOnCreate: true, allowModelNetwork: false });
    const models = runtime
      .getModels()
      .filter((model) => runtime.hasConfiguredAuth(model.provider))
      .map((model) => ({ provider: model.provider, model: model.id, name: model.name }));
    return models.length
      ? { available: true as const, models }
      : { available: false as const, models, reason: "No signed-in Pi models found" };
  } catch {
    return { available: false as const, reason: "Pi model list unavailable; enter provider/model" };
  }
}
