import { expect, it } from "bun:test";
import { getOrCreateAuthToken } from "../src/services/auth-token.js";
import { WebServer } from "../src/services/web-server.js";

it("serves the application shell on direct /memorisation loads and reloads", async () => {
  const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
  const served: string[] = [];
  const routes = server as unknown as {
    serveStaticFile(file: string, type: string): Response;
    handleRequest(request: Request, address: string): Promise<Response>;
  };
  // Only the shell exists as a file. /memorisation is a client route, so its asset lookup misses
  // and the single-page fallback serves the shell, as it does for /spaces and /chat.
  routes.serveStaticFile = (file, type) => {
    served.push(file);
    return file === "index.html"
      ? new Response("fixture application shell", { headers: { "content-type": type } })
      : new Response("Not Found", { status: 404 });
  };
  for (let i = 0; i < 2; i++) {
    const response = await routes.handleRequest(
      new Request("http://127.0.0.1:4747/memorisation", {
        headers: { "x-omms-token": getOrCreateAuthToken() },
      }),
      "127.0.0.1"
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(await response.text()).toBe("fixture application shell");
  }
  expect(served.filter((file) => file === "index.html")).toHaveLength(2);
});
