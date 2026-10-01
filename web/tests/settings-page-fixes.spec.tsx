import { beforeEach, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { kindChange, keyChoiceFor } from "../src/lib/embedding-settings.ts";
import { PasswordFields } from "../src/lib/components/settings/KeysAccessSection.tsx";
import { passwordStatusMessage } from "../src/lib/credential-states.ts";
import {
  shouldOpenTagMigration,
  rememberTagMigrationClose,
} from "../src/lib/tag-migration-prompt.ts";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
});

it("resets the model to the built-in default when switching to Built-in model", () => {
  expect(kindChange("builtin", "Xenova/nomic-embed-text-v1")).toEqual({
    kind: "builtin",
    model: "Xenova/nomic-embed-text-v1",
  });
  // The server's model name is kept for a server, and the saved built-in model wins when known.
  expect(kindChange("builtin", "Xenova/all-MiniLM-L6-v2")).toEqual({
    kind: "builtin",
    model: "Xenova/all-MiniLM-L6-v2",
  });
  expect(kindChange("server")).toEqual({ kind: "server" });
});

it("selects No key when a saved server has no key", () => {
  expect(keyChoiceFor("server", false)).toBe("none");
  expect(keyChoiceFor("server", true)).toBe("saved");
  expect(keyChoiceFor("builtin", true)).toBe("none");
});

it("gives a clearing message after Clear password", () => {
  expect(passwordStatusMessage(true)).toBe(
    "Browser password cleared. Restart the web app to turn it off."
  );
  expect(passwordStatusMessage(false)).toBe(
    "Saved. Restart the web app to use the new browser password."
  );
});

it("shows visible labels on the password form", () => {
  const html = renderToStaticMarkup(
    <PasswordFields value={{ username: "", value: "" }} onChange={() => {}} />
  );
  expect(html).toContain(">User name<");
  expect(html).toContain(">Password<");
});

it("asks about untagged memories once per count, and again only when more appear", () => {
  expect(shouldOpenTagMigration(7)).toBe(true);
  rememberTagMigrationClose(7);
  expect(shouldOpenTagMigration(7)).toBe(false);
  expect(shouldOpenTagMigration(5)).toBe(false);
  expect(shouldOpenTagMigration(9)).toBe(true);
  expect(shouldOpenTagMigration(0)).toBe(false);
});

it("forgets a closed count once the migration completes", async () => {
  const { clearTagMigrationClose } = await import("../src/lib/tag-migration-prompt.ts");
  rememberTagMigrationClose(7);
  clearTagMigrationClose();
  expect(shouldOpenTagMigration(3)).toBe(true);
});

it("lets only the newest refresh write its results", async () => {
  const { createLatestGate } = await import("../src/lib/settings-api.ts");
  const gate = createLatestGate();
  const older = gate.begin();
  const newer = gate.begin();
  expect(older()).toBe(false);
  expect(newer()).toBe(true);
});

it("clears the busy flag even when the work fails", async () => {
  const { withBusy } = await import("../src/lib/settings-api.ts");
  const states: boolean[] = [];
  await expect(
    withBusy(
      (value) => states.push(value),
      async () => {
        throw new Error("reload failed");
      }
    )
  ).rejects.toThrow("reload failed");
  expect(states).toEqual([true, false]);
});

it("refreshes diagnostics for the chosen host after Retry now", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const source = readFileSync(
    join(import.meta.dir, "../src/lib/components/settings/DiagnosticsSection.tsx"),
    "utf8"
  );
  expect(source).toContain("async function retryNow(retryHost: RetryHost)");
  expect(source).toMatch(/retryNow\(retryHost[\s\S]*?await refresh\(days, host\)/);
});
