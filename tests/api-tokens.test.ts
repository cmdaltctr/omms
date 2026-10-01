import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createApiToken,
  hasUnexpiredApiToken,
  importConfigApiToken,
  listApiTokens,
  revokeApiToken,
  verifyApiToken,
} from "../src/services/api-tokens.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function tokenFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "omms-api-tokens-"));
  dirs.push(dir);
  return join(dir, "api-tokens.json");
}
const DAY = 86_400_000;

it("returns a new value once and stores only its hash in a private file", () => {
  const file = tokenFile();
  const created = createApiToken("ci", 30, file, 1_000);
  expect(created.value).toMatch(/^omms_[A-Za-z0-9_-]{43}$/);
  expect(created.token).toMatchObject({
    name: "ci",
    createdAt: 1_000,
    expiresAt: 1_000 + 30 * DAY,
  });
  const stored = readFileSync(file, "utf8");
  expect(stored).not.toContain(created.value);
  expect(stored).toContain("hash");
  if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
});

it("lists tokens without values or hashes", () => {
  const file = tokenFile();
  const { value } = createApiToken("ci", null, file, 1_000);
  const rows = listApiTokens(file);
  expect(rows).toEqual([
    { id: rows[0]!.id, name: "ci", createdAt: 1_000, expiresAt: null, lastUsedAt: null },
  ]);
  expect(JSON.stringify(rows)).not.toContain(value);
  expect(JSON.stringify(rows)).not.toContain("hash");
});

it("authorises a valid token and records last use at most once a minute", () => {
  const file = tokenFile();
  const { value } = createApiToken("ci", 7, file, 1_000);
  expect(verifyApiToken(value, file, 2_000)).toBe(true);
  expect(listApiTokens(file)[0]!.lastUsedAt).toBe(2_000);
  expect(verifyApiToken(value, file, 30_000)).toBe(true);
  expect(listApiTokens(file)[0]!.lastUsedAt).toBe(2_000);
  expect(verifyApiToken(value, file, 70_000)).toBe(true);
  expect(listApiTokens(file)[0]!.lastUsedAt).toBe(70_000);
  expect(verifyApiToken("omms_wrong", file, 70_000)).toBe(false);
});

it("refuses expired and revoked tokens", () => {
  const file = tokenFile();
  const expired = createApiToken("old", 7, file, 1_000);
  expect(verifyApiToken(expired.value, file, 1_000 + 8 * DAY)).toBe(false);
  const revoked = createApiToken("gone", null, file, 1_000);
  expect(revokeApiToken(revoked.token.id, file)).toBe(true);
  expect(verifyApiToken(revoked.value, file, 2_000)).toBe(false);
  expect(hasUnexpiredApiToken(file, 1_000 + 8 * DAY)).toBe(false);
  createApiToken("live", 90, file, 1_000);
  expect(hasUnexpiredApiToken(file, 1_000 + 8 * DAY)).toBe(true);
});

it("imports the config token once, with no expiry", () => {
  const file = tokenFile();
  expect(importConfigApiToken("config-token-value", file, 1_000)).toBe(true);
  expect(importConfigApiToken("changed-config-value", file, 2_000)).toBe(false);
  expect(listApiTokens(file)).toMatchObject([{ name: "from config file", expiresAt: null }]);
  expect(verifyApiToken("config-token-value", file, 3_000)).toBe(true);
  expect(verifyApiToken("changed-config-value", file, 3_000)).toBe(false);
  expect(readFileSync(file, "utf8")).not.toContain("config-token-value");
});

it("rejects a bad name or expiry", () => {
  const file = tokenFile();
  expect(() => createApiToken("", 30, file)).toThrow();
  expect(() => createApiToken("ci", 12 as 30, file)).toThrow();
});
