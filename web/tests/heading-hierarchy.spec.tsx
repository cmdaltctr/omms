import { expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { t } from "../src/lib/i18n/index.ts";
import { translateSettings } from "../src/lib/i18n/settings.ts";
import type { Lang } from "../src/lib/i18n/translations.ts";
import type { AppView } from "../src/lib/routes.ts";
import { ProfileView } from "../src/lib/components/explorer/ProfileView.tsx";
import { DirectoryMapHost } from "../src/lib/components/settings/DirectoryMapHost.tsx";
import { fixtureResponse } from "./visual/fixtures.ts";
import type { UserProfile } from "../src/lib/types.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

it("defines relative 24/18/15/14px roles and styles stored Markdown headings as bold muted uppercase labels", () => {
  const css = source("app.css");
  for (const [role, size] of [
    ["page-title", "1.5rem"],
    ["section-title", "1.125rem"],
    ["subsection-title", "0.9375rem"],
    ["ui", "0.875rem"],
  ]) {
    expect(css).toContain(`--text-${role}: ${size};`);
  }
  const settings = source("lib/components/settings/settings.css");
  expect(settings).not.toMatch(/\.settings-view h2\s*\{/);
  expect(settings).toContain("font-size: 0.875rem;");
  expect(css).not.toMatch(/(?:^|\n)\s*h[123]\s*\{/);
  expect(css).toContain(".markdown-content {\n  line-height: 1.6;");
  expect(css).toMatch(
    /\.markdown-content :is\(h1, h2, h3, h4, h5, h6\) \{[^}]*font-size: var\(--text-ui\);[^}]*font-weight: 700;[^}]*color: var\(--muted-foreground\);[^}]*text-transform: uppercase;/
  );
  const card = source("lib/components/explorer/MemoryCard.tsx");
  expect(card).toContain("renderMarkdown(");
  expect(card).not.toContain("text-section-title");
  expect(card).not.toMatch(/<h[123]/);
});

it("keeps the application page title and gives Settings cards shared section roles", () => {
  const app = source("App.tsx");
  expect(app.match(/<h1\b/g)).toHaveLength(1);
  expect(app).toMatch(/<h1\b[\s\S]*?text-page-title font-semibold text-foreground/);
  expect(app).toContain('<h2 className="text-section-title font-semibold');
  const folder = new URL("../src/lib/components/settings/", import.meta.url);
  for (const file of readdirSync(folder).filter((name) => name.endsWith(".tsx"))) {
    const text = readFileSync(new URL(file, folder), "utf8");
    for (const heading of text.matchAll(/<h([23])\s+className="([^"]+)"/g)) {
      expect(heading[2]).toContain(
        heading[1] === "2" ? "text-section-title" : "text-subsection-title"
      );
      expect(heading[2]).toContain("font-semibold");
    }
  }
});

// Render the owning H1 without mounting unrelated data-loading views or mocking translations.
function pageHeading(currentView: AppView, language: Lang) {
  const heading = source("App.tsx").match(/<h1\b[\s\S]*?<\/h1>/)?.[0];
  expect(heading).toBeDefined();
  const { outputText } = ts.transpileModule(`return (${heading});`, {
    compilerOptions: { jsx: ts.JsxEmit.React },
    fileName: "heading.tsx",
  });
  const render = new Function(
    "React",
    "currentView",
    "language",
    "t",
    "translateSettings",
    outputText
  );
  const element = render(
    React,
    currentView,
    language,
    (key: string) => t(key, {}, language),
    translateSettings
  ) as React.ReactElement<{ className: string; children: string }>;
  expect(element.type).toBe("h1");
  expect(element.props.className.split(/\s+/)).toEqual(
    expect.arrayContaining(["text-page-title", "font-semibold", "text-foreground"])
  );
  expect(renderToStaticMarkup(element)).toContain("<h1");
  return element.props;
}

