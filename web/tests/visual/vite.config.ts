import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "vite";
import appConfig from "../../vite.config";
import { fixtureResponse } from "./fixtures";

function installFixtures(server: {
  middlewares: {
    use: (
      handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void
    ) => void;
  };
}) {
  server.middlewares.use((request, response, next) => {
    if (!request.url?.startsWith("/api")) return next();
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 65536) request.destroy();
    });
    request.on("end", () => {
      let parsed: unknown;
      try {
        parsed = body ? JSON.parse(body) : undefined;
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ success: false, error: "Invalid fixture JSON" }));
        return;
      }
      const result = fixtureResponse(request.method ?? "GET", request.url!, parsed);
      console.info(
        `[visual-fixture] ${request.method} ${request.url?.split("?")[0]} ${result.status}`
      );
      response.writeHead(result.status, {
        "Content-Type": "application/json",
        "X-OMMS-Visual-Fixture": "synthetic-only",
      });
      response.end(JSON.stringify(result.body));
    });
  });
}

export default defineConfig({
  ...appConfig,
  server: { proxy: {}, host: "127.0.0.1", port: 5179, strictPort: true },
  preview: { proxy: {}, host: "127.0.0.1" },
  plugins: [
    ...appConfig.plugins!,
    {
      name: "omms-synthetic-preview",
      configureServer: installFixtures,
      configurePreviewServer: installFixtures,
    },
  ],
});
