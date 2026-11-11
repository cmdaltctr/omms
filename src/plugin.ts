import type { Plugin } from "@opencode/plugin/promise/plugin";
const { default: OmmsPluginV2 } = await import("./v2/plugin.js");

// Stable plugin id: OpenCode scopes plugin storage and enable/disable rules by it,
// so it stays "omms" independent of the npm package name.
export const id = "omms";
export default { ...OmmsPluginV2, id } satisfies Plugin;
