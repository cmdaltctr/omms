import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DirectoryMapHost } from "../src/lib/components/settings/DirectoryMapHost.tsx";

const rows = [
  { directory: "/old/shared", sessions: 3, suggestion: "/main" },
  { directory: "/scratch", sessions: 2, suggestion: null },
  { directory: "", sessions: 4, suggestion: null },
];
const noop = () => {};
const render = (note?: { filled: number; alreadySelected: number; notFilled: number }) =>
  renderToStaticMarkup(
    <DirectoryMapHost
      host="pi"
      rows={rows}
      decisions={{ "/old/shared": { directory: "/old/shared", target: "/edited", accepted: true } }}
      busy={false}
      note={note}
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

it("explains missing suggestions in an accessible result", () => {
  const html = render({ filled: 0, alreadySelected: 0, notFilled: 2 });
  expect(html).toContain('role="status"');
  expect(html).toContain("Newly selected: 0");
  expect(html).toContain("Already selected: 0");
  expect(html).toContain("No suggestion: 2");
  expect(html).toContain("No suggested targets were selected.");
  expect(html).toContain("Choose targets for rows without suggestions.");
});

it("explains repeated Smart resolve and explicit saving", () => {
  const html = render({ filled: 0, alreadySelected: 1, notFilled: 1 });
  expect(html).toContain("Maps are already selected.");
  expect(html).toContain("Check them, then press Save maps.");
});
