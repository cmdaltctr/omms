import { describe, expect, it } from "bun:test";
import { estimateTokens } from "../src/core/context-budget.js";
import {
  countLabels,
  matchesTagGroups,
  isMemorisationId,
  memorisationCapError,
  memorisationCapIsValid,
  memorisationId,
  memorisationPresetsError,
  memorisationSize,
  memorisationSizeError,
  memorisationSizeRange,
  parseTagGroups,
  noteLengthFor,
  parseTagList,
  pickRecallMatches,
  presetSizeIn,
  snapshotText,
  visibleTags,
  withProjectLabel,
} from "../src/core/memorisation.js";
import { buildTolerant } from "../src/services/config-problems.js";
import {
  checkMemorisationSettingsEdits,
  MEMORISATION_DEFAULTS,
  memorisationSettingsFrom,
  removeMemorisationProjectOverrides,
} from "../src/core/memorisation-settings.js";

function randomForBase36(value: string): number {
  return Number.parseInt(value, 36) / 36 ** 6;
}

function matches(...confidence: number[]): { id: string; confidence: number }[] {
  return confidence.map((score, index) => ({ id: `ms-${index}`, confidence: score }));
}

describe("memorisation IDs", () => {
  it("uses ms- plus six lower-case base36 characters, including zero padding", async () => {
    const checked: string[] = [];
    const id = await memorisationId(
      (candidate) => {
        checked.push(candidate);
        return false;
      },
      () => randomForBase36("000a0z")
    );
    expect(id).toBe("ms-000a0z");
    expect(id).toMatch(/^ms-[a-z0-9]{6}$/);
    expect(checked).toEqual([id]);

    expect(
      await memorisationId(
        async () => false,
        () => 0
      )
    ).toBe("ms-000000");
    expect(
      await memorisationId(
        () => false,
        () => 0.9999999999999999
      )
    ).toBe("ms-zzzzzz");
  });

  it("retries a clash until it finds an unused ID", async () => {
    const checked: string[] = [];
    const randomValues = ["000001", "000002", "000003"].map(randomForBase36);
    const id = await memorisationId(
      async (candidate) => {
        checked.push(candidate);
        return candidate !== "ms-000003";
      },
      () => randomValues.shift()!
    );
    expect(id).toBe("ms-000003");
    expect(checked).toEqual(["ms-000001", "ms-000002", "ms-000003"]);
  });

  it("stops after five clashes and reports the failure", async () => {
    const checked: string[] = [];
    await expect(
      memorisationId(
        (candidate) => {
          checked.push(candidate);
          return true;
        },
        () => 0
      )
    ).rejects.toThrow("Could not allocate a unique memorisation ID after five tries");
    expect(checked).toHaveLength(5);
  });

  it("recognises only the exact ms- ID form", () => {
    expect(isMemorisationId("ms-4k7q2p")).toBe(true);
    expect(isMemorisationId("  ms-4k7q2p\n")).toBe(true);
    for (const invalid of [
      "ms-4k7q2",
      "ms-4k7q2p0",
      "ms-4K7Q2P",
      "MZ-4k7q2p",
      "ms-4k7q2_",
      "4k7q2p",
      "ms-",
      "",
    ]) {
      expect(isMemorisationId(invalid)).toBe(false);
    }
  });
});

describe("session snapshots", () => {
  it("writes the topic as the first line, then Done, Doing and Next sections", () => {
    expect(
      snapshotText({
        topic: "memorisation proposal",
        done: "proposal written",
        doing: "validating specs",
        next: "wait for approval",
      })
    ).toBe(
      "memorisation proposal\n\n## Done\nproposal written\n\n## Doing\nvalidating specs\n\n## Next\nwait for approval"
    );
  });

  it("puts a bullet list below its heading, never on the label line", () => {
    const text = snapshotText({ topic: "release", done: "- tests written\n- docs updated" });
    expect(text).toBe("release\n\n## Done\n- tests written\n- docs updated");
    expect(text).not.toContain("Done: -");
    expect(text.split("\n")).toContain("## Done");
  });

  it("starts with the first section when there is no topic", () => {
    expect(snapshotText({ next: "run ci:local" })).toBe("## Next\nrun ci:local");
  });

  it("omits empty fields and trims retained text", () => {
    expect(
      snapshotText({ topic: "  release plan  ", done: "", doing: "   ", next: "publish" })
    ).toBe("release plan\n\n## Next\npublish");
    expect(snapshotText({})).toBe("");
  });
});

