import { describe, expect, it } from "bun:test";
import { registerTuiNotices } from "../src/adapters/opencode/toast.js";
import { startTuiNotices } from "../src/adapters/opencode/tui-notices.js";
import { noticeRpc } from "../src/v2/notice-rpc.js";

// A notice must not be lost or stall when a step of the server-to-TUI route fails once:
// the wake-up event (server), the claim (TUI), the toast (TUI) or the confirmation (TUI).
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (condition: () => boolean, ms = 3_000) => {
  const end = Date.now() + ms;
  while (!condition() && Date.now() < end) await sleep(10);
};

/** A server whose `emit` fails `emitFailures` times, and a TUI client wired to its handlers. */
async function wire(options: {
  emitFailures?: number;
  claimFailures?: number;
  ackFailures?: number;
}) {
  let handlers: Record<string, (input: any) => Promise<any>> = {};
  const listeners = new Set<(event: unknown) => void>();
  const calls = { emit: 0, claim: 0, ack: 0 };
  let emitFailures = options.emitFailures ?? 0;
  let claimFailures = options.claimFailures ?? 0;
  let ackFailures = options.ackFailures ?? 0;
  const notify = await registerTuiNotices({
    rpc: {
      register: async (_definition: unknown, serverHandlers: typeof handlers) => {
        handlers = serverHandlers;
        return {
          dispose: async () => {},
          events: {
            emit: async (_name: string, data: unknown) => {
              calls.emit++;
              if (emitFailures-- > 0) throw new Error("emit failed");
              for (const listener of [...listeners]) listener({ data });
            },
          },
        };
      },
    } as never,
  });
  const client = {
    rpc: () => ({
      claim: async (input: unknown) => {
        calls.claim++;
        if (claimFailures-- > 0) throw new Error("rpc.unavailable");
        return handlers.claim!(input);
      },
      ack: async (input: unknown) => {
        calls.ack++;
        if (ackFailures-- > 0) throw new Error("ack failed");
        return handlers.ack!(input);
      },
      events: {
        on: (_name: string, handler: (event: unknown) => void) => {
          listeners.add(handler);
          return () => listeners.delete(handler);
        },
      },
    }),
  };
  return { notify, client: client as never, calls, listeners };
}

describe("OpenCode notice route failures", () => {
  it("the contract has a claim and an ack method", () => {
    expect(Object.keys(noticeRpc.methods)).toEqual(["claim", "ack"]);
  });

  it("sends the wake-up again when a push fails, so a listening TUI shows the notice", async () => {
    const { notify, client, calls } = await wire({ emitFailures: 1 });
    const toasts: string[] = [];
    // No claim at load: the TUI attaches, then the notice is sent. Only the event wakes it.
    const stop = startTuiNotices({
      client,
      toast: (options) => toasts.push(options.message),
      retryDelayMs: 100_000,
    });
    await sleep(20);
    notify({ message: "first" });
    await waitFor(() => toasts.length > 0, 3_000);
    stop();
    expect(toasts).toEqual(["first"]);
    expect(calls.emit).toBe(2);
  });

  it("stops sending the wake-up after a few failures", async () => {
    const { notify, calls } = await wire({ emitFailures: 100 });
    notify({ message: "never woken" });
    await sleep(7_000);
    expect(calls.emit).toBe(4);
  }, 15_000);

  it("keeps a notice whose toast failed and shows it on the retry, then confirms it", async () => {
    const { notify, client, calls } = await wire({});
    notify({ message: "keep me" });
    const toasts: string[] = [];
    let failToast = true;
    const stop = startTuiNotices({
      client,
      toast: (options) => {
        if (failToast) {
          failToast = false;
          throw new Error("toast failed");
        }
        toasts.push(options.message);
      },
      retryDelayMs: 20,
    });
    await waitFor(() => toasts.length > 0);
    await sleep(100);
    stop();
    expect(toasts).toEqual(["keep me"]);
    // Confirmed once, so a later claim returns nothing.
    expect(calls.ack).toBe(1);
  });

  it("keeps server order when the first toast fails: shows A then B", async () => {
    const { notify, client } = await wire({});
    notify({ message: "A" });
    notify({ message: "B" });
    const toasts: string[] = [];
    let failA = true;
    const stop = startTuiNotices({
      client,
      toast: (options) => {
        if (options.message === "A" && failA) {
          failA = false;
          throw new Error("toast failed");
        }
        toasts.push(options.message);
      },
      retryDelayMs: 20,
    });
    await waitFor(() => toasts.length >= 2);
    await sleep(100);
    stop();
    expect(toasts).toEqual(["A", "B"]);
  });

  it("claims again on a timer after a failed claim, without a new notice", async () => {
    const { notify, client, calls } = await wire({ claimFailures: 2 });
    notify({ message: "late" });
    const toasts: string[] = [];
    const stop = startTuiNotices({
      client,
      toast: (options) => toasts.push(options.message),
      retryDelayMs: 20,
    });
    await waitFor(() => toasts.length > 0);
    stop();
    expect(toasts).toEqual(["late"]);
    expect(calls.claim).toBe(3);
  });

  it("gives up after a bounded number of failed claims", async () => {
    const { client, calls } = await wire({ claimFailures: 1_000 });
    const stop = startTuiNotices({ client, toast: () => {}, retryDelayMs: 5 });
    await sleep(300);
    stop();
    // The first claim plus five retries.
    expect(calls.claim).toBe(6);
  });

  it("cancels the retry timer on stop", async () => {
    const { client, calls } = await wire({ claimFailures: 1_000 });
    const stop = startTuiNotices({ client, toast: () => {}, retryDelayMs: 50 });
    await sleep(10);
    stop();
    const seen = calls.claim;
    await sleep(200);
    expect(calls.claim).toBe(seen);
  });

  it("does not show a notice twice when its confirmation fails once", async () => {
    const { notify, client } = await wire({ ackFailures: 1 });
    notify({ message: "once" });
    const toasts: string[] = [];
    const stop = startTuiNotices({
      client,
      toast: (options) => toasts.push(options.message),
      retryDelayMs: 20,
    });
    await sleep(300);
    stop();
    expect(toasts).toEqual(["once"]);
  });
});
