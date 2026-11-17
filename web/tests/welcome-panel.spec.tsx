import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WelcomeView,
  showsWelcome,
  welcomeHosts,
} from "../src/lib/components/explorer/WelcomePanel.tsx";
import { MemoryList } from "../src/lib/components/explorer/MemoryList.tsx";

const noop = () => {};
const listProps = {
  memories: [],
  selectedIds: new Set<string>(),
  currentPage: 1,
  totalPages: 1,
  onSelect: noop,
  onPageChange: noop,
  onPin: noop,
  onUnpin: noop,
  onEdit: noop,
  onDeleteMemory: noop,
  onDeletePrompt: noop,
};

const notReady = {
  opencode: { ready: true, mode: "session", issues: [] },
  pi: { kind: "unready", issues: ["memoryModel is not configured"] },
  "claude-code": { ready: false, issues: ["memoryApiKey is not configured"] },
};

it("shows with total 0 and no filter, and hides with memories or a filter", () => {
  expect(showsWelcome({ totalItems: 0, isSearching: false })).toBe(true);
  expect(showsWelcome({ totalItems: 3, isSearching: false })).toBe(false);
  expect(showsWelcome({ totalItems: 0, isSearching: true })).toBe(false);
  expect(showsWelcome({ totalItems: 0, isSearching: false, activeKeyword: "bug" })).toBe(false);
  expect(showsWelcome({ totalItems: 0, isSearching: false, activeTag: "project:x" })).toBe(false);
});

it("mounts in the empty list and keeps the old line for a search with no results", () => {
  const empty = renderToStaticMarkup(
    <MemoryList {...listProps} totalItems={0} isSearching={false} />
  );
  expect(empty).toContain("Welcome to OMMS");
  expect(empty).not.toContain("No memories found");

  const searched = renderToStaticMarkup(
    <MemoryList {...listProps} totalItems={0} isSearching={true} />
  );
  expect(searched).toContain("No memories found");
  expect(searched).not.toContain("Welcome to OMMS");

  const keyword = renderToStaticMarkup(
    <MemoryList {...listProps} totalItems={0} isSearching={false} activeKeyword="bug" />
  );
  expect(keyword).toContain("No memories found");
  expect(keyword).not.toContain("Welcome to OMMS");
});

it("says in plain words that memories appear after the first sessions", () => {
  const html = renderToStaticMarkup(<WelcomeView hosts={welcomeHosts(notReady)} />);
  expect(html).toContain("Welcome to OMMS");
  expect(html).toContain("after your first");
});

it("lists one line per host with Ready or Needs setup and the reason", () => {
  const html = renderToStaticMarkup(<WelcomeView hosts={welcomeHosts(notReady)} />);
  expect(html).toContain("OpenCode");
  expect(html).toContain("Pi");
  expect(html).toContain("Claude Code");
  expect(html.match(/Ready/g)?.length).toBe(1);
  expect(html.match(/Needs setup/g)?.length).toBe(2);
  expect(html).toContain("Missing: model");
  expect(html).toContain("Missing: API key");
  expect(html).not.toContain("memoryModel");
  expect(html).not.toContain("memoryApiKey");
});

it("reads every host as ready when each one can capture", () => {
  const hosts = welcomeHosts({
    opencode: { ready: true, mode: "opencode", issues: [] },
    pi: { kind: "pi" },
    "claude-code": { ready: true, mode: "manual", issues: [] },
  });
  expect(hosts.map((host) => host.ready)).toEqual([true, true, true]);
  const html = renderToStaticMarkup(<WelcomeView hosts={hosts} />);
  expect(html).not.toContain("Needs setup");
});

it("links the External API card and says Claude Code capture needs it", () => {
  const html = renderToStaticMarkup(<WelcomeView hosts={welcomeHosts(notReady)} />);
  expect(html).toContain('href="/settings#settings-section-external-api"');
  expect(html).toContain("Claude Code capture needs the External API");
});

it("hides only the host list when the settings request fails", () => {
  const html = renderToStaticMarkup(<WelcomeView hosts={undefined} />);
  expect(html).toContain("Welcome to OMMS");
  expect(html).toContain('href="/settings#settings-section-external-api"');
  expect(html).not.toContain("Needs setup");
  expect(html).not.toContain("Can each tool save memories?");
});

it("uses the shared button as a link, not a raw button", () => {
  const html = renderToStaticMarkup(<WelcomeView hosts={welcomeHosts(notReady)} />);
  expect(html).not.toContain("<button");
});

// The 390 px layout and the project filter wiring in App.tsx have no check here:
// both need a real page. The browser check (task 8.7) covers them.
