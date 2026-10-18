import { useState } from "react";
import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { useI18n } from "$lib/i18n";

/** What a delete confirmation will remove: chats, or a folder with its chats. */
export type DeleteRequest =
  { kind: "chats"; ids: string[] } | { kind: "folder"; id: string; name: string; count: number };

type Props = {
  request: DeleteRequest | null;
  onConfirm: (request: DeleteRequest) => Promise<void>;
  onCancel: () => void;
};

/** The one confirmation for every chat delete. It always states how many chats will go. */
export function DeleteChatsDialog({ request, onConfirm, onCancel }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {request?.kind === "folder"
              ? t("chat-delete-folder-title")
              : t("chat-delete-chats-title")}
          </DialogTitle>
          <DialogDescription>{request ? deleteBody(request, t) : null}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {t("chat-cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              if (!request) return;
              setBusy(true);
              await onConfirm(request);
              setBusy(false);
            }}
          >
            {t("chat-delete-confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function deleteBody(
  request: DeleteRequest,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  return request.kind === "folder"
    ? t("chat-delete-folder-body", { name: request.name, count: request.count })
    : t("chat-delete-chats-body", { count: request.ids.length });
}
