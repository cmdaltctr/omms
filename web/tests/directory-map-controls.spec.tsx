import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DirectoryMapHost } from "../src/lib/components/settings/DirectoryMapHost.tsx";
import type { SuggestedDirectory } from "../src/lib/directory-maps.ts";

const rows: SuggestedDirectory[] = [
  {
    directory: "/old/shared",
    sessions: 3,
    suggestion: { kind: "map", target: "/main", confidence: "name" },
  },
  { directory: "/tmp/scratch", sessions: 2, suggestion: { kind: "ignore", reason: "temporary" } },
  { directory: "/old/notes", sessions: 1, suggestion: null },
  { directory: "", sessions: 4, suggestion: null },
];
const noop = () => {};
const render = () =>
  renderToStaticMarkup(
    <DirectoryMapHost
      host="pi"
      rows={rows}
      decisions={{ "/old/shared": { directory: "/old/shared", target: "/edited" } }}
      busy={false}
      onDecide={noop}
      onResolve={noop}
      onIgnore={noop}
    />
  );

it("renders collapsed host and row disclosures, with controls outside summaries", () => {
  const html = render();
  expect(html.match(/<details/g)?.length).toBe(4);
  expect(html).not.toMatch(/<details[^>]*\bopen[= >]/);
  expect(html).toContain("Directories: 3");
  expect(html).toContain("Unresolved sessions: 10");
  expect(html).toContain("Rows with a target: 1");
  expect(html).toContain("Smart resolve directories");
  expect(html).toContain("[&amp;_button]:whitespace-normal");
  expect(html).toContain('value="/edited"');
  expect(html).toContain('dir="ltr"');
  for (const summary of html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)) {
    expect(summary[1]).not.toMatch(/<button|<input/);
  }
});

it("has no selection controls and offers Ignore on each row with a directory", () => {
  const html = render();
  expect(html).not.toContain('type="checkbox"');
  expect(html).not.toContain("Select all with targets");
  expect(html).not.toContain("Clear selection");
  expect(html).not.toContain("Save maps");
  expect(html.match(/>Ignore</g)?.length).toBe(3);
  expect(html).toContain("Suggested to ignore: Temporary folder");
  expect(html).toContain("No target chosen");
  expect(html).toContain("These sessions cannot be mapped.");
  expect(html).toContain("Nothing is saved before that.");
});
