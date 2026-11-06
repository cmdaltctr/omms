import { expect, it } from "bun:test";
import { spaceChipHue, spaceInitials } from "../src/lib/space-chip.ts";
import { keywordHue } from "../src/lib/components/explorer/KeywordBadge.tsx";

it("takes the first letters of the first two words, in capitals", () => {
  expect(spaceInitials("Client work")).toBe("CW");
  expect(spaceInitials("quarterly planning and research")).toBe("QP");
});

it("takes the first two letters of a one-word name", () => {
  expect(spaceInitials("Default")).toBe("DE");
  expect(spaceInitials("x")).toBe("X");
});

it("copes with extra spaces, Chinese and Arabic names", () => {
  expect(spaceInitials("  Client   work ")).toBe("CW");
  expect(spaceInitials("研究笔记")).toBe("研究");
  expect(spaceInitials("مساحة العمل")).toBe("ما");
  expect(spaceInitials("")).toBe("?");
});

it("derives the hue from the name with the keyword hue", () => {
  expect(spaceChipHue("Client work")).toBe(keywordHue("Client work"));
  expect(spaceChipHue("Client work")).toBe(spaceChipHue(" client WORK "));
});
