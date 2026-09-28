import { CONFIG } from "../../config.js";
import { scheduleAutoBackfill } from "../../importer/auto-backfill.js";
import { registerHostBackfillModels } from "../../importer/backfill-controls.js";
import { resolveOpencodeBackfillModels } from "./backfill-models.js";

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
