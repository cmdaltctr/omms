import type { PluginModule } from "@opencode-ai/plugin";
import type { Plugin as V2Plugin } from "@opencode/plugin/promise/plugin";
const { OmmsPlugin } = await import("./index.js");
const { default: OmmsPluginV2 } = await import("./v2/plugin.js");

// Stable plugin id: OpenCode scopes plugin storage and enable/disable rules by it,
// so it stays "omms" independent of the npm package name.
export const id = "omms";
export { OmmsPlugin };
export default {
  ...OmmsPluginV2,
  id,
  server: OmmsPlugin,
} satisfies PluginModule & V2Plugin;
