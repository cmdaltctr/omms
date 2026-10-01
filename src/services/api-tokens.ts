import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Named API tokens for scripts and other computers. The file keeps only a
 * SHA-256 hash of each value: a value carries 256 random bits, so a slow hash
 * adds nothing. A new value is returned once, by `createApiToken`.
 */
export const CONFIG_TOKEN_NAME = "from config file";
export const TOKEN_EXPIRY_DAYS = [7, 30, 90] as const;
export type TokenExpiryDays = (typeof TOKEN_EXPIRY_DAYS)[number] | null;

const DAY_MS = 86_400_000;
/** Limits file writes from a busy script to one per token per minute. */
const LAST_USED_INTERVAL_MS = 60_000;

interface StoredToken {
  id: string;
  name: string;
  hash: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
}

export type ApiTokenView = Omit<StoredToken, "hash">;

export const apiTokensPath = () => join(homedir(), ".omms", "api-tokens.json");

function hashToken(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function read(path: string): StoredToken[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(text) as { tokens?: StoredToken[] };
    return Array.isArray(parsed.tokens) ? parsed.tokens : [];
  } catch {
    return [];
  }
}

/** Replace the file atomically; it is private to the user (0600 in a 0700 folder). */
function write(path: string, tokens: StoredToken[]): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify({ version: 1, tokens }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

function view({ hash: _hash, ...token }: StoredToken): ApiTokenView {
  return token;
}

function isLive(token: StoredToken, now: number): boolean {
  return token.expiresAt === null || token.expiresAt > now;
}

export function listApiTokens(path = apiTokensPath()): ApiTokenView[] {
  return read(path).map(view);
}

export function createApiToken(
  name: string,
  expiresInDays: TokenExpiryDays,
  path = apiTokensPath(),
  now = Date.now()
): { value: string; token: ApiTokenView } {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || trimmed.length > 64) throw new Error("Name the token with 1 to 64 characters");
  if (expiresInDays !== null && !TOKEN_EXPIRY_DAYS.includes(expiresInDays)) {
    throw new Error("Choose an expiry of 7, 30, or 90 days, or never");
  }
  const value = `omms_${randomBytes(32).toString("base64url")}`;
  const token: StoredToken = {
    id: randomUUID(),
    name: trimmed,
    hash: hashToken(value).toString("hex"),
    createdAt: now,
    expiresAt: expiresInDays === null ? null : now + expiresInDays * DAY_MS,
    lastUsedAt: null,
  };
  write(path, [...read(path), token]);
  return { value, token: view(token) };
}

export function revokeApiToken(id: string, path = apiTokensPath()): boolean {
  const tokens = read(path);
  const kept = tokens.filter((token) => token.id !== id);
  if (kept.length === tokens.length) return false;
  write(path, kept);
  return true;
}

/** True when `value` matches an unexpired token; compares hashes in constant time. */
export function verifyApiToken(value: string, path = apiTokensPath(), now = Date.now()): boolean {
  if (!value) return false;
  const candidate = hashToken(value);
  const tokens = read(path);
  let match: StoredToken | undefined;
  for (const token of tokens) {
    const stored = Buffer.from(token.hash, "hex");
    if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) match = token;
  }
  if (!match || !isLive(match, now)) return false;
  if (match.lastUsedAt === null || now - match.lastUsedAt >= LAST_USED_INTERVAL_MS) {
    match.lastUsedAt = now;
    try {
      write(path, tokens);
    } catch {
      // A failed last-used write must not refuse a valid token.
    }
  }
  return true;
}

export function hasUnexpiredApiToken(path = apiTokensPath(), now = Date.now()): boolean {
  return read(path).some((token) => isLive(token, now));
}

/**
 * Add the `webServerApiToken` config value once, with no expiry. Later edits
 * to the config key are not imported. The config file is not changed.
 */
export function importConfigApiToken(
  value: string | undefined,
  path = apiTokensPath(),
  now = Date.now()
): boolean {
  if (!value) return false;
  const tokens = read(path);
  if (tokens.some((token) => token.name === CONFIG_TOKEN_NAME)) return false;
  write(path, [
    ...tokens,
    {
      id: randomUUID(),
      name: CONFIG_TOKEN_NAME,
      hash: hashToken(value).toString("hex"),
      createdAt: now,
      expiresAt: null,
      lastUsedAt: null,
    },
  ]);
  return true;
}
