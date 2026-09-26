import { CONFIG } from "../../config.js";
import { resolvePiLiveModel, isExternalModelReady } from "../../services/ai/live-model-choice.js";
import type { AutoCaptureNotification, CaptureSummaryProvider } from "../../core/host.js";
import type { ModelPort } from "../../core/profile-analysis.js";
import { log } from "../../services/logger.js";
import { adaptPiProfileModel } from "./profile.js";
import {
  createPiCaptureProvider,
  resolveImportModel,
  resolveModelFromContext,
  type PiModelContext,
  type PiModelHandle,
} from "./provider.js";

/**
 * Pi live capture and profile learning, by the same rule as OpenCode:
 * `piProvider`/`piModel` ("inherit" = this session's model), else the
 * external API (`memoryModel`/`memoryApiUrl`/`memoryApiKey`), else this
 * session's model. A failing Pi model falls back to the external API when it
 * is configured, as a failing OpenCode model does.
 */
export interface PiLiveModels {
  capture: CaptureSummaryProvider;
  profile: () => ModelPort | null;
}

type Notify = (notification: AutoCaptureNotification) => Promise<void> | void;

async function externalModels() {
  const { selectImportModel } = await import("../../importer/model-selection.js");
  return selectImportModel({});
}

function primaryPiModel(ctx: PiModelContext): PiModelHandle | null | "external" {
  const choice = resolvePiLiveModel(CONFIG);
  switch (choice.kind) {
    case "manual":
      return "external";
    case "session":
      return resolveImportModel(ctx);
    case "pi":
      return resolveModelFromContext(ctx, `${choice.provider}/${choice.model}`);
    case "unready":
      throw new Error(`omms: live capture is not configured: ${choice.issues.join("; ")}`);
  }
}

function describeMissing(): string {
  const choice = resolvePiLiveModel(CONFIG);
  return choice.kind === "pi"
    ? `Pi model ${choice.provider}/${choice.model} was not found`
    : "this Pi session has no model";
}

/** Run the Pi model, switching to the external API when it fails and one is configured. */
async function withFallback<T>(
  primary: PiModelHandle | null,
  run: (model: PiModelHandle) => Promise<T>,
  external: () => Promise<T>,
  notify?: Notify
): Promise<T> {
  let failure: unknown = primary ? null : new Error(`omms: ${describeMissing()}`);
  if (primary) {
    try {
      return await run(primary);
    } catch (error) {
      failure = error;
    }
  }
  if (!isExternalModelReady(CONFIG)) throw failure;
  const reason = failure instanceof Error ? failure.message : String(failure);
  log("Pi live model failed, falling back to external API", { error: reason });
  await Promise.resolve(
    notify?.({
      title: "Using fallback provider",
      message: `Pi model failed (${reason.length > 100 ? `${reason.slice(0, 100)}...` : reason}); using configured fallback.`,
      variant: "warning",
      duration: 5000,
    })
  ).catch(() => {});
  return external();
}

export function createPiLiveModels(ctx: PiModelContext, notify?: Notify): PiLiveModels {
  const capture: CaptureSummaryProvider = {
    async summarize(request) {
      const primary = primaryPiModel(ctx);
      if (primary === "external") return (await externalModels()).capture.summarize(request);
      return withFallback(
        primary,
        (model) => createPiCaptureProvider(() => model).summarize(request),
        async () => (await externalModels()).capture.summarize(request),
        notify
      );
    },
  };

  const profile = (): ModelPort | null => {
    let primary: PiModelHandle | null | "external";
    try {
      primary = primaryPiModel(ctx);
    } catch (error) {
      log("Pi profile learning: no live model", { error: String(error) });
      return null;
    }
    if (primary === "external") {
      return {
        provider: "external",
        modelId: "",
        complete: async (system, prompt) =>
          (await externalModels()).profile.complete(system, prompt),
      };
    }
    if (!primary && !isExternalModelReady(CONFIG)) return null;
    return {
      provider: primary?.provider ?? "external",
      modelId: primary?.modelId ?? "",
      complete: (system, prompt) =>
        withFallback(
          primary,
          (model) => adaptPiProfileModel(model).complete(system, prompt),
          async () => (await externalModels()).profile.complete(system, prompt),
          notify
        ),
    };
  };

  return { capture, profile };
}
