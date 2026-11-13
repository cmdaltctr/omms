import { expect, it } from "bun:test";
import {
  labelsFromSearch,
  parseRecallInput,
  searchWithLabels,
} from "../src/lib/memorisation-query.ts";

it("leaves plain text alone", () => {
  expect(parseRecallInput("release notes")).toEqual({ q: "release notes", labels: [] });
  expect(parseRecallInput("ms-4k7q2p")).toEqual({ q: "ms-4k7q2p", labels: [] });
  expect(parseRecallInput("   ")).toEqual({ q: "", labels: [] });
});

it("takes label:X out of the text and keeps the rest as the query", () => {
  expect(parseRecallInput("release label:handover")).toEqual({
    q: "release",
    labels: ["handover"],
  });
  expect(parseRecallInput("label:handover release notes")).toEqual({
    q: "release notes",
    labels: ["handover"],
  });
  expect(parseRecallInput("port label:ops 4747")).toEqual({ q: "port 4747", labels: ["ops"] });
});

it("accepts label: more than once, in order, without repeats", () => {
  expect(parseRecallInput("label:a label:b label:A text")).toEqual({
    q: "text",
    labels: ["a", "b"],
  });
});

it('reads label:"two words" as one label', () => {
  expect(parseRecallInput('plan label:"two words" label:x')).toEqual({
    q: "plan",
    labels: ["two words", "x"],
  });
});

it("reads text with a comma as a list of labels, with or without spaces", () => {
  const want = { q: "", labels: ["runpod", "server", "4090"] };
  expect(parseRecallInput("runpod, server, 4090")).toEqual(want);
  expect(parseRecallInput("runpod,server,4090")).toEqual(want);
  expect(parseRecallInput("runpod ,server,, 4090,")).toEqual(want);
  expect(parseRecallInput("two words, Runpod, runpod")).toEqual({
    q: "",
    labels: ["two words", "Runpod"],
  });
  expect(parseRecallInput("label:ops runpod, server")).toEqual({
    q: "",
    labels: ["ops", "runpod", "server"],
  });
});

it("gives an empty query when only labels are typed", () => {
  expect(parseRecallInput("label:handover")).toEqual({ q: "", labels: ["handover"] });
});

it("reads the prefix in any case and ignores an empty label", () => {
  expect(parseRecallInput("Label:Ops LABEL:x text")).toEqual({ q: "text", labels: ["Ops", "x"] });
  expect(parseRecallInput('text label: label:""')).toEqual({ q: "text", labels: [] });
});

it("does not treat label: inside a word as a label", () => {
  expect(parseRecallInput("sublabel:x")).toEqual({ q: "sublabel:x", labels: [] });
});

it("reads the labels from a URL query string", () => {
  expect(labelsFromSearch("")).toEqual([]);
  expect(labelsFromSearch("?labels=a,b")).toEqual(["a", "b"]);
  expect(labelsFromSearch("?x=1&labels=two%20words,b")).toEqual(["two words", "b"]);
  expect(labelsFromSearch("?labels=a,,A, b ")).toEqual(["a", "b"]);
});

it("writes the labels into a URL query string and keeps other parameters", () => {
  expect(searchWithLabels("", ["a", "b"])).toBe("?labels=a,b");
  expect(searchWithLabels("", ["two words"])).toBe("?labels=two%20words");
  expect(searchWithLabels("?labels=a", [])).toBe("");
  expect(searchWithLabels("?x=1&labels=a", ["b"])).toBe("?x=1&labels=b");
});
