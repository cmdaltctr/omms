import { useRef, useState, type ReactNode } from "react";
import { useCatalogueText } from "$lib/i18n/settings-catalogue";
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
  const t = useCatalogueText();
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  // A failed run keeps values and a revision from the click, which the card may have reloaded.
  // Confirming again could resend a rejected revision, so the user closes and saves again.
  const [failed, setFailed] = useState(false);
  const confirmed = useRef(false);
  const current = useRef<ConfirmRequest | null>(null);
  const ask = (request: ConfirmRequest) => {
    confirmed.current = false;
    current.current = request;
    setFailed(false);
    setPending(request);
  };
  const dialog = pending ? (
    <SettingsConfirmDialog
      title={pending.title}
      body={pending.body}
      confirmLabel={pending.confirmLabel}
      busyLabel={pending.busyLabel}
      blocked={
        failed
          ? t("Close this dialog and save again, so it shows the current settings.")
          : pending.blocked
      }
      destructive={pending.destructive}
      onConfirm={async () => {
        const request = pending;
        const result = await request.run();
        confirmed.current = result.success;
        // A run that asked a follow-up question (a new request) has not failed.
        if (!result.success && current.current === request) setFailed(true);
        return result;
      }}
      onClose={() => {
        if (!confirmed.current) pending.onCancel?.();
        setFailed(false);
        current.current = null;
        setPending(null);
      }}
    />
  ) : null;
  return { ask, dialog };
}
