import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getOrCreateAuthToken } from "../src/services/auth-token.js";
import { WebServer } from "../src/services/web-server.js";

// Pins how the web server serves the built web UI from dist/web: content types,
// cache headers, the token in the app shell, the single-page fallback, and the
// guard that keeps file reads inside the web folder. Needs `bun run build` once.

const webDir = join(import.meta.dir, "..", "dist", "web");
const script = readdirSync(join(webDir, "assets")).find((file) => file.endsWith(".js"));

function routes() {
  const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
  return server as unknown as {
    serveStaticFile(file: string, type: string): Response;
    handleRequest(request: Request, address: string): Promise<Response>;
  };
}

const get = (path: string) =>
  routes().handleRequest(new Request(`http://127.0.0.1:4747${path}`), "127.0.0.1");

describe("static web UI serving", () => {
  it("finds the built web UI", () => {
    // Guards the checks below: without dist/web every file is a 404.
    expect(existsSync(join(webDir, "index.html"))).toBe(true);
    expect(script).toBeDefined();
  });

  it("serves the app shell with the local token and no caching", async () => {
    for (const path of ["/", "/index.html", "/settings", "/memory"]) {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html");
      expect(response.headers.get("cache-control")).toBe("no-cache");
      const html = await response.text();
      expect(html).toContain(
        `<script>window.__OMMS_TOKEN__=${JSON.stringify(getOrCreateAuthToken())};</script></head>`
      );
    }
  });

  it("caches hashed assets for a year and images for a day", async () => {
    const asset = await get(`/assets/${script}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("application/javascript");
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    const favicon = await get("/favicon.ico");
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get("content-type")).toBe("image/x-icon");
    expect(favicon.headers.get("cache-control")).toBe("public, max-age=86400");

    const icon = await get("/omms-icon.svg");
    expect(icon.headers.get("content-type")).toBe("image/svg+xml");
    expect(icon.headers.get("cache-control")).toBe("public, max-age=86400");

    const touch = await get("/apple-touch-icon.png");
    expect(touch.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await touch.arrayBuffer()).slice(0, 4)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    );
  });

  it("serves the app shell for client routes and 404 for missing files", async () => {
    const client = await get("/profile");
    expect(client.status).toBe(200);
    expect(client.headers.get("content-type")).toBe("text/html");

    const missing = await get("/assets/missing-file.js");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Not Found");
  });

  it("never reads a file outside the web folder", async () => {
    const server = routes();
    const outside = server.serveStaticFile("../../package.json", "application/json");
    expect(outside.status).toBe(404);
    expect(await outside.text()).toBe("File not found");
    expect(server.serveStaticFile("no-such-file.txt", "text/plain").status).toBe(404);
  });
});
