import { CONFIG } from "../../config.js";
import { scheduleAutoBackfill } from "../../importer/auto-backfill.js";
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
