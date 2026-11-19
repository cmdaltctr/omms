import { describe, expect, it } from "bun:test";
import { piNotifier } from "../src/adapters/pi/notice.js";

// Pi makes an extension context stale when the user replaces or reloads the session
// (`/new`, `/resume`, `/fork`, `/reload`). Every later read of `hasUI` or `ui` throws at once.
// Capture and profile learning can still be running for the old session at that moment.
const STALE = "This extension ctx is stale after session replacement or reload.";

function ctx(options: { hasUI?: boolean; stale?: boolean } = {}) {
  const shown: Array<[string, string]> = [];
  const context = {
    get hasUI() {
      if (options.stale) throw new Error(STALE);
      return options.hasUI ?? true;
    },
    get ui() {
      if (options.stale) throw new Error(STALE);
      return { notify: (message: string, level: string) => shown.push([message, level]) };
    },
  };
  return { context: context as never, shown };
}

describe("piNotifier", () => {
  it("shows the title and message, with success as info", () => {
    const { context, shown } = ctx();
    piNotifier(context)({ title: "Memory Captured", message: "saved", variant: "success" });
    piNotifier(context)({ title: "Using fallback provider", message: "m", variant: "warning" });
    expect(shown).toEqual([
      ["Memory Captured: saved", "info"],
      ["Using fallback provider: m", "warning"],
    ]);
  });

  it("shows nothing without a user interface", () => {
    const { context, shown } = ctx({ hasUI: false });
    piNotifier(context)({ title: "t", message: "m", variant: "error" });
    expect(shown).toEqual([]);
  });

  it("does not throw when the session context went stale", () => {
    const { context } = ctx({ stale: true });
    expect(() =>
      piNotifier(context)({ title: "Memory Captured", message: "saved", variant: "success" })
    ).not.toThrow();
  });
});
