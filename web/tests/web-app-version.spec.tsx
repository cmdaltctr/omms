import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VersionNotice } from "../src/lib/components/settings/WebAppSection.tsx";
import { versionNotice } from "../src/lib/external-api-settings.ts";

const render = (info: Parameters<typeof VersionNotice>[0]["info"]) =>
  renderToStaticMarkup(<VersionNotice info={info} />);

it("says a newer copy runs in place of an older global install, which is optional", () => {
  const info = { running: "4.3.2", global: "4.3.0", relation: "older" as const };
  expect(versionNotice(info)).toEqual({
    kind: "older",
    command: "npx -p om-memory-system@latest om-memory-system web update",
  });
  const html = render(info);
  expect(html).toContain("4.3.2");
  expect(html).toContain("4.3.0");
  expect(html).toContain("runs in place of the global install");
  expect(html).toContain("optional");
  expect(html).toContain("npx -p om-memory-system@latest om-memory-system web update");
});

it("warns that a newer global install is replaced at the next host start", () => {
  const info = { running: "4.3.0", global: "4.3.2", relation: "newer" as const };
  expect(versionNotice(info)).toEqual({ kind: "newer", command: null });
  const html = render(info);
  expect(html).toContain("newer than the running OMMS");
  // Claude Code also replaces an older web app at session start (hook-client.ts replaceOlderFor).
  expect(html).toContain("next OpenCode, Pi or Claude Code session start");
  expect(html).not.toContain("npm i -g");
  expect(html).not.toContain("web update");
});

it("says OMMS is not installed globally and that this is fine", () => {
  const info = { running: "4.3.2", global: null, relation: "missing" as const };
  expect(versionNotice(info)).toEqual({ kind: "missing", command: null });
  const html = render(info);
  expect(html).toContain("not installed globally");
  expect(html).toContain("optional");
  expect(html).not.toContain("web update");
});

it("shows only the versions when they match or cannot be compared", () => {
  for (const relation of ["same", "unknown"] as const) {
    const info = { running: "4.3.2", global: "4.3.2", relation };
    expect(versionNotice(info).command).toBeNull();
    const html = render(info);
    expect(html).toContain("4.3.2");
    expect(html).not.toContain("web update");
    expect(html).not.toContain("optional");
  }
});
