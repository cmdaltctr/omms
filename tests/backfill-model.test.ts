import { describe, expect, it } from "bun:test";
import { parseBackfillModel } from "../src/importer/backfill-model.js";

describe("backfill model selection", () => {
  it("inherits the host live capture model", () => {
    expect(parseBackfillModel({ piBackfillModel: "inherit" }, "pi")).toBe("inherit");
  });

  it("splits only the first slash", () => {
    expect(parseBackfillModel({ piBackfillModel: "zai/glm-5-turbo" }, "pi")).toEqual({
      provider: "zai",
      model: "glm-5-turbo",
    });
    expect(parseBackfillModel({ opencodeBackfillModel: "a/b/c" }, "opencode")).toEqual({
      provider: "a",
      model: "b/c",
    });
  });

  it("rejects empty provider or model", () => {
    expect(() => parseBackfillModel({ piBackfillModel: "/model" }, "pi")).toThrow();
    expect(() => parseBackfillModel({ piBackfillModel: "provider/" }, "pi")).toThrow();
  });
});
