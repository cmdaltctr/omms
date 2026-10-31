import { afterEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { keywordHue } from "../src/lib/components/explorer/KeywordBadge.tsx";
import { formatDate } from "../src/lib/format.ts";
import { ModifiedFilterControl } from "../src/lib/components/skills/ModifiedFilterControl.tsx";
import { ModifiedMark } from "../src/lib/components/skills/ModifiedMark.tsx";
import { SkillList } from "../src/lib/components/skills/SkillList.tsx";
import { SkillsPage } from "../src/lib/components/skills/SkillsView.tsx";
import { sortItems } from "../src/lib/components/paged-list/paging.ts";
import type { SkillRow, SkillsOverview } from "../src/lib/skills-api.ts";
import {
  MODIFIED_FILTER_KEY,
  applyModifiedFilter,
  modifiedCounts,
  readModifiedFilter,
  saveModifiedFilter,
} from "../src/lib/skills-modified.ts";
import { SKILL_SORTS } from "../src/lib/skills-sorts.ts";

const APPLIED = Date.UTC(2026, 9, 20, 9, 30);
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
  modified: false,
  lastAppliedAt: null,
  ...over,
});
const modified = (name: string, at = APPLIED) => skill(name, { modified: true, lastAppliedAt: at });
const folders = [{ path: "/skills", skills: 4, exists: true }];

describe("counts and filter", () => {
  const list = [
    skill("a"),
    modified("b"),
    skill("c", { suggested: true }),
    skill("d", { modified: true, lastAppliedAt: APPLIED, suggested: true }),
  ];

  it("counts all, not modified, modified and suggested from the whole list", () => {
    expect(modifiedCounts(list)).toEqual({ all: 4, "not-modified": 2, modified: 2, suggested: 2 });
    expect(modifiedCounts([])).toEqual({ all: 0, "not-modified": 0, modified: 0, suggested: 0 });
  });

  it("keeps every skill, only the unmodified, or only the modified", () => {
    const names = (f: Parameters<typeof applyModifiedFilter>[1]) =>
      applyModifiedFilter(list, f).map((s) => s.name);
    expect(names("all")).toEqual(["a", "b", "c", "d"]);
    expect(names("not-modified")).toEqual(["a", "c"]);
    expect(names("modified")).toEqual(["b", "d"]);
    expect(names("suggested")).toEqual(["c", "d"]);
  });
});

describe("saved choice", () => {
  const saved = (globalThis as { localStorage?: unknown }).localStorage;
  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = saved;
  });
  const store = (initial: Record<string, string> = {}) => {
    const data = { ...initial };
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => void (data[k] = v),
    };
    return data;
  };

  it("round-trips each choice under omms-skills-modified-filter", () => {
    const data = store();
    expect(MODIFIED_FILTER_KEY).toBe("omms-skills-modified-filter");
    for (const choice of ["all", "not-modified", "modified", "suggested"] as const) {
      saveModifiedFilter(choice);
      expect(data[MODIFIED_FILTER_KEY]).toBe(choice);
      expect(readModifiedFilter()).toBe(choice);
    }
  });

  it("reads All when nothing, or something unknown, is saved", () => {
    store();
    expect(readModifiedFilter()).toBe("all");
    store({ [MODIFIED_FILTER_KEY]: "recent" });
    expect(readModifiedFilter()).toBe("all");
  });

  it("works without storage", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readModifiedFilter()).toBe("all");
    expect(() => saveModifiedFilter("modified")).not.toThrow();
  });
});

