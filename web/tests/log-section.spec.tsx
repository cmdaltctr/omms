import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LogPanel } from "../src/lib/components/settings/LogPanel.tsx";
import { LogSection } from "../src/lib/components/settings/LogSection.tsx";
import { translateSettings } from "../src/lib/i18n/settings.ts";
import {
  isFollowing,
  logQuery,
  recordsToText,
  shortTime,
  type LogRecord,
} from "../src/lib/log-records.ts";

const T = "2026-10-18T18:36:51.802+01:00";
const record = (over: Partial<LogRecord>): LogRecord => ({
  seq: 0,
  time: T,
  level: "info",
  guessed: false,
  message: "Capture attempt",
  data: null,
  ...over,
});

it("asks for the level and capture filters the server understands", () => {
  expect(logQuery("all", false)).toBe("/api/settings/log?lines=200");
  expect(logQuery("warn", false)).toBe("/api/settings/log?lines=200&level=warn");
  expect(logQuery("error", true)).toBe("/api/settings/log?lines=200&level=error&filter=capture");
});

it("shortens an ISO time and leaves other text alone", () => {
  expect(shortTime(T)).toBe("10-18 18:36:51");
  expect(shortTime("")).toBe("");
});

it("copies the shown records one per line", () => {
  const text = recordsToText([
    record({ level: "error", message: "addMemory: error", data: '{"error":"500"}' }),
    record({ seq: 1, level: "error", message: "two\nlines" }),
  ]);
  expect(text).toBe(`${T} ERROR addMemory: error: {"error":"500"}\n${T} ERROR two lines`);
});

it("follows the newest record only while the reader is at the bottom", () => {
  expect(isFollowing({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 })).toBe(true);
  expect(isFollowing({ scrollHeight: 1000, scrollTop: 100, clientHeight: 300 })).toBe(false);
});

it("shows each level as text with its own badge colour", () => {
  const html = renderToStaticMarkup(
    <LogPanel
      label="Log lines"
      emptyText="empty"
      records={[
        record({ seq: 0, level: "info", message: "routine" }),
        record({ seq: 1, level: "warn", message: "fell back" }),
        record({ seq: 2, level: "error", message: "boom", data: '{"error":"x"}' }),
      ]}
    />
  );
  expect(html).toMatch(/text-status-info[^>]*>info</);
  expect(html).toMatch(/text-status-warning[^>]*>warn</);
  expect(html).toMatch(/text-destructive-label[^>]*>error</);
  expect(html).toContain("boom");
  expect(html).toContain("{&quot;error&quot;:&quot;x&quot;}");
  expect(html).toContain('aria-label="Log lines"');
  expect(html).not.toContain("Level guessed");
});

it("says that a guessed level is guessed, for readers and for the tooltip", () => {
  const html = renderToStaticMarkup(
    <LogPanel
      label="Log lines"
      emptyText="empty"
      records={[record({ level: "error", guessed: true, message: "Failed to start" })]}
    />
  );
  expect(html).toContain('class="sr-only"');
  expect(html).toContain("Level guessed from the message");
  expect(html).toContain('role="tooltip"');
});

it("shows the empty text when there are no records", () => {
  const html = renderToStaticMarkup(
    <LogPanel label="Log lines" emptyText="No log has been written yet." records={[]} />
  );
  expect(html).toContain("No log has been written yet.");
  expect(html).not.toContain("<ol");
});

it("opens with every level shown, polling controls and no stale path button", () => {
  const html = renderToStaticMarkup(<LogSection />);
  expect(html).toMatch(/aria-pressed="true"[^>]*>All</);
  expect(html).toMatch(/aria-pressed="false"[^>]*>Warning</);
  expect(html).toMatch(/aria-pressed="false"[^>]*>Error</);
  expect(html).toContain("Pause");
  expect(html).toContain("Refresh");
  expect(html).toContain("Copy visible records");
  expect(html).toContain("Capture attempts only");
  expect(html).toContain("Loading log…");
  expect(html).not.toContain("Copy log path");
});

it("has Chinese and Arabic text for every new message", () => {
  const messages = [
    "Level",
    "All",
    "Warning",
    "Error",
    "info",
    "warn",
    "error",
    "Pause",
    "Resume",
    "Paused",
    "Level guessed from the message",
    "Copy visible records",
    "Copied",
    "No matching log records.",
  ];
  for (const message of messages) {
    expect(translateSettings(message, "zh")).not.toBe(message);
    expect(translateSettings(message, "ar")).not.toBe(message);
  }
});
