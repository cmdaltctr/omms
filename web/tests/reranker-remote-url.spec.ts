import { expect, it } from "bun:test";
import { isRemoteRerankerUrl } from "../src/lib/reranker-controls.ts";

it("treats every loopback form as local and any other host as remote", () => {
  expect(isRemoteRerankerUrl("http://[::1]:3008/v1")).toBe(false);
  expect(isRemoteRerankerUrl("http://127.0.0.1:3008/v1")).toBe(false);
  expect(isRemoteRerankerUrl("http://localhost/v1")).toBe(false);
  expect(isRemoteRerankerUrl("https://rerank.example.com/v1")).toBe(true);
});