describe("Last modified sort", () => {
  const option = SKILL_SORTS.find((o) => o.value === "lastModified")!;

  it("is offered, newest first, with no apply time last", () => {
    expect(option).toBeDefined();
    expect(option.label).toBe("Last modified");
    expect(option.first).toBe("desc");
    const rows = [skill("none"), modified("old", 1000), modified("new", 9000), skill("none2")];
    const names = sortItems(rows, option.compare, "desc", option.last).map((s) => s.name);
    expect(names).toEqual(["new", "old", "none", "none2"]);
  });

  it("keeps unmodified skills last when sorted oldest first", () => {
    const rows = [skill("none"), modified("new", 9000), skill("none2"), modified("old", 1000)];
    const names = sortItems(rows, option.compare, "asc", option.last).map((s) => s.name);
    expect(names).toEqual(["old", "new", "none", "none2"]);
  });

  it("keeps never-used skills last in both directions of Last used", () => {
    const used = SKILL_SORTS.find((o) => o.value === "lastUsed")!;
    const rows = [
      skill("never"),
      skill("recent", { lastUsedAt: 9000 }),
      skill("never2"),
      skill("early", { lastUsedAt: 1000 }),
    ];
    const run = (order: "asc" | "desc") =>
      sortItems(rows, used.compare, order, used.last).map((s) => s.name);
    expect(run("asc")).toEqual(["early", "recent", "never", "never2"]);
    expect(run("desc")).toEqual(["recent", "early", "never", "never2"]);
  });
});

