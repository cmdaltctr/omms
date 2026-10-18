import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SharedView } from "../src/lib/components/memory/SharedView";
import { sharedSummaries } from "../src/lib/components/memory/shared-summary";
import { SHARED_ROWS, SHARED_ROW_IDS } from "../src/lib/memory-sections";
import { allSetUp, fakeStatuses } from "./fake-statuses";

it("shows the five shared rows in order, each collapsed, under a note that they apply to every host", () => {
  const html = renderToStaticMarkup(
    <SharedView statuses={fakeStatuses(allSetUp)} onReanalyse={() => {}} />
  );
  const positions = SHARED_ROW_IDS.map((id) => html.indexOf(`id="${id}"`));
  expect(positions.every((index) => index > 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(html.match(/<details id="shared-/g)).toHaveLength(5);
  expect(html).not.toMatch(/<details[^>]*\bopen[= >]/);
  expect(html).toContain("These settings apply to every host");
  for (const title of [
    "Profile learning",
    "Memory limits",
    "Keyword matching",
    "Reranker",
    "Directory maps",
  ]) {
    expect(html).toContain(title);
  }
});

it("keeps the shared sections out of the way of the host views", () => {
  const html = renderToStaticMarkup(
    <SharedView statuses={fakeStatuses(allSetUp)} onReanalyse={() => {}} />
  );
  // Per-host unresolved folders belong to the host views, not to Shared.
  expect(html).not.toContain("Unresolved directories");
  expect(html).toContain("Saved maps");
});

it("puts the current state of each row in its summary", () => {
  const summary = sharedSummaries(
    {
      maxMemories: { value: 10 },
      similarityThreshold: { value: 0.5 },
      keywordMode: { value: "hybrid" },
      rerankerApiUrl: { value: "http://127.0.0.1:9932/v1" },
      rerankerModel: { value: "qwen3-reranker" },
    },
    { saved: 84, ignored: 18 }
  );
  expect(summary.limits).toEqual({
    text: "Results {results} · Similarity {similarity}",
    params: { results: "10", similarity: "0.5" },
  });
  expect(summary.keywords).toEqual({ text: "Mode: {mode}", params: { mode: "hybrid" } });
  expect(summary.reranker).toEqual({ text: "On · {model}", params: { model: "qwen3-reranker" } });
  expect(summary.maps).toEqual({
    text: "{saved} saved · {ignored} ignored",
    params: { saved: 84, ignored: 18 },
  });
});

it("says the reranker is off when no service is set, and falls back before settings load", () => {
  expect(sharedSummaries({ rerankerApiUrl: { value: "" } }, undefined).reranker).toEqual({
    text: "Off",
  });
  const loading = sharedSummaries(undefined, undefined);
  expect(loading.limits.text).toBe("How many memories a search returns");
  expect(loading.keywords.text).toBe("Keyword matching");
  expect(loading.maps.text).toBe("Saved maps and ignored directories");
});

it("keeps the four-card switcher on the Shared view, with Shared marked as current", () => {
  const html = renderToStaticMarkup(
    <SharedView statuses={fakeStatuses(allSetUp)} onReanalyse={() => {}} />
  );
  const links = [...html.matchAll(/href="(\/memory\/[a-z-]+)"/g)].map((match) => match[1]);
  expect(links.slice(0, 4)).toEqual([
    "/memory/pi",
    "/memory/opencode",
    "/memory/claude-code",
    "/memory/shared",
  ]);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toMatch(
    /href="\/memory\/shared"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/memory\/shared"/
  );
  // The switcher comes before the first row.
  expect(html.indexOf('aria-label="Memory views"')).toBeLessThan(
    html.indexOf('id="shared-profile"')
  );
});

it("uses the same row titles as the sidebar's contents list", () => {
  const html = renderToStaticMarkup(
    <SharedView statuses={fakeStatuses(allSetUp)} onReanalyse={() => {}} />
  );
  const headings = [...html.matchAll(/<summary[^>]*><h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
  expect(headings).toEqual(SHARED_ROWS.map((row) => row.title));
});
