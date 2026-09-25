// Refuses to publish a package that is missing a built entry point or the
// web UI. Runs as `prepublishOnly`, so a manual or CI publish without a fresh
// `bun run build` fails before anything reaches the registry.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const requiredFiles = [
  "dist/plugin.js",
  "dist/v2/plugin.js",
  "dist/adapters/pi/extension.js",
  "dist/web/index.html",
];

const missing = requiredFiles.filter((file) => !existsSync(join(root, file)));

const assetsDir = join(root, "dist/web/assets");
const hasWebScript =
  existsSync(assetsDir) && readdirSync(assetsDir).some((file) => file.endsWith(".js"));
if (!hasWebScript) missing.push("dist/web/assets/*.js");

if (missing.length > 0) {
  console.error("omms package is incomplete; run `bun run build` before publishing.");
  for (const file of missing) console.error(`  missing: ${file}`);
  process.exit(1);
}

console.log("omms package contents verified (plugin entry points and web UI present)");
