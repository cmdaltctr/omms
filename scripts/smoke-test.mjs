import assert from "node:assert/strict";

const pluginModule = await import("omms");
const tagsModule = await import("omms/tags");

assert.equal(typeof pluginModule.default, "object", "default export must be a plugin object");
assert.equal(pluginModule.default.id, "omms", "plugin id must match package name");
assert.equal(typeof pluginModule.default.server, "function", "plugin server must be callable");

assert.equal(typeof tagsModule.getTags, "function", "getTags export must be callable");
assert.equal(
  typeof tagsModule.getProjectTagInfo,
  "function",
  "getProjectTagInfo export must be callable"
);
assert.equal(
  typeof tagsModule.getUserTagInfo,
  "function",
  "getUserTagInfo export must be callable"
);

console.log("omms package smoke test passed");
