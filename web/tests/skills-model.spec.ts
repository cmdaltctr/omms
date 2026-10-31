import { afterEach, expect, it } from "bun:test";
import { pathForView, isAppPath, resolveAppPath, ROUTES, viewFromPath } from "../src/lib/routes.ts";
import { setLanguage } from "../src/lib/i18n/index.ts";
import { translations } from "../src/lib/i18n/translations.ts";
import { translateSettings } from "../src/lib/i18n/settings.ts";
import { skillText } from "../src/lib/i18n/skills.ts";
import { MAIN_NAV } from "../src/lib/components/explorer/sidebar-main-nav.tsx";
import { skillsCall, type SkillRow } from "../src/lib/skills-api.ts";
import {
  diffLines,
  fill,
  filterSkills,
  jobPercent,
  proposalLabel,
  recentProposals,
  recordedTurns,
  withFolder,
  withoutFolder,
} from "../src/lib/skills-model.ts";

afterEach(() => setLanguage("en"));

it("opens /skills directly and on reload, with or without a trailing slash", () => {
  expect(ROUTES.skills).toBe("/skills");
  expect(viewFromPath("/skills")).toBe("skills");
  expect(viewFromPath("/skills/")).toBe("skills");
  expect(pathForView("skills")).toBe("/skills");
  expect(isAppPath("/skills")).toBe(true);
  // A reload resolves the path again and must keep it, not fall back to project memories.
  expect(resolveAppPath("/skills")).toBe("/skills");
  expect(resolveAppPath("/skills/")).toBe("/skills");
});

it("lists Skills after User profile in the sidebar main list", () => {
  const views = MAIN_NAV.map((entry) => entry.view);
  expect(views).toEqual(["project", "chat", "profile", "skills"]);
});

it("translates the Skills entry in every language", () => {
  expect(translations.en["nav-skills"]).toBe("Skills");
  for (const language of ["zh", "ar"] as const) {
    const label = translations[language]["nav-skills"];
    expect(label).toBeTruthy();
    expect(label).not.toBe("Skills");
  }
});

it("gives every Skill learning message a Chinese and an Arabic translation", () => {
  for (const [message, [zh, ar]] of Object.entries(skillText)) {
    expect(zh, message).toBeTruthy();
    expect(ar, message).toBeTruthy();
    // Every {slot} in the English message survives translation.
    for (const slot of message.match(/\{\w+\}/g) ?? []) {
      expect(zh, message).toContain(slot);
    }
  }
  expect(translateSettings("Record agent turns", "zh")).not.toBe("Record agent turns");
  expect(translateSettings("Record agent turns", "ar")).not.toBe("Record agent turns");
});

const skill = (name: string, over: Partial<SkillRow> = {}): SkillRow => ({
  name,
  path: `/skills/${name}/SKILL.md`,
  notInWatchedFolder: false,
  uses: 1,
  failedTurns: 0,
  attention: 0.5,
  lastUsedAt: null,
  mode: "manual",
  suggested: false,
  ...over,
});

it("filters skills by name, ignoring case", () => {
  const skills = [skill("s-web-search"), skill("s-adr"), skill("Web-Scrape")];
  expect(filterSkills(skills, "web").map((item) => item.name)).toEqual([
    "s-web-search",
    "Web-Scrape",
  ]);
  expect(filterSkills(skills, "  ")).toHaveLength(3);
  expect(filterSkills(skills, "zzz")).toHaveLength(0);
});

it("labels an automatic apply apart from an apply by a person", () => {
  expect(proposalLabel({ state: "applied", appliedBy: "automatic" })).toBe("applied automatically");
  expect(proposalLabel({ state: "applied", appliedBy: "person" })).toBe("applied");
  expect(proposalLabel({ state: "applied", appliedBy: "agent" })).toBe("applied");
  for (const state of ["pending", "rejected", "stale", "undone"] as const) {
    expect(proposalLabel({ state, appliedBy: null })).toBe(state);
  }
});

it("classes diff lines by their first character", () => {
  const lines = diffLines("@@ -1,2 +1,2 @@\n keep\n-old\n+new");
  expect(lines.map((line) => line.kind)).toEqual(["hunk", "ctx", "del", "add"]);
});

it("adds a folder once and removes one by path", () => {
  expect(withFolder(["/a"], " /b ")).toEqual(["/a", "/b"]);
  expect(withFolder(["/a"], "/a")).toEqual(["/a"]);
  expect(withFolder(["/a"], "  ")).toEqual(["/a"]);
  expect(withoutFolder(["/a", "/b"], "/a")).toEqual(["/b"]);
});

it("fills message slots and keeps an unknown slot visible", () => {
  expect(fill("Recorded {count} past turns.", { count: 340 })).toBe("Recorded 340 past turns.");
  expect(fill("{a} {b}", { a: 1 })).toBe("1 {b}");
});

it("counts recorded turns from the job total or its hosts", () => {
  expect(recordedTurns({ state: "done", summary: { skillTurnsRecorded: 7 } })).toBe(7);
  expect(
    recordedTurns({
      state: "done",
      hosts: [{ summary: { skillTurnsRecorded: 2 } }, { summary: { skillTurnsRecorded: 3 } }],
    })
  ).toBe(5);
  expect(jobPercent({ processed: 50, total: 200 })).toBe(25);
  expect(jobPercent({})).toBe(0);
});

it("keeps the saved content of a refused undo", async () => {
  Object.assign(globalThis, {
    window: {},
    fetch: async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: "changed",
          error: "File changed",
          savedContent: "old text",
        }),
        { status: 409 }
      ),
  });
  const reply = await skillsCall("/api/skills/undo", { id: "p1" });
  expect(reply).toMatchObject({ ok: false, code: "changed", savedContent: "old text" });
});

it("keeps the 20 most recently changed proposals that are not pending", () => {
  const list = Array.from({ length: 25 }, (_, i) => ({
    id: `p${i}`,
    state: i === 3 ? ("pending" as const) : ("rejected" as const),
    updatedAt: i,
  }));
  const recent = recentProposals(list);
  expect(recent).toHaveLength(20);
  expect(recent[0]!.id).toBe("p24");
  expect(recent.some((p) => p.state === "pending")).toBe(false);
});
