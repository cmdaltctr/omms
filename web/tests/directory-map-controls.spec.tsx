import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DirectoryMapHost } from "../src/lib/components/settings/DirectoryMapHost.tsx";

const rows = [
  { directory: "/old/shared", sessions: 3, suggestion: "/main" },
  { directory: "/scratch", sessions: 2, suggestion: null },
  { directory: "", sessions: 4, suggestion: null },
];
const noop = () => {};
const render = () =>
  renderToStaticMarkup(
    <DirectoryMapHost
      host="pi"
      rows={rows}
      decisions={{ "/old/shared": { directory: "/old/shared", target: "/edited", accepted: true } }}
      busy={false}
      onDecide={noop}
      onSelect={noop}
      onClear={noop}
      onResolve={noop}
    />
  );

it("renders collapsed host and row disclosures, with controls outside summaries", () => {
  const html = render();
  expect(html.match(/<details/g)?.length).toBe(3);
  expect(html).not.toMatch(/<details[^>]*\bopen[= >]/);
  expect(html).toContain("Directories: 2");
  expect(html).toContain("Unresolved sessions: 9");
  expect(html).toContain("Selected maps: 1");
  expect(html).toContain("Select all with targets");
  expect(html).toContain("Clear selection");
  expect(html).toContain("[&amp;_button]:whitespace-normal");
  expect(html).toContain('value="/edited"');
  expect(html).toContain('dir="ltr"');
  for (const summary of html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)) {
    expect(summary[1]).not.toMatch(/<button|<input/);
  }
  expect(html.match(/type="checkbox"/g)?.length).toBe(2);
});

it("explains review and confirmation while retaining manual selection controls", () => {
  const html = render();
  expect(html).toContain("Review suggested directory maps in a dialog.");
  expect(html).toContain("Nothing is saved until you press Confirm.");
  expect(html).toContain("Save maps remains available for manual selections.");
  expect(html).toContain("No target chosen");
  expect(html).toContain("These sessions cannot be mapped.");
});
