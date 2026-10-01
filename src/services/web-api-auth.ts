import { verifyApiToken } from "./api-tokens.js";
import { getRequestToken } from "./auth-token.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0:0:0:0:0:0:0:1"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

/** True for a peer socket address on this machine: 127.x.x.x, ::1, or an IPv4-mapped 127.x.x.x. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const value = address
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, "");
  return value === "::1" || /^127(?:\.\d{1,3}){3}$/.test(value);
}

/** A URL needs brackets around an IPv6 literal such as ::1. */
export function webServerUrl(host: string, port: number): string {
  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${urlHost}:${port}`;
}

export function assertWebServerNetworkAuth(
  host: string,
  tokenAvailable = false,
  basicAuthEnabled = false
): void {
  if (!isLoopbackHost(host) && !tokenAvailable && !basicAuthEnabled) {
    throw new Error(
      `webServerHost "${host}" exposes the API on the network. Create an API token on the Settings page, set a browser password, or bind to 127.0.0.1.`
    );
  }
}

/**
 * Authorise a request by an API token from the token table, sent as a bearer
 * token or in the OMMS token header. `webServerApiToken` is not read here.
 */
export function authorizeApiRequest(
  req: Request,
  verify: (value: string) => boolean = verifyApiToken
): Response | null {
  const header = req.headers.get("authorization");
  const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const token = bearer || getRequestToken(req);

  if (token && verify(token)) {
    return null;
  }

  return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