describe("memorisation size cap", () => {
  it("accepts text at the character cap and reports the actual oversize in characters", () => {
    const settings = { memorisationMaxSize: 100, memorisationSizeUnit: "characters" } as const;
    expect(memorisationSize("a".repeat(100), "characters")).toBe(100);
    expect(memorisationSizeError("a".repeat(100), settings)).toBeNull();
    expect(memorisationSizeError("a".repeat(101), settings)).toBe(
      "Memorisation size limit is 100 characters; the text has 101 characters. Shorten it and try again."
    );
  });

  it("uses the shared UTF-8 token estimate and reports an approximate oversize", () => {
    const text = "é".repeat(201);
    expect(memorisationSize(text, "tokens")).toBe(estimateTokens(text));
    expect(memorisationSize(text, "tokens")).toBe(101);
    const settings = { memorisationMaxSize: 100, memorisationSizeUnit: "tokens" } as const;
    expect(memorisationSizeError("a".repeat(400), settings)).toBeNull();
    expect(memorisationSizeError(text, settings)).toBe(
      "Memorisation size limit is 100 tokens; the text has about 101 tokens. Shorten it and try again."
    );
  });

  it("validates whole-number caps within the range for each unit", () => {
    expect(memorisationSizeRange("characters")).toEqual({ min: 100, max: 20000 });
    expect(memorisationSizeRange("tokens")).toEqual({ min: 25, max: 5000 });
    for (const valid of [
      [100, "characters"],
      [20000, "characters"],
      [25, "tokens"],
      [5000, "tokens"],
    ]) {
      expect(memorisationCapIsValid(valid[0], valid[1])).toBe(true);
    }
    for (const invalid of [
      [99, "characters"],
      [20001, "characters"],
      [24, "tokens"],
      [5001, "tokens"],
      [100.5, "characters"],
      ["100", "characters"],
      [100, "words"],
      [null, "characters"],
    ]) {
      expect(memorisationCapIsValid(invalid[0], invalid[1])).toBe(false);
    }
    expect(memorisationCapError("characters")).toBe(
      "memorisationMaxSize must be a whole number from 100 to 20000 characters"
    );
    expect(memorisationCapError("tokens")).toBe(
      "memorisationMaxSize must be a whole number from 25 to 5000 tokens"
    );
  });
});

describe("recall match selection", () => {
  it("returns one strong match alone at the 80-point and 10-point-lead boundaries", () => {
    expect(pickRecallMatches(matches(88, 61, 59))).toEqual(matches(88));
    expect(pickRecallMatches(matches(80, 70, 60))).toEqual(matches(80));
    expect(pickRecallMatches(matches(90))).toEqual(matches(90));
  });

  it("keeps close matches up to three when either strong-match condition fails", () => {
    expect(pickRecallMatches(matches(72, 70, 65, 60))).toEqual(matches(72, 70, 65));
    expect(pickRecallMatches(matches(79, 60, 55, 50))).toEqual(matches(79, 60, 55));
    expect(pickRecallMatches(matches(80, 70.5, 60))).toEqual(matches(80, 70.5, 60));
    expect(pickRecallMatches(matches(88, 61), 2)).toEqual(matches(88));
  });

  it("honours a smaller caller limit and an empty result", () => {
    expect(pickRecallMatches(matches(72, 70, 65), 2)).toEqual(matches(72, 70));
    expect(pickRecallMatches(matches(72, 70, 65), 1)).toEqual(matches(72));
    expect(pickRecallMatches(matches(72), 0)).toEqual([]);
    expect(pickRecallMatches([])).toEqual([]);
  });

  it("honours a caller limit above three and keeps three as the default", () => {
    const close = matches(72, 70, 65, 60, 55, 50);
    expect(pickRecallMatches(close, 5)).toEqual(matches(72, 70, 65, 60, 55));
    expect(pickRecallMatches(close, 10)).toEqual(close);
    expect(pickRecallMatches(close)).toEqual(matches(72, 70, 65));
    expect(pickRecallMatches(matches(90, 60, 55), 5)).toEqual(matches(90));
  });
});

