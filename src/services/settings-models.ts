import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";

export async function listOpencodeSettingsModels(client?: Pick<OpencodeClient, "provider">) {
  try {
    const active = client ?? (await import("./ai/opencode-provider.js")).getV2Client();
    if (!active) return { available: false as const, reason: "OpenCode model list unavailable" };
    const result = await active.provider.list();
    if (!result.data)
      return { available: false as const, reason: "OpenCode model list unavailable" };
    const connected = new Set(result.data.connected);
    const models = result.data.all
      .filter((provider) => connected.has(provider.id))
      .flatMap((provider) =>
        Object.entries(provider.models).map(([model, info]) => ({
          provider: provider.id,
          model,
          name: info.name,
        }))
      );
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
