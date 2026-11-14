import { expect, it } from "bun:test";
import {
  filterSummary,
  groupsFromLabels,
  labelsFromGroups,
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

it("ends a bare label: at a comma and reads label: right after a comma", () => {
  expect(parseRecallInput("label:ops, server")).toEqual({ q: "", labels: ["ops", "server"] });
  expect(parseRecallInput("runpod,label:server")).toEqual({
    q: "",
    labels: ["server", "runpod"],
  });
});

it("splits labels on the Chinese and Arabic commas too", () => {
  const want = { q: "", labels: ["runpod", "server", "4090"] };
  expect(parseRecallInput("runpod，server，4090")).toEqual(want);
  expect(parseRecallInput("runpod، server، 4090")).toEqual(want);
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

it("keeps a bar between labels as one OR label, next to comma labels", () => {
  expect(parseRecallInput("runpod | vast, 4090")).toEqual({
    q: "",
    labels: ["runpod|vast", "4090"],
  });
  expect(parseRecallInput("runpod|vast")).toEqual({ q: "", labels: ["runpod|vast"] });
  expect(parseRecallInput("a | b | A, c")).toEqual({ q: "", labels: ["a|b", "c"] });
  expect(parseRecallInput("label:ops, a | b")).toEqual({ q: "", labels: ["ops", "a|b"] });
});

it("carries an OR label through the address bar", () => {
  expect(searchWithLabels("", ["runpod|vast", "4090"])).toBe("?labels=runpod%7Cvast,4090");
  expect(labelsFromSearch("?labels=runpod%7Cvast,4090")).toEqual(["runpod|vast", "4090"]);
});

it("turns the filter into picker groups and back", () => {
  expect(groupsFromLabels(["server|reactjs", "api"])).toEqual([["server", "reactjs"], ["api"]]);
  expect(groupsFromLabels([])).toEqual([[]]);
  expect(labelsFromGroups([["server", "reactjs"], ["api"]])).toEqual(["server|reactjs", "api"]);
  expect(labelsFromGroups([["server"], [], ["Server"], ["a", "A", "b"]])).toEqual([
    "server",
    "a|b",
  ]);
  expect(labelsFromGroups([[], []])).toEqual([]);
  const filter = ["server|reactjs", "api"];
  expect(labelsFromGroups(groupsFromLabels(filter))).toEqual(filter);
});

it("writes the picker summary as groups joined by and, labels by or", () => {
  const words = { or: "or", and: "and" };
  expect(filterSummary([["server", "reactjs"], ["api"]], words)).toBe(
    "(server or reactjs) and (api)"
  );
  expect(filterSummary([["server"], [], ["api"]], words)).toBe("(server) and (api)");
  expect(filterSummary([[], []], words)).toBe("");
});

it("keeps a bar after a label: prefix as one OR label", () => {
  expect(parseRecallInput("label:runpod | vast")).toEqual({ q: "", labels: ["runpod|vast"] });
  expect(parseRecallInput('label:"two words" | x, 4090')).toEqual({
    q: "",
    labels: ["two words|x", "4090"],
  });
});

it("trims the alternatives of an address label and keeps the spaces inside a label", () => {
  expect(groupsFromLabels(["server | reactjs", "api"])).toEqual([["server", "reactjs"], ["api"]]);
  expect(labelsFromGroups([["build  server", " Build  server "], ["a b"]])).toEqual([
    "build  server",
    "a b",
  ]);
});
