import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { translateSettings } from "../src/lib/i18n/settings";

const files = [
  "lib/components/memory/HostCard.tsx",
  "lib/components/memory/HostView.tsx",
  "lib/components/memory/HostStatusHeader.tsx",
  "lib/components/memory/HostSettings.tsx",
  "lib/components/memory/HostRunDetails.tsx",
  "lib/components/memory/MemoryOverview.tsx",
  "lib/components/memory/SharedView.tsx",
  "lib/components/memory/WriteHealthStrip.tsx",
  "lib/components/memory/AvatarDialog.tsx",
  "lib/components/memory/host-status.ts",
  "lib/components/memory/shared-summary.ts",
  "lib/components/settings/IgnoreAllDialog.tsx",
  "lib/components/settings/DirectoryMapHost.tsx",
];

/** Messages passed to the translator, or written as a status line's `text`. */
function messages(path: string): string[] {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  const found = new Set<string>();
  for (const pattern of [/\bs\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g, /\btext:\s*"((?:[^"\\]|\\.)*)"/g]) {
    for (const match of source.matchAll(pattern)) {
      for (const group of match.slice(1)) if (group) found.add(group);
    }
  }
  // The state names in the status header.
  if (path.endsWith("HostStatusHeader.tsx")) {
    for (const match of source.matchAll(/^\s+(?:"[a-z-]+"|[a-z]+): "([^"]+)",$/gm))
      found.add(match[1]);
  }
  return [...found];
}

// A message that is only a value, a link or a CSS class needs no translation.
const skip = (message: string) =>
  message === "{reason}" ||
  /^https?:/.test(message) ||
  (/^[a-z-]+(\s[a-z-]+)*$/.test(message) && message.includes("-"));

it("has a Chinese and an Arabic text for every message the host views show", () => {
  const untranslated: string[] = [];
  for (const path of files) {
    for (const message of messages(path)) {
      if (skip(message)) continue;
      for (const language of ["zh", "ar"] as const) {
        if (translateSettings(message, language) === message) {
          untranslated.push(`${language}: ${message} (${path})`);
        }
      }
    }
  }
  expect(untranslated).toEqual([]);
});

it("keeps the placeholders of a status line in both languages", () => {
  for (const message of [
    "Importing {done} / {total}.",
    "Importing {done} / {total}. About {minutes} min left.",
    "Importing · {percent}%",
    "Paused · {pending} pending",
    "Stopped · {pending} pending",
    "Imported {date}",
    "Stopped: {error}",
    "Mode: {mode}",
    "On · {model}",
    "{saved} saved · {ignored} ignored",
    "Results {results} · Similarity {similarity}",
    "{pending} still waiting to import.",
    "Nothing was waiting before {date}. Use Sessions below for newer chats.",
  ]) {
    const names = message.match(/\{[a-z]+\}/g) ?? [];
    for (const language of ["zh", "ar"] as const) {
      const translated = translateSettings(message, language);
      for (const name of names) expect(`${language}: ${translated}`).toContain(name);
    }
  }
});

it("translates every title in the sidebar's Shared contents list", async () => {
  const { SHARED_ROWS, MEMORY_SECTIONS } = await import("../src/lib/memory-sections");
  for (const { title } of [...SHARED_ROWS, ...MEMORY_SECTIONS.filter((s) => s.id === "shared")]) {
    for (const language of ["zh", "ar"] as const) {
      expect(`${language}: ${translateSettings(title, language) === title}`).toBe(
        `${language}: false`
      );
    }
  }
});
