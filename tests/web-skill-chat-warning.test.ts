import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { skillText } from "../web/src/lib/i18n/skills.ts";

const SENTENCE =
  "The memory chat sends skill counts and short change summaries to the external API, never turn text.";
const CARD = "../web/src/lib/components/settings/SkillLearningSection.tsx";

it("translates the chat warning sentence into Chinese and Arabic", () => {
  const entry = (skillText as Record<string, string[]>)[SENTENCE];
  expect(entry?.length).toBe(2);
  expect(entry!.every((text) => text.length > 0)).toBe(true);
});

it("shows the sentence in the Record agent turns warning, only while recording is on", () => {
  const source = readFileSync(new URL(CARD, import.meta.url), "utf8");
  const recordingBlock = source.slice(
    source.indexOf("{recording ? ("),
    source.indexOf("<RecordPast")
  );
  expect(recordingBlock).toContain(SENTENCE);
  expect(source.split(SENTENCE)).toHaveLength(2);
});
