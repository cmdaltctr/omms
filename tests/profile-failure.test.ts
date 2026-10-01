import { expect, it } from "bun:test";
import {
  ProfileModelError,
  profileFailureCode,
  profileResultCode,
} from "../src/core/profile-failure.js";

it("maps a failed provider result to a fixed code", () => {
  expect(profileResultCode({ error: "API request timeout (30000ms)" })).toBe("timeout");
  expect(profileResultCode({ error: "HTTP 429", httpStatus: 429 })).toBe("http-429");
  expect(profileResultCode({ error: "Max iterations (5) reached" })).toBe("no-tool-call");
  expect(profileResultCode({ error: "Validation failed: bad field" })).toBe("invalid-reply");
  expect(profileResultCode({ error: "something else" })).toBe("error");
});

it("maps a thrown error to a fixed code", () => {
  expect(profileFailureCode(new ProfileModelError("http-503"))).toBe("http-503");
  expect(profileFailureCode(new Error("pi profile analysis: timeout"))).toBe("timeout");
  expect(profileFailureCode(new Error("pi profile analysis: invalid profile payload"))).toBe(
    "invalid-reply"
  );
  expect(profileFailureCode(new Error("External API not configured for memory provider: x"))).toBe(
    "not-configured"
  );
  expect(profileFailureCode(new Error("Missing memoryModel or --model"))).toBe("not-configured");
  expect(profileFailureCode("boom")).toBe("error");
});
