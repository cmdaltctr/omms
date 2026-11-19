import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The web app runs under Node from the CLI, and Bun tests always take the
// Bun.serve path. This test runs the Node adapter in a real `node` process.

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const serveFetchUrl = pathToFileURL(
  join(import.meta.dir, "../src/services/web-server/serve-fetch.ts")
).href;

/** Serve on `hostname` under Node, send one request, and return the status and URL the handler saw. */
function nodeRoundTrip(hostname: string) {
  const dir = mkdtempSync(join(tmpdir(), "omms-serve-fetch-node-"));
  tempDirs.push(dir);
  const script = join(dir, "scenario.mjs");
  writeFileSync(
    script,
    `
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
// The sources import "./x.js" for "./x.ts"; map them so Node can strip the types.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
      const ts = new URL(specifier.replace(/\\.js$/, ".ts"), context.parentURL);
      if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
    }
    return next(specifier, context);
  },
});
const { serveFetch } = await import(${JSON.stringify(serveFetchUrl)});
const net = await import("node:net");
const port = await new Promise((resolve) => {
  const probe = net.createServer().listen(0, ${JSON.stringify(hostname)}, () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
let seen = null;
const server = await serveFetch({
  port,
  hostname: ${JSON.stringify(hostname)},
  fetch: async (req) => {
    seen = req.url;
    return new Response("ok");
  },
});
const host = ${JSON.stringify(hostname)}.includes(":") ? "[" + ${JSON.stringify(hostname)} + "]" : ${JSON.stringify(hostname)};
const reply = await fetch("http://" + host + ":" + port + "/api/health?x=1");
console.log("RESULT:" + JSON.stringify({ status: reply.status, seen, port }));
server.stop();
process.exit(0);
`
  );
  const run = Bun.spawnSync(["node", script], {
    env: { ...process.env, OMMS_LOG_FILE: join(dir, "omms.log") },
  });
  const out = run.stdout.toString();
  const line = out.split("\n").find((entry) => entry.startsWith("RESULT:"));
  if (!line) throw new Error(`node run failed: ${run.stderr.toString()}`);
  return JSON.parse(line.slice("RESULT:".length)) as { status: number; seen: string; port: number };
}

describe("serveFetch under Node", () => {
  it("serves a request on an IPv4 host", () => {
    const { status, seen, port } = nodeRoundTrip("127.0.0.1");
    expect(status).toBe(200);
    expect(seen).toBe(`http://127.0.0.1:${port}/api/health?x=1`);
  });

  it("serves a request on an IPv6 host with a bracketed URL", () => {
    const { status, seen, port } = nodeRoundTrip("::1");
    expect(status).toBe(200);
    expect(seen).toBe(`http://[::1]:${port}/api/health?x=1`);
  });
});