describe("memorisation settings", () => {
  it("defaults an older config to 2000 characters and add", () => {
    expect(MEMORISATION_DEFAULTS).toEqual({
      memorisationMaxSize: 2000,
      memorisationSizeUnit: "characters",
      memorisationRepeat: "add",
      memorisationRerank: false,
      memorisationShortSize: 800,
      memorisationMediumSize: 2000,
      memorisationLongSize: 5000,
    });
    expect(memorisationSettingsFrom({})).toEqual(MEMORISATION_DEFAULTS);
  });

  it("keeps valid configured values and rejects an invalid config pair or repeat", () => {
    expect(
      memorisationSettingsFrom({
        memorisationMaxSize: 500,
        memorisationSizeUnit: "tokens",
        memorisationRepeat: "replace",
      })
    ).toEqual({
      memorisationMaxSize: 500,
      memorisationSizeUnit: "tokens",
      memorisationRepeat: "replace",
      memorisationRerank: false,
      memorisationShortSize: 800,
      memorisationMediumSize: 2000,
      memorisationLongSize: 5000,
    });
    expect(() =>
      memorisationSettingsFrom({ memorisationMaxSize: 24, memorisationSizeUnit: "tokens" })
    ).toThrow("Invalid memorisation size settings");
    expect(() => memorisationSettingsFrom({ memorisationRepeat: "overwrite" as "add" })).toThrow(
      "Invalid memorisationRepeat config"
    );
  });

  it("accepts repeat add and replace and boundary cap edits", () => {
    const current = { ...MEMORISATION_DEFAULTS };
    expect(() => checkMemorisationSettingsEdits({}, current)).not.toThrow();
    expect(() =>
      checkMemorisationSettingsEdits({ memorisationRepeat: "add" }, current)
    ).not.toThrow();
    expect(() =>
      checkMemorisationSettingsEdits({ memorisationRepeat: "replace" }, current)
    ).not.toThrow();
    for (const [size, unit] of [
      [100, "characters"],
      [20000, "characters"],
      [25, "tokens"],
      [5000, "tokens"],
    ]) {
      expect(() =>
        checkMemorisationSettingsEdits(
          { memorisationMaxSize: size, memorisationSizeUnit: unit },
          current
        )
      ).not.toThrow();
    }
  });

  it("validates the edited size and unit as a pair", () => {
    const current = { ...MEMORISATION_DEFAULTS };
    expect(() =>
      checkMemorisationSettingsEdits({ memorisationSizeUnit: "tokens" }, current)
    ).not.toThrow();
    expect(() =>
      checkMemorisationSettingsEdits(
        { memorisationSizeUnit: "tokens" },
        { ...current, memorisationMaxSize: 24 }
      )
    ).toThrow("memorisationMaxSize must be a whole number from 25 to 5000 tokens");
    expect(() =>
      checkMemorisationSettingsEdits(
        { memorisationMaxSize: 99 },
        { ...current, memorisationSizeUnit: "characters" }
      )
    ).toThrow("memorisationMaxSize must be a whole number from 100 to 20000 characters");
    expect(() =>
      checkMemorisationSettingsEdits({ memorisationSizeUnit: "tokens" }, current)
    ).not.toThrow();
  });

  it("refuses out-of-range, non-integer and unknown values without mutating current settings", () => {
    const current = { ...MEMORISATION_DEFAULTS };
    const before = { ...current };
    for (const edits of [
      { memorisationMaxSize: 99 },
      { memorisationMaxSize: 20001 },
      { memorisationMaxSize: 100.5 },
      { memorisationMaxSize: "100" },
      { memorisationSizeUnit: "words" },
      { memorisationRepeat: "overwrite" },
    ]) {
      expect(() => checkMemorisationSettingsEdits(edits, current)).toThrow();
      expect(current).toEqual(before);
    }
    expect(() => checkMemorisationSettingsEdits({ memorisationRepeat: "bad" }, current)).toThrow(
      "memorisationRepeat must be add or replace"
    );
  });
});

