import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "vite";
import appConfig from "../../vite.config";
import { readmeFixtureResponse } from "./readme-fixtures";

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
        response.writeHead(400, {
          "Content-Type": "application/json",
          "X-OMMS-Visual-Fixture": "synthetic-only",
        });
        response.end(JSON.stringify({ error: "Invalid demo JSON" }));
        return;
      }
      const result = readmeFixtureResponse(request.method ?? "GET", request.url!, parsed);
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
  server: { proxy: {}, host: "127.0.0.1", port: 5181, strictPort: true },
  preview: { proxy: {}, host: "127.0.0.1", port: 5181, strictPort: true },
  plugins: [
    ...appConfig.plugins!,
    {
      name: "omms-readme-demo",
      configureServer: installFixtures,
      configurePreviewServer: installFixtures,
    },
  ],
});
