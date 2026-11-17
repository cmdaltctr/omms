import { useRef, useState, type ReactNode } from "react";
import {
  SettingsConfirmDialog,
  type ConfirmResult,
} from "$lib/components/settings/SettingsConfirmDialog";

/** One pending confirmation: the texts are already translated by the card. */
export type ConfirmRequest = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** Runs only after the user confirms. A failure keeps the dialog open with its reason. */
  run: () => Promise<ConfirmResult>;
  busyLabel?: string;
  /** Why the change cannot go ahead. Keeps the confirm button off. */
  blocked?: string;
  destructive?: boolean;
  /** Runs when the dialog closes without a successful confirm (Cancel, Escape, the close button). */
  onCancel?: () => void;
};

/**
 * Asks before a settings change, in place of `window.confirm`. Call `ask(request)` and render
 * `dialog` once in the card. The dialog mounts only while a request is pending.
 */
export function useSettingsConfirm() {
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const confirmed = useRef(false);
  const ask = (request: ConfirmRequest) => {
    confirmed.current = false;
    setPending(request);
  };
  const dialog = pending ? (
    <SettingsConfirmDialog
      title={pending.title}
      body={pending.body}
      confirmLabel={pending.confirmLabel}
      busyLabel={pending.busyLabel}
      blocked={pending.blocked}
      destructive={pending.destructive}
      onConfirm={async () => {
        const result = await pending.run();
        confirmed.current = result.success;
        return result;
      }}
      onClose={() => {
        if (!confirmed.current) pending.onCancel?.();
        setPending(null);
      }}
    />
  ) : null;
  return { ask, dialog };
}
