import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode/plugin/promise/plugin";
import { setOpencodeHost } from "../adapters/opencode/opencode-host.js";
import { CONFIG } from "../config.js";
import { recordOpencodePromptModel } from "../adapters/opencode/prompt-model.js";
import { performUserProfileLearning } from "../adapters/opencode/profile-learning.js";
import { getLanguageName } from "../services/language-detector.js";
import { registerV2Adapter } from "./adapter.js";
import { createV2MemoryBridge } from "./memory-bridge.js";
import { createOpencodeSessionEvents } from "./session-events.js";
import { startOpencodeRuntime } from "./startup.js";
import { createOpencodeTools } from "./tools.js";

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

let serviceUpdateStarted = false;

/**
 * Check npm for a newer OMMS from the background service too, so OpenCode
 * without a TUI (OpenChamber, `opencode serve`) also updates. Once per
 * process: setup can run for each project. Not awaited; a failure is ignored.
 */
function startServiceSelfUpdate(): void {
  if (serviceUpdateStarted) return;
  serviceUpdateStarted = true;
  void (async () => {
    const modulePath = fileURLToPath(import.meta.url);
    const [
      { opencodeSelfUpdateDeps, startOpencodeServiceSelfUpdate },
      { startHostSelfUpdate },
      { packageVersion },
      { log },
    ] = await Promise.all([
      import("../adapters/opencode/self-update.js"),
      import("../services/host-self-update.js"),
      import("../services/package-version.js"),
      import("../services/logger.js"),
    ]);
    const deps = opencodeSelfUpdateDeps({
      modulePath,
      currentVersion: packageVersion(),
      log: (message, data) => log(message, data),
    });
    startOpencodeServiceSelfUpdate({ run: () => startHostSelfUpdate(deps) });
  })().catch(() => {});
}

const OmmsPluginV2: Plugin = {
  id: "omms",
  async setup(ctx) {
    const directory = ctx.location.directory;
    // Capture, profile learning, imports and Settings reach OpenCode through the context.
    setOpencodeHost(ctx);

    // The runtime's shutdown drops pending idle work, so it needs the handler created after it.
    const holder: { events?: ReturnType<typeof createOpencodeSessionEvents> } = {};
    const runtime = await startOpencodeRuntime(ctx, () => holder.events?.dispose());
    const events = createOpencodeSessionEvents({
      session: ctx.session,
      directory,
      autoCaptureHost: runtime.autoCaptureHost,
      learnProfile: () => performUserProfileLearning(directory),
    });
    holder.events = events;

    const adapter = await registerV2Adapter(
      ctx,
      {
        tools: createOpencodeTools(
          { directory, tags: runtime.tags },
          getLanguageName(CONFIG.autoCaptureLanguage || "en")
        ),
        recordPromptModel: recordOpencodePromptModel,
        onEvent: (event) => events.handle(event),
        dispose: () => runtime.dispose(),
      },
      createV2MemoryBridge(directory)
    );
    startCacheCleanup();
    startServiceSelfUpdate();
    return adapter;
  },
};

export default OmmsPluginV2;
