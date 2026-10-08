import { expect, it } from "bun:test";
import { getOrCreateAuthToken } from "../src/services/auth-token.js";
import { WebServer } from "../src/services/web-server.js";

it("serves the application shell on direct /memory loads and reloads", async () => {
  const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
  const served: string[] = [];
  const routes = server as unknown as {
    serveStaticFile(file: string, type: string): Promise<Response>;
    handleRequest(request: Request, address: string): Promise<Response>;
  };
  routes.serveStaticFile = async (file, type) => {
    served.push(file);
    return new Response("fixture application shell", { headers: { "content-type": type } });
  };
  for (let i = 0; i < 2; i++) {
    const response = await routes.handleRequest(
      new Request("http://127.0.0.1:4747/memory", {
        headers: { "x-omms-token": getOrCreateAuthToken() },
      }),
      "127.0.0.1"
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(await response.text()).toBe("fixture application shell");
  }
  expect(served).toEqual(["index.html", "index.html"]);
});
