import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode/plugin/promise/plugin";
import { OmmsPlugin } from "../index.js";
import { loadOpencodeProvider } from "../adapters/opencode/opencode-provider-loader.js";
import { registerV2Adapter } from "./adapter.js";
import { createV2MemoryBridge } from "./memory-bridge.js";
import { createLegacyClient } from "./legacy-client.js";

/**
 * Remove old OMMS copies from the OpenCode cache. It runs in the background and
 * is not awaited, so a slow or failing clean-up never delays or breaks setup.
 * `OMMS_DISABLE_UPDATE_CHECK` does not stop it: removing old copies saves disk
 * space and installs nothing. It keeps the copy that `~/.omms/runtime.json` names.
 */
function startCacheCleanup(): void {
  void (async () => {
    const modulePath = fileURLToPath(import.meta.url);
    const [
      { installedFromNpm },
      { pruneOldCacheCopies },
      { readRuntimeRecord },
      { ommsDir },
      { packageVersion },
      { log },
    ] = await Promise.all([
      import("../services/host-self-update.js"),
      import("../services/host-copies.js"),
      import("../services/runtime-record.js"),
      import("../services/runtime-handoff.js"),
      import("../services/package-version.js"),
      import("../services/logger.js"),
    ]);
    if (!installedFromNpm(modulePath)) return;
    const recorded = readRuntimeRecord(ommsDir());
    await pruneOldCacheCopies({
      modulePath,
      runningVersion: packageVersion(),
      keepRoots: recorded ? [recorded.root] : [],
      now: Date.now(),
      log: (message, data) => log(message, data),
    });
  })().catch(() => {});
}

const OmmsPluginV2: Plugin = {
  id: "omms",
  async setup(ctx) {
    const legacyClient = createLegacyClient(ctx);
    const legacy = (await OmmsPlugin({
      client: legacyClient,
      directory: ctx.location.directory,
      worktree: ctx.location.project.directory,
      project: ctx.location.project,
      serverUrl: undefined,
    } as any)) as any;

    // The V1 initializer cannot discover a server URL from a native V2
    // context. Route internal structured-output calls through the adapter.
    const { setV2Client } = await loadOpencodeProvider();
    setV2Client(legacyClient);

    const adapter = await registerV2Adapter(
      ctx,
      legacy,
      createV2MemoryBridge(ctx.location.directory)
    );
    startCacheCleanup();
    return adapter;
  },
};

export default OmmsPluginV2;
