import { expect, it } from "bun:test";
import {
  PROFILE_FAILURE_WAIT_MS,
  profileBackoff,
  recordProfileFailure,
} from "../src/core/profile-backoff.js";

it("blocks profile passes for 10 minutes after a failure; a success clears it", () => {
  profileBackoff.recordSuccess();
  expect(profileBackoff.canRun(0)).toBe(true);
  expect(
    recordProfileFailure("pi", "pi profile learning: aborted", new Error("timeout"), 1_000)
  ).toBe("timeout");
  expect(profileBackoff.canRun(1_000 + 60_000)).toBe(false);
  expect(profileBackoff.canRun(1_000 + PROFILE_FAILURE_WAIT_MS - 1)).toBe(false);
  expect(profileBackoff.canRun(1_000 + PROFILE_FAILURE_WAIT_MS)).toBe(true);
  profileBackoff.recordFailure(5_000);
  profileBackoff.recordSuccess();
  expect(profileBackoff.canRun(5_001)).toBe(true);
});
