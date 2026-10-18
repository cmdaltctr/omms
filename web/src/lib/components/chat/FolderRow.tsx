import { useState, type ReactNode } from "react";
import { ChevronRight, Folder, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";
import { cn } from "$lib/utils";

type Props = {
  name: string;
  count: number;
  /** Folder actions; the "No folder" group has none. */
  actions?: { onNewChat: () => void; onRename: () => void; onDelete: () => void };
  /** Shown in select mode for a group that has chats. */
  onSelectAll?: () => void;
  children: ReactNode;
};

/** A collapsible group of chats: one folder, or the chats in no folder. */
export function FolderRow({ name, count, actions, onSelectAll, children }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const Icon = open ? FolderOpen : Folder;
  return (
    <section className="grid gap-0.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex min-h-11 md:min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg px-1.5 text-xs font-medium text-muted-foreground transition-colors duration-200 ease-in hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 transition-transform rtl:-scale-x-100",
              open && "rotate-90"
            )}
            aria-hidden="true"
          />
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate uppercase tracking-wide">{name}</span>
          <span
            className="tabular-nums"
            aria-label={t(count === 1 ? "chat-folder-count-one" : "chat-folder-count", { count })}
          >
            {count}
          </span>
        </button>
        {onSelectAll && count > 0 ? (
          <Button type="button" variant="ghost" size="xs" onClick={onSelectAll}>
            {t("chat-select-all-folder")}
          </Button>
        ) : null}
        {actions && !onSelectAll ? (
          <div
            className="flex shrink-0 items-center"
            role="group"
            aria-label={t("chat-folder-actions")}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("chat-new")}
              title={t("chat-new")}
              onClick={actions.onNewChat}
            >
              <Plus />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("chat-rename")}
              title={t("chat-rename")}
              onClick={actions.onRename}
            >
              <Pencil />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("chat-delete")}
              title={t("chat-delete")}
              onClick={actions.onDelete}
            >
              <Trash2 />
            </Button>
          </div>
        ) : null}
      </div>
      {open ? <ul className="grid gap-0.5 ps-3">{children}</ul> : null}
    </section>
  );
}
