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
