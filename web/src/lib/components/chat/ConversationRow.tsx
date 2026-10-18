import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import { useI18n } from "$lib/i18n";
import type { ChatConversation, ChatFolder } from "$lib/chat-api";
import { cn } from "$lib/utils";
import { MoveToFolderMenu } from "./MoveToFolderMenu";

type Props = {
  conversation: ChatConversation;
  folders: ChatFolder[];
  active: boolean;
  selectMode: boolean;
  selected: boolean;
  actionsOpen: boolean;
  readOnly: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
  onToggleActions: () => void;
  onRename: () => void;
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
};

/** One chat in the list: open it, or tick it in select mode, with its own actions. */
export function ConversationRow(props: Props) {
  const { t } = useI18n();
  const { conversation, active, selectMode } = props;
  const title = conversation.title || t("chat-new");

  if (selectMode) {
    return (
      <li>
        <label className="flex min-h-11 md:min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-interactive-hover">
          <Checkbox
            checked={props.selected}
            onCheckedChange={props.onToggleSelect}
            aria-label={t("chat-select-chat", { title })}
          />
          <span dir="auto" className="min-w-0 flex-1 truncate" title={title}>
            {title}
          </span>
        </label>
      </li>
    );
  }

  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-lg",
          active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-interactive-hover"
        )}
      >
        <button
          type="button"
          className="min-h-11 md:min-h-9 min-w-0 flex-1 cursor-pointer overflow-hidden rounded-lg px-2 text-start text-sm focus-visible:outline-2 focus-visible:outline-ring"
          aria-current={active ? "true" : undefined}
          title={title}
          onClick={props.onOpen}
        >
          {/* text-overflow does not apply to a button's own text, so the ellipsis sits on this block. */}
          <span dir="auto" className="block truncate">
            {title}
          </span>
        </button>
        {props.readOnly ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="me-1 shrink-0 text-muted-foreground"
            aria-label={t("chat-chat-actions")}
            aria-expanded={props.actionsOpen}
            onClick={props.onToggleActions}
          >
            <MoreHorizontal />
          </Button>
        )}
      </div>
      {props.actionsOpen ? (
        <div className="ms-2 mt-1 mb-2 grid gap-1.5 rounded-lg border border-border bg-card p-2">
          <MoveToFolderMenu
            folders={props.folders}
            folderId={conversation.folderId}
            onMove={props.onMove}
          />
          <div className="flex gap-1.5">
            <Button type="button" variant="outline" size="xs" onClick={props.onRename}>
              <Pencil />
              {t("chat-rename")}
            </Button>
            <Button type="button" variant="destructive" size="xs" onClick={props.onDelete}>
              <Trash2 />
              {t("chat-delete")}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
