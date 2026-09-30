import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaudeFolderStatus } from "../src/lib/components/settings/ClaudeFolderSection.tsx";

it("shows the folder in use and says it comes from the setting", () => {
  const html = renderToStaticMarkup(
    <ClaudeFolderStatus
      folder={{ root: "/data/claude/projects", source: "setting", exists: true }}
    />
  );
  expect(html).toContain("/data/claude/projects");
  expect(html).toContain("this setting");
  expect(html).not.toContain("does not exist");
});

it("names the variable and the default as sources", () => {
  const fromEnv = renderToStaticMarkup(
    <ClaudeFolderStatus folder={{ root: "/env/claude/projects", source: "env", exists: true }} />
  );
  expect(fromEnv).toContain("the CLAUDE_CONFIG_DIR variable of the web app");
  const fromDefault = renderToStaticMarkup(
    <ClaudeFolderStatus
      folder={{ root: "/home/me/.claude/projects", source: "default", exists: true }}
    />
  );
  expect(fromDefault).toContain("the default folder");
});

it("warns and names the folder when it does not exist", () => {
  const html = renderToStaticMarkup(
    <ClaudeFolderStatus folder={{ root: "/missing/projects", source: "setting", exists: false }} />
  );
  expect(html).toContain('role="status"');
  expect(html).toContain("This folder does not exist.");
  expect(html.match(/\/missing\/projects/g)).toHaveLength(2);
});

it("shows no folder before the settings load", () => {
  expect(renderToStaticMarkup(<ClaudeFolderStatus />)).toBe("");
});