for (const [view, label] of [
  ["memory", "Memory"],
  ["settings", "Settings"],
] as const) {
  it(`presents the English ${view} H1 in uppercase while keeping semantic text`, () => {
    const heading = pageHeading(view, "en");
    expect(heading.children).toBe(label);
    expect(heading.className.split(/\s+/)).toContain("uppercase");
  });
}

for (const [view, key] of [
  ["project", "tab-project"],
  ["profile", "tab-profile"],
] as const) {
  it(`keeps the ${view} H1 casing unchanged in every language`, () => {
    for (const language of ["en", "zh", "ar"] as const) {
      const heading = pageHeading(view, language);
      expect(heading.children).toBe(t(key, {}, language));
      expect(heading.className.split(/\s+/)).not.toContain("uppercase");
    }
  });
}

for (const language of ["zh", "ar"] as const) {
  for (const view of ["memory", "settings"] as const) {
    it(`keeps the ${language} ${view} H1 translation and casing unchanged`, () => {
      const heading = pageHeading(view, language);
      expect(heading.children).toBe(
        view === "memory" ? translateSettings("Memory", language) : t("nav-settings", {}, language)
      );
      expect(heading.className.split(/\s+/)).not.toContain("uppercase");
    });
  }
}

it("renders Profile identity and sections at H2 and workflows as pattern-style cards with blue step pills", () => {
  const profile = (fixtureResponse("GET", "/api/user-profile").body as { data: UserProfile }).data;
  const html = renderToStaticMarkup(<ProfileView profile={profile} />);
  expect(html.match(/<h2\b/g)).toHaveLength(4);
  expect(html).not.toMatch(/<h4\b/);
  expect(html).not.toMatch(/<h3\b/);
  expect(html).toContain("Check the shared visual controls");
  expect(html).toMatch(
    /<ol class="[^"]*flex-col[^"]*"><li class="[^"]*bg-blue-500\/15[^"]*"><span class="[^"]*bg-blue-500\/30[^"]*">1<\/span>/
  );
  expect(html).not.toContain("lucide-arrow-right");
  expect(html).toMatch(/<div class="grid items-start gap-3 lg:grid-cols-2">/);
  expect(html).toMatch(/--category-hue:\d+[^>]*>UI<\/span>/);
  expect(html).toMatch(/--category-hue:\d+[^>]*>Preview<\/span>/);
  expect(html).toContain("Keep helper text visible.");
  expect(html).toMatch(/<p class="text-sm break-words">/);
  expect(html).not.toMatch(/<h[23][^>]*>UI<\/h[23]>/);
  expect(html).toContain('id="profile-preferences"');
  expect(html).toContain('id="profile-patterns"');
  expect(html).toContain('id="profile-workflows"');
});

it("keeps cleanup diff titles directly below the dialog H2 at H3", () => {
  const cleanup = source("lib/components/explorer/AiCleanupDialog.tsx");
  expect(cleanup).not.toMatch(/<h4\b/);
  const groups = [...cleanup.matchAll(/<h3 className="([^"]+)">\s*<(?:GitMerge|Trash2)\b/g)];
  expect(groups).toHaveLength(2);
  for (const group of groups) {
    expect(group[1]).toContain("text-subsection-title");
    expect(group[1]).toContain("font-semibold");
  }
});

it("uses an H3 host title inside the summary and an H2 section-sized accessible dialog title", () => {
  const noop = () => {};
  const html = renderToStaticMarkup(
    <DirectoryMapHost
      host="pi"
      rows={[]}
      decisions={{}}
      busy={false}
      onDecide={noop}
      onResolve={noop}
      onSelect={noop}
      onClear={noop}
    />
  );
  expect(html).toMatch(
    /<summary[^>]*><h3 class="[^"]*text-subsection-title[^>]*>Pi: Unresolved directories<\/h3>/
  );
  const dialog = source("lib/components/ui/dialog.tsx");
  expect(dialog).toContain("<DialogPrimitive.Title");
  expect(dialog).toContain('className={cn("text-section-title font-semibold", className)}');
  expect(dialog).not.toContain("text-page-title");
});
