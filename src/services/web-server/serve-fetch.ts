import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { log } from "../logger.js";
import { NODE_HTTP_IDLE_TIMEOUT_MS } from "../request-timeouts.js";
import { webServerUrl } from "../web-api-auth.js";

/**
 * Runtime-portable HTTP server handle.
 *
 * Under Bun we delegate to `Bun.serve` which is the fastest path on that
 * runtime. Under Node we use `node:http` and adapt between IncomingMessage/
 * ServerResponse and the Web `Request`/`Response` primitives used by the
 * fetch-style handler.
 *
 * Both paths expose the same minimal surface — `stop()` and `url` — that the
 * rest of this class relies on, so the WebServer class itself does not need
 * to branch.
 */
export interface PortableServerHandle {
  stop(): void;
}

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

type NodeEventSource = {
  on(event: string, listener: (...args: any[]) => void): unknown;
};

export function attachNodeDisconnectHandlers(
  req: NodeEventSource & {
    aborted: boolean;
    complete: boolean;
    socket: NodeEventSource;
  },
  res: NodeEventSource & { writableEnded: boolean },
  onDisconnect: () => void
): void {
  let disconnected = false;
  const disconnectOnce = () => {
    if (disconnected || res.writableEnded) return;
    disconnected = true;
    onDisconnect();
  };

  req.on("aborted", disconnectOnce);
  req.on("close", () => {
    if (req.aborted || !req.complete) disconnectOnce();
  });
  req.socket.on("error", disconnectOnce);
  req.socket.on("close", disconnectOnce);
  res.on("close", disconnectOnce);
}

export function serveFetch(opts: {
  port: number;
  hostname: string;
  fetch: (req: Request, remoteAddress?: string) => Promise<Response>;
}): Promise<PortableServerHandle> {
  if (isBun) {
    type BunServer = { requestIP(req: Request): { address: string } | null };
    const bunHandle = (
      globalThis as unknown as { Bun: { serve: (opts: unknown) => { stop: () => void } } }
    ).Bun.serve({
      port: opts.port,
      hostname: opts.hostname,
      fetch: (req: Request, server: BunServer) => opts.fetch(req, server.requestIP(req)?.address),
    });
    return Promise.resolve({ stop: () => bunHandle.stop() });
  }

  // Node path: wrap node:http around the fetch-style handler. The adapter
  // converts IncomingMessage → Web Request and Web Response → ServerResponse.
  // Bodies stream both directions via the WHATWG Streams ↔ Node Streams
  // helpers that ship with Node 18+.
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let destroyed = false;
    const abortController = new AbortController();
    const cleanup = () => {
      if (destroyed) return;
      destroyed = true;
      abortController.abort();
      if (!res.writableEnded) res.destroy();
      if (!req.socket.destroyed) req.socket.destroy();
    };
    attachNodeDisconnectHandlers(req, res, cleanup);

    try {
      // An IPv6 host such as ::1 needs brackets in the URL; the socket bind keeps the raw host.
      const url = `${webServerUrl(opts.hostname, opts.port)}${req.url ?? "/"}`;
      const method = req.method ?? "GET";
      const hasBody = method !== "GET" && method !== "HEAD";
      const webReq = new Request(url, {
        method,
        headers: req.headers as Record<string, string>,
        body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
        signal: abortController.signal,
        ...(hasBody ? ({ duplex: "half" } as Record<string, unknown>) : {}),
      });

      const webRes = await opts.fetch(webReq, req.socket.remoteAddress);
      if (destroyed) return;
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, name) => res.setHeader(name, value));
      res.setHeader("Connection", "close");

      if (webRes.body) {
        const src = Readable.fromWeb(
          webRes.body as unknown as Parameters<typeof Readable.fromWeb>[0]
        );
        res.on("close", () => {
          if (!src.destroyed) src.destroy();
        });
        src.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain");
      }
      if (!res.writableEnded) {
        res.end(`Internal Server Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  server.unref();
  server.timeout = NODE_HTTP_IDLE_TIMEOUT_MS;
  server.keepAliveTimeout = 10000;
  server.headersTimeout = 11000;

  // Node reports EADDRINUSE after listen() returns, so wait for the outcome.
  // Callers then see a busy port the same way they do under Bun.
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      // Keep a listener, so a later server error is logged instead of crashing the process.
      server.on("error", (error) => log("Web server error", { error: String(error) }, "error"));
      resolve({
        stop: () => {
          server.closeAllConnections();
          server.close();
        },
      });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    // exclusive: false disables SO_EXCLUSIVEADDRUSE on Windows, allowing
    // rebind after a crashed predecessor left orphaned sockets behind.
    server.listen({ port: opts.port, host: opts.hostname, reuseAddr: true, exclusive: false });
  });
}
