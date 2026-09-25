import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// omms resolves its home directory when its modules load, so point HOME at a
// scratch directory before importing anything: the smoke test must not write
// config, tokens, or stores into the runner's real home.
const home = mkdtempSync(join(tmpdir(), "omms-smoke-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;

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

// Every published version must ship the built web UI and serve it.
const distDir = dirname(fileURLToPath(import.meta.resolve("omms")));
const webIndex = join(distDir, "web", "index.html");
assert.ok(existsSync(webIndex), `installed package must contain ${webIndex}`);
assert.match(readFileSync(webIndex, "utf8"), /<title>omms Memory Explorer<\/title>/);

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const { WebServer } = await import(pathToFileURL(join(distDir, "services", "web-server.js")).href);
const port = await freePort();
const webServer = new WebServer({ enabled: true, host: "127.0.0.1", port });
try {
  await webServer.start();
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200, "web UI must be served at /");
  assert.match(await response.text(), /<title>omms Memory Explorer<\/title>/);
} finally {
  await webServer.stop();
  rmSync(home, { recursive: true, force: true });
}

console.log("omms package smoke test passed (plugin exports and web UI)");
// Loaded modules may keep background handles; the smoke result is final here.
process.exit(0);
