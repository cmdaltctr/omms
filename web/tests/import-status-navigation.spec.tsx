import { expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import * as react from "react";
import type { ImportBadge } from "../src/lib/auto-import-settings.ts";
import { setLanguage } from "../src/lib/i18n/index.ts";

const hosts = ["pi", "opencode", "claude-code"] as const;
const counts = [39, 6, 2];
let states: unknown[] = [];
let cursor = 0;
mock.module("react", () => ({
  ...react,
  useEffect: () => {},
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useState: (initial: unknown) => [
    states[cursor++] ?? (typeof initial === "function" ? initial() : initial),
    () => {},
  ],
}));
const { ImportStatusBadge } = await import("../src/lib/components/settings/ImportStatusBadge.tsx");
const { HostImportBadges } = await import("../src/lib/components/settings/HostImportBadges.tsx");
const { DirectoryMapHost } = await import("../src/lib/components/settings/DirectoryMapHost.tsx");
const noop = () => {};

it("renders one real Partly imported link per host with the unchanged visible count", () => {
  states = [
    Object.fromEntries(
      hosts.map((host, i) => [
        host,
        {
          state: "done",
          counts: { imported: 10, skipped: 0, failed: 0, pending: 0, unresolved: counts[i] },
        },
      ])
    ),
    {},
  ];
  cursor = 0;
  const html = renderToStaticMarkup(<HostImportBadges />);
  hosts.forEach((host, i) => {
    expect(html).toContain(`href="#directory-maps-${host}"`);
    expect(html).toContain(`Partly imported (${counts[i]} unresolved)`);
  });
  expect(html.match(/<a /g)).toHaveLength(3);
});

it("keeps every other badge informational", () => {
  const badges: ImportBadge[] = [
    { kind: "imported" },
    { kind: "running" },
    { kind: "learning-profile", done: 1, total: 2 },
    { kind: "paused" },
    { kind: "stopped", pending: 2 },
    { kind: "failed", error: "Synthetic error" },
    { kind: "not-started" },
  ];
  for (const badge of badges) {
    const html = renderToStaticMarkup(<ImportStatusBadge badge={badge} host="pi" />);
    expect(html).toStartWith("<span");
    expect(html).not.toContain("href=");
  }
});

it("names the host and destination in each language without changing visible status wording", () => {
  for (const [language, destination] of [
    ["en", "Directory maps"],
    ["zh", "目录映射"],
    ["ar", "خرائط المجلدات"],
  ] as const) {
    setLanguage(language);
    const status = {
      en: "Partly imported (6 unresolved)",
      zh: "部分已导入 (6 未解析)",
      ar: "مستورد جزئياً (6 غير محلول)",
    }[language];
    for (const host of hosts) {
      const html = renderToStaticMarkup(
        <ImportStatusBadge badge={{ kind: "partly", unresolved: 6 }} host={host} />
      );
      const name = { pi: "Pi", opencode: "OpenCode", "claude-code": "Claude Code" }[host];
      expect(html).toContain(`aria-label="${name}: ${destination}`);
      expect(html).toContain(`>${status}</a>`);
    }
  }
  setLanguage("en");
});

it("anchors even an empty host list without expanding target editors", () => {
  for (const host of hosts) {
    const html = renderToStaticMarkup(
      <DirectoryMapHost
        host={host}
        rows={[]}
        decisions={{}}
        busy={false}
        onDecide={noop}
        onSelect={noop}
        onClear={noop}
        onResolve={noop}
      />
    );
    expect(html).toContain(`id="directory-maps-${host}"`);
    expect(html).toContain("No unresolved directories in the latest run.");
    expect(html).not.toMatch(/<details[^>]*\bopen[= >]/);
  }
});

it("retains both general Directory maps anchors", async () => {
  const { DirectoryMapsSection } =
    await import("../src/lib/components/settings/DirectoryMapsSection.tsx");
  states = [];
  cursor = 0;
  expect(renderToStaticMarkup(<DirectoryMapsSection />)).toContain('id="directory-maps"');
  const sections = readFileSync(
    new URL("../src/lib/settings-sections.ts", import.meta.url),
    "utf8"
  );
  expect(sections).toContain('id: "settings-section-directory-maps"');
});

it("reveals and focuses on every activation while preserving other hosts and drafts", async () => {
  const { revealDirectoryMaps } = await import("../src/lib/directory-map-navigation.ts");
  const other = { open: true };
  const targetEditor = { open: false };
  const decisions = { "/old": { target: "/edited", accepted: true } };
  const disclosure = { open: false };
  const focus = mock(() => {});
  const summary = { parentElement: disclosure, focus };
  const getElementById = mock((id: string) => (id === "directory-maps-pi" ? summary : null));
  const original = globalThis.document;
  Object.assign(globalThis, { document: { getElementById } });
  try {
    revealDirectoryMaps("pi");
    expect(disclosure.open).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    disclosure.open = false;
    revealDirectoryMaps("pi");
    expect(disclosure.open).toBe(true);
    expect(focus).toHaveBeenCalledTimes(2);
    expect(other.open).toBe(true);
    expect(targetEditor.open).toBe(false);
    expect(decisions).toEqual({ "/old": { target: "/edited", accepted: true } });
    revealDirectoryMaps("claude-code");
    expect(focus).toHaveBeenCalledTimes(2);
  } finally {
    Object.assign(globalThis, { document: original });
  }
});
