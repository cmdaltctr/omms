/**
 * OpenCode TUI entry: shows "omms:connected" in the prompt footer, and a toast
 * when a newer om-memory-system is on npm. OpenCode compiles this file itself;
 * the logic lives in dist/adapters/opencode/tui-status.js.
 */
import { createSignal } from "solid-js";

export default {
  id: "omms.tui",
  async setup(context: any) {
    const [text, setText] = createSignal("omms:warming");
    const removeSlot = context.ui.slot({
      append: "prompt.footer.status",
      render: () => <text fg={context.theme?.textMuted}>{text()}</text>,
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
      setText("omms:error");
    }
    return () => {
      stop?.();
      removeSlot();
    };
  },
};