describe("memorisation labels", () => {
  it("parses a comma-separated list: trims, lower-cases, drops blanks and repeats, keeps order", () => {
    expect(parseTagList(" Auth , WIP,,auth ,Release ")).toEqual(["auth", "wip", "release"]);
    expect(parseTagList("")).toEqual([]);
    expect(parseTagList(undefined)).toEqual([]);
    expect(parseTagList(" , ")).toEqual([]);
  });

  it("counts each label once per record, merging case and spaces, most records first", () => {
    const records = [
      ["memorisation", "Server", "api"],
      ["memorisation", "server", " api ", "ReactJS"],
      ["memorisation", "SERVER", "server"],
      ["memorisation"],
      undefined,
    ];
    expect(countLabels(records)).toEqual([
      { label: "Server", count: 3 },
      { label: "api", count: 2 },
      { label: "ReactJS", count: 1 },
    ]);
  });

  it("breaks a tie by name and gives an empty list for no labels", () => {
    expect(countLabels([["b"], ["a"], ["c", "a", "b"]])).toEqual([
      { label: "a", count: 2 },
      { label: "b", count: 2 },
      { label: "c", count: 1 },
    ]);
    expect(countLabels([])).toEqual([]);
    expect(countLabels([["memorisation"]])).toEqual([]);
  });

  it("hides the fixed memorisation tag and keeps the stored order", () => {
    expect(visibleTags(["memorisation", "wip", "auth"])).toEqual(["wip", "auth"]);
    expect(visibleTags(["Memorisation", "x"])).toEqual(["x"]);
    expect(visibleTags(undefined)).toEqual([]);
  });

  it("reads a comma as AND and a bar as OR: groups of alternatives", () => {
    expect(parseTagGroups(" Runpod | Vast , 4090 ")).toEqual([["runpod", "vast"], ["4090"]]);
    expect(parseTagGroups("a,b,A")).toEqual([["a"], ["b"]]);
    expect(parseTagGroups("a|b|A,, |,a|b")).toEqual([["a", "b"]]);
    expect(parseTagGroups("")).toEqual([]);
    expect(parseTagGroups(undefined)).toEqual([]);
  });

  it("matches a record when every group has one label it carries, ignoring case and spaces", () => {
    const record = ["memorisation", "Auth", "wip"];
    expect(matchesTagGroups(record, [["auth"]])).toBe(true);
    expect(matchesTagGroups(record, [["auth"], ["WIP"]])).toBe(true);
    expect(matchesTagGroups(record, [[" wip "]])).toBe(true);
    expect(matchesTagGroups(record, [["auth"], ["release"]])).toBe(false);
    expect(matchesTagGroups(record, [["release", "wip"]])).toBe(true);
    expect(matchesTagGroups(record, [["release", "wip"], ["auth"]])).toBe(true);
    expect(matchesTagGroups(record, [["release", "deploy"], ["auth"]])).toBe(false);
    expect(matchesTagGroups(record, [])).toBe(true);
    expect(matchesTagGroups([], [["auth"]])).toBe(false);
  });
});

describe("project label", () => {
  it("adds the project name as one more label, trimmed and lower-cased", () => {
    expect(withProjectLabel(["memorisation"], "Omrs")).toEqual(["memorisation", "omrs"]);
    expect(withProjectLabel(["memorisation", "release"], " omrs ")).toEqual([
      "memorisation",
      "release",
      "omrs",
    ]);
  });

  it("adds no label for the file-system root or an empty name", () => {
    expect(withProjectLabel(["memorisation"], "/")).toEqual(["memorisation"]);
    expect(withProjectLabel(["memorisation"], "")).toEqual(["memorisation"]);
    expect(withProjectLabel(["memorisation"], "  ")).toEqual(["memorisation"]);
    expect(withProjectLabel(["memorisation"], undefined)).toEqual(["memorisation"]);
  });

  it("does not repeat a label the caller already gave", () => {
    expect(withProjectLabel(["memorisation", "omrs"], "OMRS")).toEqual(["memorisation", "omrs"]);
  });
});