describe("the tick", () => {
  it("shows a green check with Modified on {date} as tooltip and for screen readers", () => {
    const html = renderToStaticMarkup(<ModifiedMark at={APPLIED} />);
    const text = `Modified on ${formatDate(APPLIED)}`;
    expect(html).toContain(`role="tooltip"`);
    expect(html.split(text)).toHaveLength(3); // sr-only text and tooltip
    expect(html).toContain("sr-only");
    expect(html).toContain("text-status-success");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("marks only modified skills in the ranked list", () => {
    const html = renderToStaticMarkup(
      <SkillList skills={[modified("alpha"), skill("beta")]} folders={folders} onOpen={() => {}} />
    );
    expect(html.match(/Modified on /g)).toHaveLength(2); // one mark: tooltip plus sr-only
    expect(html.indexOf("Modified on")).toBeGreaterThan(html.indexOf("alpha"));
    expect(html.indexOf("Modified on")).toBeLessThan(html.indexOf("beta"));
  });
});

describe("the control", () => {
  const counts = { all: 273, "not-modified": 270, modified: 3, suggested: 5 };
  const render = (value: "all" | "not-modified" | "modified" | "suggested") =>
    renderToStaticMarkup(
      <ModifiedFilterControl value={value} counts={counts} onChange={() => {}} />
    );

  it("is a radio group of All, Not modified and Modified with live counts", () => {
    const html = render("all");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("All (273)");
    expect(html).toContain("Not modified (270)");
    expect(html).toContain("Modified (3)");
    expect(html).toContain("Suggested (5)");
    expect(html.match(/role="radio"/g)).toHaveLength(4);
  });

  it("colours Modified green and Not modified blue, chosen or not", () => {
    for (const value of ["all", "modified", "not-modified"] as const) {
      const html = render(value);
      const button = (label: string) =>
        html.split("<button").find((part) => part.includes(label)) ?? "";
      expect(button("Modified (3)")).toContain("text-status-success");
      expect(button("Not modified (270)")).toContain("text-status-info");
      expect(button("All (273)")).not.toContain("text-status-");
    }
    // The chosen one is stronger than the idle one.
    expect(render("modified")).toContain("bg-status-success/20");
    expect(render("all")).not.toContain("bg-status-success/20");
    expect(render("not-modified")).toContain("bg-status-info/20");
  });

  it("gives Suggested the hue of the Suggested pill, chosen or not", () => {
    const hue = keywordHue("Suggested");
    for (const value of ["all", "suggested"] as const) {
      const html = render(value);
      const part = html.split("<button").find((p) => p.includes("Suggested (5)")) ?? "";
      expect(part).toContain(`oklch(0.72 0.14 ${hue}`);
    }
    // The chosen one is stronger than the idle one.
    const alpha = (html: string) =>
      /oklch\(0\.72 0\.14 \d+ \/ ([0-9.]+)\)/.exec(
        html.split("<button").find((p) => p.includes("Suggested (5)")) ?? ""
      )?.[1];
    expect(Number(alpha(render("suggested")))).toBeGreaterThan(Number(alpha(render("all"))));
  });

  it("makes the chosen option checked and the only tab stop", () => {
    const html = render("modified");
    const buttons = html.match(/<button[^>]*>/g)!;
    expect(buttons[0]).toContain('aria-checked="false"');
    expect(buttons[0]).toContain('tabindex="-1"');
    expect(buttons[2]).toContain('aria-checked="true"');
    expect(buttons[2]).toContain('tabindex="0"');
  });
});

describe("the page", () => {
  const overview = (skills: SkillRow[]): SkillsOverview => ({ recording: true, skills, folders });
  const page = (
    skills: SkillRow[],
    filter: "all" | "not-modified" | "modified" | "suggested",
    query = ""
  ) =>
    renderToStaticMarkup(
      <SkillsPage
        overview={overview(skills)}
        turns={10}
        pending={[]}
        recent={[]}
        error=""
        query={query}
        modifiedFilter={filter}
        onModifiedFilter={() => {}}
        onQuery={() => {}}
        onOpen={() => {}}
        onPendingChange={() => {}}
        onRecentChange={() => {}}
        onReload={() => {}}
      />
    );
  const skills = [skill("alpha-one"), modified("beta-two"), skill("gamma-three")];

  it("lists every skill under All and shows the counts", () => {
    const html = page(skills, "all");
    for (const name of ["alpha-one", "beta-two", "gamma-three"]) expect(html).toContain(name);
    expect(html).toContain("All (3)");
    expect(html).toContain("Not modified (2)");
    expect(html).toContain("Modified (1)");
    expect(html).toContain("3 skills");
  });

  it("hides modified skills under Not modified, and keeps the counts of the whole list", () => {
    const html = page(skills, "not-modified");
    expect(html).toContain("alpha-one");
    expect(html).not.toContain("beta-two");
    expect(html).toContain("2 skills");
    expect(html).toContain("All (3)");
  });

  it("lists only modified skills under Modified", () => {
    const html = page(skills, "modified");
    expect(html).toContain("beta-two");
    expect(html).not.toContain("alpha-one");
    expect(html).toContain("1 skill<");
  });

  it("works with the name filter", () => {
    const html = page(skills, "not-modified", "gamma");
    expect(html).toContain("gamma-three");
    expect(html).not.toContain("alpha-one");
    expect(html).toContain("Not modified (2)");
  });

  it("says no skill matches the name when the whole list has none, in any tab", () => {
    for (const filter of ["all", "not-modified", "modified", "suggested"] as const) {
      const html = page(skills, filter, "zzz");
      expect(html).toContain("No skill matches this name.");
      expect(html).not.toContain("in this tab");
    }
  });

  it("says the tab hides the match when the name matches only skills the tab hides", () => {
    const html = page(skills, "modified", "gamma");
    expect(html).toContain("No skill matches this name in this tab.");
    expect(html).not.toContain("No skill matches this name.");
    expect(page(skills, "suggested", "alpha")).toContain("No skill matches this name in this tab.");
  });

  it("shows no empty message when the name matches skills the tab shows", () => {
    const html = page(skills, "not-modified", "gamma");
    expect(html).toContain("gamma-three");
    expect(html).not.toContain("No skill matches this name");
  });

  it("says so when a tab is empty", () => {
    expect(page([skill("a")], "modified")).toContain("No skill has been modified yet.");
    expect(page([modified("a")], "not-modified")).toContain("Every skill has been modified.");
    expect(page([skill("a")], "suggested")).toContain("No skill is suggested for a change yet.");
    // The control stays, so the reader can leave the empty tab.
    expect(page([skill("a")], "modified")).toContain("All (1)");
  });
});
