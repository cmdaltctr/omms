import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { SettingsModel } from "./backfill-controls.js";
import type { StandaloneResult } from "./opencode-standalone-models.js";

// Reasons the Settings page shows for a missing model list. The page translates
// each one, so a change here needs matching text in web/src/lib/i18n/settings.ts.
export const OPENCODE_LIST_UNAVAILABLE = "OpenCode model list unavailable";
export const OPENCODE_NOT_FOUND =
  "OMMS could not find OpenCode on this computer, so it cannot list OpenCode's models here. Type the model as provider/model, for example zai-coding-plan/glm-5.3. If OpenCode is installed, open an OpenCode session and reload this page.";
export const OPENCODE_TOO_SLOW =
  "OpenCode took too long to send its model list. Reload this page to try again, or type the model as provider/model.";
export const OPENCODE_NO_MODELS =
  "OpenCode has no signed-in models. Run `opencode auth login`, then reload this page.";
export const OPENCODE_UNREADABLE =
  "This OpenCode version sent a model list OMMS cannot read. Type the model as provider/model. Update OMMS if this continues.";
export const PI_LIST_UNAVAILABLE =
  "OMMS could not read Pi's model list. Type the model as provider/model.";
export const PI_NO_MODELS =
  "Pi has no signed-in models. Sign in to a provider in Pi, then reload this page.";

export const SETTINGS_MODEL_REASONS = [
  OPENCODE_LIST_UNAVAILABLE,
  OPENCODE_NOT_FOUND,
  OPENCODE_TOO_SLOW,
  OPENCODE_NO_MODELS,
  OPENCODE_UNREADABLE,
  PI_LIST_UNAVAILABLE,
  PI_NO_MODELS,
] as const;

const STANDALONE_REASONS: Record<Exclude<StandaloneResult["outcome"], "listed">, string> = {
  not_found: OPENCODE_NOT_FOUND,
  start_timeout: OPENCODE_TOO_SLOW,
  empty: OPENCODE_NO_MODELS,
  unreadable: OPENCODE_UNREADABLE,
};

type ProviderList = {
  connected: string[];
  all: Array<{ id: string; models: Record<string, { name: string }> }>;
};

/** The models of each connected provider in an OpenCode v1 provider list. */
export function connectedProviderModels(list: ProviderList): SettingsModel[] {
  const connected = new Set(list.connected);
  return list.all
    .filter((provider) => connected.has(provider.id))
    .flatMap((provider) =>
      Object.entries(provider.models).map(([model, info]) => ({
        provider: provider.id,
        model,
        name: info.name,
      }))
    );
}

/** Connected models from an OpenCode client; null when the client returns no list. */
export async function listOpencodeClientModels(
  client: Pick<OpencodeClient, "provider">
): Promise<SettingsModel[] | null> {
  const result = await client.provider.list();
  if (!result.data) return null;
  return connectedProviderModels(result.data);
}

async function readStandaloneModels(): Promise<StandaloneResult> {
  const { readStandaloneOpencodeModels } = await import("./opencode-standalone-models.js");
  return readStandaloneOpencodeModels();
}

/**
 * The OpenCode models for the Settings page. Without a client or a registered
 * OpenCode host, this starts a private OpenCode server through `readStandalone`.
 * Pass `null` to skip that, for callers that need a live session.
 */
export async function listOpencodeSettingsModels(
  client?: Pick<OpencodeClient, "provider">,
  readStandalone: (() => Promise<StandaloneResult>) | null = readStandaloneModels
): Promise<{ available: boolean; models?: SettingsModel[]; reason?: string }> {
  const unavailable = (reason: string) => ({ available: false, reason });
  try {
    let models: SettingsModel[] | null;
    if (client) {
      models = await listOpencodeClientModels(client);
    } else {
      const { getOpencodeHostModels } = await import("./backfill-controls.js");
      const opencode = getOpencodeHostModels();
      if (!opencode && readStandalone) {
        const result = await readStandalone();
        if (result.outcome !== "listed") return unavailable(STANDALONE_REASONS[result.outcome]);
        return { available: true, models: result.models };
      }
      models = opencode ? await opencode.listSettingsModels() : null;
    }
    if (!models) return unavailable(OPENCODE_LIST_UNAVAILABLE);
    return { available: true, models };
  } catch {
    return unavailable(OPENCODE_LIST_UNAVAILABLE);
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
      : { available: false as const, models, reason: PI_NO_MODELS };
  } catch {
    return { available: false as const, reason: PI_LIST_UNAVAILABLE };
  }
}