describe("note length presets", () => {
  const defaults = { ...MEMORISATION_DEFAULTS };
  const lengthOf = (memorisationMaxSize: number, memorisationSizeUnit: "characters" | "tokens") =>
    noteLengthFor({ ...defaults, memorisationMaxSize, memorisationSizeUnit });

  it("converts a preset to tokens with a round-up of a quarter", () => {
    expect(presetSizeIn(800, "characters")).toBe(800);
    expect(presetSizeIn(800, "tokens")).toBe(200);
    expect(presetSizeIn(2000, "tokens")).toBe(500);
    expect(presetSizeIn(5000, "tokens")).toBe(1250);
    expect(presetSizeIn(1001, "tokens")).toBe(251);
  });

  it("reports the default cap as medium, 2000 characters", () => {
    expect(noteLengthFor(defaults)).toEqual({
      length: "medium",
      maxSize: 2000,
      unit: "characters",
    });
  });

  it("matches each default preset in characters", () => {
    expect(lengthOf(800, "characters").length).toBe("short");
    expect(lengthOf(2000, "characters").length).toBe("medium");
    expect(lengthOf(5000, "characters").length).toBe("long");
  });

  it("matches each default preset in tokens", () => {
    expect(lengthOf(200, "tokens")).toEqual({ length: "short", maxSize: 200, unit: "tokens" });
    expect(lengthOf(500, "tokens").length).toBe("medium");
    expect(lengthOf(1250, "tokens").length).toBe("long");
  });

  it("calls any other valid cap custom", () => {
    expect(lengthOf(3000, "characters")).toEqual({
      length: "custom",
      maxSize: 3000,
      unit: "characters",
    });
    expect(lengthOf(201, "tokens").length).toBe("custom");
  });

  it("matches an edited preset in characters and in tokens", () => {
    const edited = { ...defaults, memorisationShortSize: 1000 };
    expect(noteLengthFor({ ...edited, memorisationMaxSize: 1000 }).length).toBe("short");
    expect(
      noteLengthFor({ ...edited, memorisationMaxSize: 250, memorisationSizeUnit: "tokens" }).length
    ).toBe("short");
    // The old default no longer names a preset.
    expect(noteLengthFor({ ...edited, memorisationMaxSize: 800 }).length).toBe("custom");
  });

  it("accepts the defaults and the range limits", () => {
    expect(memorisationPresetsError(defaults)).toBeNull();
    expect(
      memorisationPresetsError({
        memorisationShortSize: 100,
        memorisationMediumSize: 101,
        memorisationLongSize: 20000,
      })
    ).toBeNull();
  });

  it("refuses values outside 100 to 20000 and non-whole numbers, naming the key", () => {
    for (const bad of [99, 20001, 1.5, "800", null, undefined, Number.NaN]) {
      expect(memorisationPresetsError({ ...defaults, memorisationShortSize: bad })).toBe(
        "memorisationShortSize must be a whole number from 100 to 20000 characters"
      );
    }
    expect(memorisationPresetsError({ ...defaults, memorisationMediumSize: 99 })).toBe(
      "memorisationMediumSize must be a whole number from 100 to 20000 characters"
    );
    expect(memorisationPresetsError({ ...defaults, memorisationLongSize: 20001 })).toBe(
      "memorisationLongSize must be a whole number from 100 to 20000 characters"
    );
  });

  it("refuses presets that are not in order, including equal values", () => {
    expect(memorisationPresetsError({ ...defaults, memorisationShortSize: 3000 })).toBe(
      "Short must be less than Medium"
    );
    expect(memorisationPresetsError({ ...defaults, memorisationShortSize: 2000 })).toBe(
      "Short must be less than Medium"
    );
    expect(memorisationPresetsError({ ...defaults, memorisationMediumSize: 6000 })).toBe(
      "Medium must be less than Long"
    );
    expect(memorisationPresetsError({ ...defaults, memorisationMediumSize: 5000 })).toBe(
      "Medium must be less than Long"
    );
  });

  it("refuses presets that are a few characters apart and so share one token value", () => {
    // 101 and 104 characters are both about 26 tokens, so the Tokens unit could not tell them apart.
    expect(
      memorisationPresetsError({
        ...defaults,
        memorisationShortSize: 101,
        memorisationMediumSize: 104,
      })
    ).toBe("Short and Medium must differ by at least one token: both are about 26 tokens");
    expect(
      memorisationPresetsError({
        ...defaults,
        memorisationMediumSize: 2001,
        memorisationLongSize: 2004,
      })
    ).toBe("Medium and Long must differ by at least one token: both are about 501 tokens");
    // One token apart is enough.
    expect(
      memorisationPresetsError({
        ...defaults,
        memorisationShortSize: 104,
        memorisationMediumSize: 105,
      })
    ).toBeNull();
  });
});

