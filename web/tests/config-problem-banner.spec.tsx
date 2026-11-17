import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfigProblemBanner } from "../src/lib/components/settings/ConfigProblemBanner.tsx";

const syntax = { file: "~/.config/omms/omms.jsonc", line: 7, column: 3 };
const LEAD =
  "Your OMMS settings file has an error, so until you fix it OMMS uses the last settings it could read, or its defaults if it has none.";

it("shows nothing when there is no problem", () => {
  expect(renderToStaticMarkup(<ConfigProblemBanner problems={[]} />)).toBe("");
});

it("leads with one plain sentence, then names the file, line and column once as small text", () => {
  const html = renderToStaticMarkup(<ConfigProblemBanner problems={[syntax]} readOnly />);
  expect(html).toContain(LEAD);
  expect(html.indexOf(LEAD)).toBeLessThan(html.indexOf("omms.jsonc"));
  expect(html.split("~/.config/omms/omms.jsonc")).toHaveLength(2);
  expect(html).toContain("line 7, column 3");
});

it("says that saving is off while the file cannot be read", () => {
  const html = renderToStaticMarkup(<ConfigProblemBanner problems={[syntax]} readOnly />);
  expect(html).toContain("Saving is turned off");
  // The cards show what the host uses now, so no value reads as a default it is not.
  expect(html).toContain("The cards below show the last settings OMMS could read.");
  const soft = renderToStaticMarkup(<ConfigProblemBanner problems={[syntax]} />);
  expect(soft).not.toContain("Saving is turned off");
  // A rejected value uses its default or turns its feature off: it does not keep old settings.
  expect(soft).not.toContain("keeps the last good settings");
});

it("names the key and the values it accepts", () => {
  const html = renderToStaticMarkup(
    <ConfigProblemBanner
      problems={[
        {
          file: "~/.config/omms/omms.jsonc",
          key: "autoCleanupRetentionDays",
          accepted: "whole numbers of 1 or more",
        },
      ]}
    />
  );
  expect(html).toContain("autoCleanupRetentionDays");
  expect(html).toContain("whole numbers of 1 or more");
  expect(html).toContain("default");
  expect(html).not.toContain("line ");
});

it("leads with a plain sentence and shows the key as secondary text", () => {
  const html = renderToStaticMarkup(
    <ConfigProblemBanner
      problems={[
        {
          file: "~/.config/omms/omms.jsonc",
          line: 4,
          key: "maxMemories",
          accepted: "positive safe integers",
        },
      ]}
    />
  );
  // The setting's plain name comes before the key.
  expect(html.indexOf("has a value OMMS cannot use")).toBeGreaterThan(-1);
  expect(html.indexOf("has a value OMMS cannot use")).toBeLessThan(html.indexOf("maxMemories"));
  expect(html).toContain("whole numbers of 1 or more");
  expect(html).not.toContain("positive safe integers");
  expect(html).toContain("line 4");
});

it("says which feature is off for a fail-safe key", () => {
  const html = renderToStaticMarkup(
    <ConfigProblemBanner
      problems={[
        {
          file: "~/.config/omms/omms.jsonc",
          key: "autoCleanupRetentionDays",
          accepted: "whole numbers of 1 or more",
          off: "autoDeleteOldMemories",
        },
      ]}
    />
  );
  expect(html).toContain("is off until you fix it");
  expect(html).not.toContain("uses the default");
});

it("translates the accepted values on the Chinese and Arabic pages", async () => {
  const { setLanguage } = await import("../src/lib/i18n/index.ts");
  const problem = {
    file: "~/.config/omms/omms.jsonc",
    key: "retrievalMaxTokens",
    accepted: "integers from 256 to 65536",
  };
  for (const language of ["zh", "ar"] as const) {
    setLanguage(language);
    const html = renderToStaticMarkup(<ConfigProblemBanner problems={[problem]} />);
    expect(html).not.toContain("integers from");
    expect(html).toContain("256");
    expect(html).toContain("65536");
  }
  setLanguage("en");
});

it("keeps the file path left to right", () => {
  expect(renderToStaticMarkup(<ConfigProblemBanner problems={[syntax]} />)).toContain('dir="ltr"');
});

it("prints no empty file name when a problem names no file", () => {
  const html = renderToStaticMarkup(
    <ConfigProblemBanner
      problems={[
        { file: "", key: "autoCleanupRetentionDays", accepted: "whole numbers of 1 or more" },
      ]}
    />
  );
  expect(html).not.toContain("<bdi");
  expect(html).toContain("autoCleanupRetentionDays");
});

it("leads with the same sentence for a file problem with no line, and names the file", () => {
  const html = renderToStaticMarkup(
    <ConfigProblemBanner problems={[{ file: "~/.config/omms/omms.jsonc" }]} readOnly />
  );
  expect(html).toContain(LEAD);
  expect(html).toContain("~/.config/omms/omms.jsonc");
  expect(html).not.toContain("column");
});
