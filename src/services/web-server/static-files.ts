import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { getOrCreateAuthToken } from "../auth-token.js";

/** The Content-Type for a file the web UI asks for. */
export function contentTypeFor(filename: string): string {
  switch (extname(filename).toLowerCase()) {
    case ".html":
      return "text/html";
    case ".js":
    case ".mjs":
      return "application/javascript";
    case ".css":
      return "text/css";
    case ".ico":
      return "image/x-icon";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".json":
      return "application/json";
    case ".map":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

/**
 * Serve one file of the built web UI. `moduleDir` is the folder of web-server.ts,
 * so the web folder resolves the same from `src/` and from `dist/`.
 */
export function serveStaticFile(
  moduleDir: string,
  filename: string,
  contentType: string,
  embedToken = true
): Response {
  try {
    const webDir = [join(moduleDir, "..", "web"), join(moduleDir, "..", "..", "dist", "web")].find(
      (candidate) => existsSync(candidate)
    );
    if (!webDir) {
      return new Response("File not found", { status: 404 });
    }

    const filePath = normalize(join(webDir, filename));
    const normalizedWebDir = normalize(webDir);
    if (filePath !== normalizedWebDir && !filePath.startsWith(`${normalizedWebDir}${sep}`)) {
      return new Response("File not found", { status: 404 });
    }
    if (!existsSync(filePath)) {
      return new Response("File not found", { status: 404 });
    }

    const cacheControl =
      filename.startsWith("assets/") || contentType.startsWith("font/")
        ? "public, max-age=31536000, immutable"
        : contentType.startsWith("image/")
          ? "public, max-age=86400"
          : "no-cache";

    if (
      contentType.startsWith("image/") ||
      contentType.startsWith("font/") ||
      contentType === "application/octet-stream"
    ) {
      const content = readFileSync(filePath);
      return new Response(content, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": cacheControl,
        },
      });
    }

    let content = readFileSync(filePath, "utf-8");

    // The token unlocks the whole API, so a network caller gets it only behind the browser password.
    if (embedToken && (filename === "index.html" || filename.endsWith("/index.html"))) {
      const token = getOrCreateAuthToken();
      content = content.replace(
        "</head>",
        `<script>window.__OMMS_TOKEN__=${JSON.stringify(token)};</script></head>`
      );
    }

    return new Response(content, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
      },
    });
  } catch {
    return new Response("File not found", { status: 404 });
  }
}

export function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
