import { describe, expect, it } from "bun:test";
import { estimateTokens } from "../src/core/context-budget.js";
import {
  matchesTagGroups,
  isMemorisationId,
  memorisationCapError,
  memorisationCapIsValid,
  memorisationId,
  memorisationSize,
  memorisationSizeError,
  memorisationSizeRange,
  parseTagGroups,
  parseTagList,
  pickRecallMatches,
  snapshotText,
  visibleTags,
  withProjectLabel,
} from "../src/core/memorisation.js";
import {
  checkMemorisationSettingsEdits,
  MEMORISATION_DEFAULTS,
  memorisationSettingsFrom,
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
  it("renders every field in Topic, Done, Doing, Next order", () => {
    expect(
      snapshotText({
        topic: "memorisation proposal",
        done: "proposal written",
        doing: "validating specs",
        next: "wait for approval",
      })
    ).toBe(
      "Topic: memorisation proposal\nDone: proposal written\nDoing: validating specs\nNext: wait for approval"
    );
  });

  it("omits empty fields and trims retained text", () => {
    expect(
      snapshotText({ topic: "  release plan  ", done: "", doing: "   ", next: "publish" })
    ).toBe("Topic: release plan\nNext: publish");
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