describe("note length preset settings", () => {
  const current = { ...MEMORISATION_DEFAULTS };

  it("reads configured presets and falls back to the defaults", () => {
    expect(memorisationSettingsFrom({ memorisationShortSize: 1000 })).toMatchObject({
      memorisationShortSize: 1000,
      memorisationMediumSize: 2000,
      memorisationLongSize: 5000,
    });
  });

  it("rejects an invalid or out-of-order configured preset", () => {
    expect(() => memorisationSettingsFrom({ memorisationShortSize: 50 })).toThrow(
      "Invalid memorisationShortSize config (accepted: whole numbers from 100 to 20000 characters)"
    );
    expect(() => memorisationSettingsFrom({ memorisationLongSize: 1.5 })).toThrow(
      "Invalid memorisationLongSize config (accepted: whole numbers from 100 to 20000 characters)"
    );
    expect(() => memorisationSettingsFrom({ memorisationShortSize: 3000 })).toThrow(
      "Invalid memorisationShortSize config (accepted: whole numbers from 100 to 20000 characters, less than memorisationMediumSize)"
    );
  });

  it("names the preset the config file breaks, with its rule, when the file loads", () => {
    const load = (config: Record<string, unknown>) =>
      buildTolerant(
        (file: Record<string, unknown>) => memorisationSettingsFrom(file),
        config,
        () => undefined
      );
    const only = (config: Record<string, unknown>) => {
      const { problems, config: loaded } = load(config);
      expect(problems).toHaveLength(1);
      return { problem: problems[0]!, loaded };
    };

    // Only Medium is set and it is below the default Short, so Medium is the broken value.
    const below = only({ memorisationMediumSize: 700 });
    expect(below.problem.key).toBe("memorisationMediumSize");
    expect(below.problem.accepted).toBe(
      "whole numbers from 100 to 20000 characters, more than memorisationShortSize"
    );
    expect(below.loaded.memorisationMediumSize).toBe(2000);

    const range = only({ memorisationLongSize: 50 });
    expect(range.problem.key).toBe("memorisationLongSize");
    expect(range.problem.accepted).toBe("whole numbers from 100 to 20000 characters");

    // Both of the pair are set: the lower one is named, whatever the order of keys in the file.
    for (const config of [
      { memorisationShortSize: 3000, memorisationMediumSize: 2500 },
      { memorisationMediumSize: 2500, memorisationShortSize: 3000 },
    ]) {
      const pair = only(config);
      expect(pair.problem.key).toBe("memorisationShortSize");
      expect(pair.problem.accepted).toBe(
        "whole numbers from 100 to 20000 characters, less than memorisationMediumSize"
      );
      expect(pair.loaded).toMatchObject({
        memorisationShortSize: 800,
        memorisationMediumSize: 2500,
      });
    }

    const tie = only({ memorisationShortSize: 1997 });
    expect(tie.problem.key).toBe("memorisationShortSize");
    expect(tie.problem.accepted).toBe(
      "whole numbers from 100 to 20000 characters, at least one token less than memorisationMediumSize"
    );
  });

  it("accepts an edit that keeps the presets in order, merged with the current values", () => {
    expect(() =>
      checkMemorisationSettingsEdits({ memorisationShortSize: 1000 }, current)
    ).not.toThrow();
    expect(() =>
      checkMemorisationSettingsEdits(
        {
          memorisationShortSize: 3000,
          memorisationMediumSize: 4000,
          memorisationLongSize: 9000,
        },
        current
      )
    ).not.toThrow();
  });

  it("refuses an edit that breaks a rule, names the rule and leaves the current values", () => {
    const before = { ...current };
    expect(() => checkMemorisationSettingsEdits({ memorisationShortSize: 3000 }, current)).toThrow(
      "Short must be less than Medium"
    );
    expect(() => checkMemorisationSettingsEdits({ memorisationLongSize: 1500 }, current)).toThrow(
      "Medium must be less than Long"
    );
    expect(() => checkMemorisationSettingsEdits({ memorisationMediumSize: 99 }, current)).toThrow(
      "memorisationMediumSize must be a whole number from 100 to 20000 characters"
    );
    expect(() => checkMemorisationSettingsEdits({ memorisationShortSize: 1.5 }, current)).toThrow(
      "memorisationShortSize must be a whole number from 100 to 20000 characters"
    );
    expect(current).toEqual(before);
  });

  it("drops all seven memorisation keys, including the presets, from a project config", () => {
    const project: Record<string, unknown> = {
      memorisationMaxSize: 1,
      memorisationSizeUnit: "tokens",
      memorisationRepeat: "replace",
      memorisationRerank: true,
      memorisationShortSize: 150,
      memorisationMediumSize: 300,
      memorisationLongSize: 600,
      maxMemories: 4,
    };
    removeMemorisationProjectOverrides(project);
    expect(project).toEqual({ maxMemories: 4 });
  });
});
