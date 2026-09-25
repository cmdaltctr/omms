import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { randomBytes } from "node:crypto";

const DATA_DIR = join(homedir(), ".omms");
const TOKEN_FILE = join(DATA_DIR, ".auth-token");
// Token written by opencode-mem builds; adopted once so open web UI tabs keep working.
const LEGACY_TOKEN_FILE = join(homedir(), ".opencode-mem", ".auth-token");

export const AUTH_HEADER = "x-omms-token";
/** Header sent by opencode-mem-era clients; still accepted. */
export const LEGACY_AUTH_HEADER = "x-opencode-mem-token";

let cachedToken: string | null = null;

function readToken(path: string): string | null {
  if (!existsSync(path)) return null;
  const token = readFileSync(path, "utf-8").trim();
  return token || null;
}

function writeToken(token: string): void {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  if (platform() !== "win32") {
    try {
      chmodSync(TOKEN_FILE, 0o600);
    } catch {
      // best-effort; file was already created with mode 0o600 above
    }
  }
}

/**
 * A shared secret generated on first run and persisted to a local,
 * user-only-readable file. Required on every /api/* request so that a
 * malicious web page (which cannot read cross-origin/opaque responses,
 * including the token injected into index.html) cannot drive the API via
 * CSRF even though the CORS check alone lets no-Origin requests through.
 */
export function getOrCreateAuthToken(): string {
  if (cachedToken) {
    return cachedToken;
  }

  const existing = readToken(TOKEN_FILE);
  if (existing) {
    cachedToken = existing;
    return cachedToken;
  }

  const token = readToken(LEGACY_TOKEN_FILE) ?? randomBytes(32).toString("hex");
  writeToken(token);
  cachedToken = token;
  return cachedToken;
}

/** The auth token from either the omms header or the legacy opencode-mem header. */
export function getRequestToken(req: Request): string | undefined {
  return (
    req.headers.get(AUTH_HEADER)?.trim() || req.headers.get(LEGACY_AUTH_HEADER)?.trim() || undefined
  );
}

export function isAuthorizedApiRequest(req: Request): boolean {
  const token = getOrCreateAuthToken();
  return getRequestToken(req) === token;
}
