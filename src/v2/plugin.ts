import type { Plugin } from "@opencode/plugin/promise/plugin";
import { OmmsPlugin } from "../index.js";
import { loadOpencodeProvider } from "../services/ai/opencode-provider-loader.js";
import { registerV2Adapter } from "./adapter.js";
import { createV2MemoryBridge } from "./memory-bridge.js";
import { createLegacyClient } from "./legacy-client.js";

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

    return registerV2Adapter(ctx, legacy, createV2MemoryBridge(ctx.location.directory));
  },
};

export default OmmsPluginV2;
