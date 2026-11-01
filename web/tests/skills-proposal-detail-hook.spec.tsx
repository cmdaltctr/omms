import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";

/**
 * When the card asks for the detail. The hooks run at once and keep their state
 * in plain variables, so the spec sees each request and each state change.
 */

type Cleanup = (() => void) | void;
let sets: unknown[] = [];
let cleanups: Cleanup[] = [];
mock.module("react", () => ({
  ...react,
  useState: (initial: unknown) => [
    initial,
    (next: unknown) => {
      // A function update is the reset on close; only values are recorded.
      if (typeof next !== "function") sets.push(next);
    },
  ],
  useEffect: (effect: () => Cleanup) => {
    cleanups.push(effect());
  },
}));
const { skillsApi } = await import("../src/lib/skills-api.ts");
const { useProposalDetail } = await import("../src/lib/components/skills/useProposalDetail.ts");

const proposal = {
  id: "p1",
  kind: "improve" as const,
  skillName: "alpha",
  skillPath: null,
  content: "body",
  diff: "+x",
  summary: null,
  evidenceTurnIds: [],
  state: "pending" as const,
  appliedBy: null,
  createdAt: 1,
  updatedAt: 2,
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
type ProposalCall = typeof skillsApi.proposal;
let request: ReturnType<typeof mock>;

beforeEach(() => {
  sets = [];
  cleanups = [];
  request = mock(async () => ({
    ok: true as const,
    code: "ok",
    data: { proposal, evidence: [] },
  }));
  skillsApi.proposal = request as unknown as ProposalCall;
});

it("makes no request while the card is compact", async () => {
  useProposalDetail("p1", false);
  await settle();
  expect(request).not.toHaveBeenCalled();
  expect(sets).toEqual([]);
});

it("asks for the proposal once when the card opens, then holds it", async () => {
  useProposalDetail("p1", true);
  await settle();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("p1");
  expect(sets).toEqual([{ status: "ready", proposal, evidence: [] }]);
});

it("does not ask again when the detail is already held", async () => {
  useProposalDetail("p1", true, { status: "ready", proposal, evidence: [] });
  await settle();
  expect(request).not.toHaveBeenCalled();
});

it("records a failed load", async () => {
  request.mockImplementation(async () => ({ ok: false, code: "network", error: "down" }));
  useProposalDetail("p1", true);
  await settle();
  expect(sets).toEqual([{ status: "failed" }]);
});

it("ignores an answer that arrives after the card closed", async () => {
  useProposalDetail("p1", true);
  (cleanups[0] as () => void)();
  await settle();
  expect(sets).toEqual([]);
});
