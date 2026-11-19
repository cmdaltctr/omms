import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** A notice that OMMS work in a Pi session shows to the user. */
export interface PiNotice {
  title: string;
  message: string;
  variant: "success" | "warning" | "error" | "info";
}

/**
 * The notice sender for one Pi session context. Pi has no success level, so success shows
 * as info. Shows nothing without a user interface. Never throws: Pi makes a context stale
 * when the user replaces or reloads the session, and then `hasUI` and `ui` throw. Work that
 * already finished, such as a saved memory or profile, must not fail for a lost notice.
 */
export function piNotifier(
  ctx: Pick<ExtensionContext, "hasUI" | "ui">
): (notification: PiNotice) => void {
  return (notification) => {
    try {
      if (!ctx.hasUI) return;
      const level: "error" | "warning" | "info" =
        notification.variant === "success" ? "info" : notification.variant;
      ctx.ui.notify(`${notification.title}: ${notification.message}`, level);
    } catch {
      // A stale session context: the notice has nowhere to go.
    }
  };
}
