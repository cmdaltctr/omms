import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { providerName } from "../src/lib/provider-names.ts";
import { rerankerMessage } from "../src/lib/reranker-messages.ts";
import { settingsCatalogueText } from "../src/lib/i18n/settings-catalogue.ts";

const root = new URL("../../", import.meta.url);

/** The reranker codes that the server can send, read from the server files. */
function serverCodes(): string[] {
  const codes = new Set<string>();
  for (const file of [
    "src/services/reranker.ts",
    "src/services/reranker-test.ts",
    "src/services/client.ts",
    "src/services/client-read-settings.ts",
  ]) {
    const source = readFileSync(new URL(file, root), "utf8");
    for (const match of source.matchAll(/"(reranker_[a-z_]+)"/g)) codes.add(match[1]!);
  }
  return [...codes];
}

it("gives each reranker code a plain sentence", () => {
  const codes = serverCodes();
  expect(codes.length).toBeGreaterThanOrEqual(6);
  for (const code of codes) {
    const result = rerankerMessage(code);
    expect(result.code).toBeUndefined();
    expect(result.message).not.toContain("reranker_");
    expect(result.message.endsWith(".")).toBe(true);
    expect(
      settingsCatalogueText[result.message as keyof typeof settingsCatalogueText]
    ).toBeTruthy();
  }
});

it("says that OMMS could not reach the server, and what to check", () => {
  const { message } = rerankerMessage("reranker_unreachable");
  expect(message).toContain("could not reach");
  expect(message).toContain("URL");
  expect(message).toContain("running");
});

it("gives an unknown or missing code a general sentence with the code as secondary text", () => {
  const unknown = rerankerMessage("reranker_new_thing");
  expect(unknown.message).toBe("The reranker test failed.");
  expect(unknown.code).toBe("reranker_new_thing");
  expect(rerankerMessage(undefined).message).toBe("The reranker test failed.");
  expect(rerankerMessage(undefined).code).toBeUndefined();
});

it("gives each memory provider id a display name", () => {
  const source = readFileSync(new URL("src/config-writer.ts", root), "utf8");
  const start = source.indexOf("const MEMORY_PROVIDERS = [");
  const ids = [...source.slice(start, source.indexOf("];", start)).matchAll(/"([a-z-]+)"/g)].map(
    (match) => match[1]!
  );
  expect(ids).toContain("openai-chat");
  for (const id of ids) {
    expect(providerName(id)).not.toBe(id);
    expect(providerName(id)).toMatch(/^[A-Z]/);
  }
  expect(providerName("openai-chat")).toBe("OpenAI Chat Completions");
  expect(providerName("some-future-id")).toBe("some-future-id");
});
