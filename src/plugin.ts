import type { PluginModule } from "@opencode-ai/plugin";
import type { Plugin as V2Plugin } from "@opencode/plugin/promise/plugin";
import pkg from "../package.json" with { type: "json" };
const { OmmsPlugin } = await import("./index.js");
const { default: OmmsPluginV2 } = await import("./v2/plugin.js");

export const id = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : "omms";
export { OmmsPlugin };
export default {
  ...OmmsPluginV2,
  id,
  server: OmmsPlugin,
} satisfies PluginModule & V2Plugin;
