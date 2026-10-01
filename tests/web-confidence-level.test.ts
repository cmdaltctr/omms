import { expect, it } from "bun:test";
import { confidenceLevel } from "../web/src/lib/profile-utils.js";

it("maps confidence percentages to colour bands", () => {
  expect([100, 80, 79.9, 60, 59, 40, 39.9, 0].map(confidenceLevel)).toEqual([
    "high",
    "high",
    "medium",
    "medium",
    "low",
    "low",
    "poor",
    "poor",
  ]);
});
