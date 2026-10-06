import { expect, it } from "bun:test";
import { latestReply } from "../web/src/lib/latest-reply.js";

it("applies a reply only when no newer request has started", async () => {
  const applied: string[] = [];
  const send = latestReply<string>((value) => applied.push(value));
  let releaseOld!: (value: string) => void;
  const old = new Promise<string>((resolve) => (releaseOld = resolve));
  const oldDone = send(old);
  await send(Promise.resolve("new"));
  releaseOld("old");
  await oldDone;
  expect(applied).toEqual(["new"]);
});

it("applies nothing for a failed request and reports only the newest failure", async () => {
  const applied: string[] = [];
  const failed: string[] = [];
  const send = latestReply<string>(
    (value) => applied.push(value),
    (error) => failed.push(error.message)
  );
  await send(Promise.reject(new Error("offline")));
  let rejectOld!: (error: Error) => void;
  const old = new Promise<string>((_, reject) => (rejectOld = reject));
  const oldDone = send(old);
  await send(Promise.resolve("ok"));
  rejectOld(new Error("stale"));
  await oldDone;
  expect(applied).toEqual(["ok"]);
  expect(failed).toEqual(["offline"]);
});
