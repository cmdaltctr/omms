import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { memorySidebarSections } from "../src/lib/memory-sidebar";
import { SHARED_ROWS } from "../src/lib/memory-sections";

const looks = {
  pi: { kind: "default" as const },
  opencode: { kind: "default" as const },
  "claude-code": { kind: "default" as const },
};

it("gives every sidebar view an icon, Shared included", () => {
  const sections = memorySidebarSections("en", looks, false);
  expect(sections.map((section) => section.id)).toEqual([
    "pi",
    "opencode",
    "claude-code",
    "shared",
  ]);
  for (const section of sections) {
    expect(section.avatar, section.id).toBeTruthy();
  }
});

it("draws the Shared icon at the same size as the host avatars", () => {
  const sections = memorySidebarSections("en", looks, false);
  const frame = (id: string) =>
    renderToStaticMarkup(<>{sections.find((section) => section.id === id)!.avatar}</>);
  const sizeOf = (html: string) => html.match(/\bsize-\d+\b/)?.[0];
  expect(sizeOf(frame("shared"))).toBe("size-5");
  expect(sizeOf(frame("pi"))).toBe("size-5");
  expect(frame("shared")).toContain("lucide-layers");
  expect(frame("shared")).toContain('aria-hidden="true"');
});

it("marks only the hosts, not Shared, when memories cannot be saved", () => {
  const sections = memorySidebarSections("en", looks, true);
  expect(sections.map((section) => [section.id, Boolean(section.warning)])).toEqual([
    ["pi", true],
    ["opencode", true],
    ["claude-code", true],
    ["shared", false],
  ]);
});

it("lists the Shared rows under Shared only, in the chosen language", () => {
  const english = memorySidebarSections("en", looks, false);
  expect(
    english.find((section) => section.id === "shared")!.items?.map((item) => item.label)
  ).toEqual(SHARED_ROWS.map((row) => row.title));
  expect(english.filter((section) => section.items).map((section) => section.id)).toEqual([
    "shared",
  ]);
  const arabic = memorySidebarSections("ar", looks, false);
  expect(arabic.find((section) => section.id === "shared")!.items?.[0]!.label).not.toBe(
    SHARED_ROWS[0].title
  );
});
