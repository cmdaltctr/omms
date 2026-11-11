import type { Context } from "@opencode/plugin/promise/plugin";

/** The parts of the OpenCode V2 plugin context that OMMS reads outside `setup`. */
export type OpencodeHost = Pick<Context, "session" | "generate" | "model">;

/** One OpenCode model, as the Settings page and backfill list it. */
export type OpencodeModelInfo = {
  readonly providerID: string;
  readonly id: string;
  readonly name: string;
};

let current: OpencodeHost | undefined;

/** Set once in the V2 plugin's `setup`; holds no store handle, so a space switch keeps it. */
export function setOpencodeHost(host: OpencodeHost | undefined): void {
  current = host;
}

export function getOpencodeHost(): OpencodeHost | undefined {
  return current;
}

let sessionModel: { providerID: string; modelID: string } | undefined;

/**
 * Remember the model of the latest model request this plugin saw. `inherit` falls back to it
 * when a call has no prompt model, because headless OpenCode writes no `model.json`.
 * Pass `undefined` to forget it.
 */
export function rememberOpencodeSessionModel(
  model: { readonly providerID: string; readonly id: string } | undefined
): void {
  sessionModel =
    model?.providerID && model.id ? { providerID: model.providerID, modelID: model.id } : undefined;
}

export function latestOpencodeSessionModel(): { providerID: string; modelID: string } | undefined {
  return sessionModel;
}

/** The models OpenCode lists, each with a display name. */
export async function listOpencodeModels(
  host: Pick<OpencodeHost, "model">
): Promise<OpencodeModelInfo[]> {
  const result = await host.model.list();
  return result.data.map((model) => ({
    providerID: model.providerID,
    id: model.id,
    name: model.name || model.id,
  }));
}
