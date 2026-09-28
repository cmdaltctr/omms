import { CONFIG } from "../../config.js";
import type { AutoCaptureHost } from "../../core/host.js";
import { scheduleAutoBackfill } from "../../importer/auto-backfill.js";
import {
  registerHostBackfillModels,
  registerOpencodeHostModels,
} from "../../importer/backfill-controls.js";
import { listOpencodeClientModels } from "../../importer/settings-models.js";
import { drainOpencodeCaptureRetries } from "../../services/auto-capture.js";
import { registerCaptureRetryDrain } from "../../services/capture-retry-drain.js";
import { resolveOpencodeBackfillModels } from "./backfill-models.js";
import { createOpencodeImportModels } from "./opencode-import-models.js";
import { getV2Client, isProviderConnected } from "./opencode-provider.js";

/** Start after connected providers load, without delaying plugin initialisation. */
export function startOpencodeBackfill(input: {
  directory: string;
  connected: string[];
  configModel: () => Promise<string | null>;
  notify: (message: string) => void;
}): Promise<void> {
  return scheduleAutoBackfill({
    host: "opencode",
    cwd: input.directory,
    resolveModels: () => resolveOpencodeBackfillModels(CONFIG, input),
    notify: input.notify,
  });
}

/** Let Run now on a Settings page served by this process use OpenCode's models. */
export function registerOpencodeBackfillModels(input: {
  directory: string;
  connected: string[];
  configModel: () => Promise<string | null>;
}): void {
  registerHostBackfillModels("opencode", () => resolveOpencodeBackfillModels(CONFIG, input));
}

/** Let web imports, Health, and Settings in this process use OpenCode's signed-in models. */
export function registerOpencodeImportModels(): void {
  registerOpencodeHostModels({
    isProviderConnected: (providerID) => isProviderConnected(providerID),
    createImportModels: (ref, directory) => createOpencodeImportModels(ref, directory),
    async listSettingsModels() {
      const client = getV2Client();
      return client ? listOpencodeClientModels(client) : null;
    },
  });
}

/** Let triggers and Retry now in this process retry OpenCode's queued turns. */
export function registerOpencodeCaptureRetryDrain(host: AutoCaptureHost, directory: string): void {
  registerCaptureRetryDrain("opencode", () => drainOpencodeCaptureRetries(host, directory));
}
