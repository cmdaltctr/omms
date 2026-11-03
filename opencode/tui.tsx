/**
 * OpenCode TUI entry: shows "omms: ✔" in the prompt footer, a toast when a
 * newer om-memory-system is on npm, and one fold row per OMMS recall above the
 * prompt. OpenCode compiles this file itself; the logic lives in
 * dist/adapters/opencode/tui-status.js and tui-recall.js.
 *
 * Installed from npm, this file sits in node_modules, where OpenCode does not
 * map bare `solid-js` or JSX runtime imports to its own copies. The
 * `opentui:runtime-module:*` ids always reach the host's copies, so the footer
 * shares the host's renderer and repaints. No JSX: Bun would compile it for
 * React. See anomalyco/opencode#39986.
 */
// @ts-expect-error Virtual module that OpenCode's TUI registers at runtime.
import { createSignal } from "opentui:runtime-module:solid-js";
// @ts-expect-error Virtual module that OpenCode's TUI registers at runtime.
import { jsx } from "opentui:runtime-module:%40opentui%2Fsolid%2Fjsx-runtime";

export default {
  id: "omms.tui",
  async setup(context: any) {
    const [text, setText] = createSignal("omms: ⧖");
    const removeSlot = context.ui.slot({
      append: "prompt.footer.status",
      render: () =>
        jsx("text", {
          get fg() {
            return context.theme?.text?.muted;
          },
          get children() {
            return text();
          },
        }),
    });
    let stop: (() => void) | undefined;
    try {
      const { startInstalledTuiStatus } = await import("../dist/adapters/opencode/tui-status.js");
      stop = await startInstalledTuiStatus({
        setText,
        notify: (message: string) =>
          context.ui.toast.show({ title: "OMMS", message, variant: "info", duration: 10_000 }),
      });
    } catch {
      setText("omms: ✘");
    }
    // Recall rows are independent of the footer: a failure here leaves the footer as it is.
    let stopRecall: (() => void) | undefined;
    try {
      const { startTuiRecall } = await import("../dist/adapters/opencode/tui-recall.js");
      stopRecall = startTuiRecall({
        client: context.client,
        data: context.data,
        ui: context.ui,
        keymap: context.keymap,
        storage: context.storage,
        createSignal,
        jsx,
        muted: () => context.theme?.text?.muted,
      });
    } catch {
      // No rows; the footer keeps working.
    }
    return () => {
      stopRecall?.();
      stop?.();
      removeSlot();
    };
  },
};
