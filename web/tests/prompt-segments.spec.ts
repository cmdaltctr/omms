import { expect, it } from "bun:test";
import { splitInlineCode, splitPrompt } from "../src/lib/prompt-segments.ts";

it("returns one text segment for a plain prompt", () => {
  expect(splitPrompt("whats the difference?")).toEqual([
    { kind: "text", text: "whats the difference?" },
  ]);
});

it("turns a pasted_content block into its own segment, whatever attributes its tags carry", () => {
  const prompt = [
    "see this",
    '<pasted_content id="bbc8">',
    "$ bash scripts/release-approve.sh",
    "error: exited with code 1",
    '</pasted_content id="bbc8">',
    "why?",
  ].join("\n");
  expect(splitPrompt(prompt)).toEqual([
    { kind: "text", text: "see this" },
    { kind: "pasted", text: "$ bash scripts/release-approve.sh\nerror: exited with code 1" },
    { kind: "text", text: "why?" },
  ]);
});

it("turns a fenced block into a code segment and drops the language line", () => {
  expect(splitPrompt("run:\n```bash\nbun run check\n```\ndone")).toEqual([
    { kind: "text", text: "run:" },
    { kind: "code", text: "bun run check" },
    { kind: "text", text: "done" },
  ]);
});

it("keeps an unterminated block as plain text", () => {
  expect(splitPrompt("<pasted_content>\nno end tag")).toEqual([
    { kind: "text", text: "<pasted_content>\nno end tag" },
  ]);
});

it("splits inline backtick spans from the text around them", () => {
  expect(splitInlineCode("run `bun test` now")).toEqual([
    { code: false, text: "run " },
    { code: true, text: "bun test" },
    { code: false, text: " now" },
  ]);
});

it("does not treat a lone backtick as code", () => {
  expect(splitInlineCode("it`s fine")).toEqual([{ code: false, text: "it`s fine" }]);
});
