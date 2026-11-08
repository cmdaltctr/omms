import { useState } from "react";
import {
  Archive,
  ArrowLeftRight,
  DatabaseBackup,
  FolderOpen,
  Pencil,
  Play,
  Trash2,
  Upload,
} from "lucide-react";
import { SpaceLinks } from "./SpaceLinks";
import { SpaceActionButton } from "./SpaceActionButton";
import { SpaceChip } from "./SpaceChip";
import type { SpacesLayout } from "./SpaceViewToggle";
import { Button } from "$lib/components/ui/button";
import { formatBytes, formatDateOnly } from "$lib/format";
import { useI18n } from "$lib/i18n";
import { spaceCardId } from "$lib/space-chip";
import { spacesApi, whyKey, type SpaceAction, type SpaceRow } from "$lib/spaces-api";
import { cn } from "$lib/utils";

export type SpaceCardActions = {
  onSwitch: (space: SpaceRow) => void;
  /** The pencil: the name, the icon and the image. */
  onEdit: (space: SpaceRow) => void;
  /** The ArrowLeftRight button: opens the Transfer dialog with this space as the source. */
  onTransfer: (space: SpaceRow) => void;
  /** The Download button: opens the Export dialog of this space. */
  onExport: (space: SpaceRow) => void;
  onArchive: (space: SpaceRow) => void;
  onBackUp: (space: SpaceRow) => void;
  onDelete: (space: SpaceRow) => void;
};

/**
 * One space as a card, in the design of the Memory page host cards: a chip, the name, a state
 * line and the facts, a pencil at the top-end corner, then the actions. Activate is a text
 * button. Archive, Back up, Open folder and Delete are icon-only buttons with a tooltip. An archived space has no card: it lives on the Archive page. A blocked action
 * stays visible and disabled, and its tooltip gives the reason. The card's id is the target of
 * its sidebar tree link.
 */
export function SpaceCard({
  space,
  busy,
  actions,
  layout = "grid",
  linkSpaces,
  onLinksChanged,
}: {
  space: SpaceRow;
  /** An action is running; every button waits. */
  busy: boolean;
  actions: SpaceCardActions;
  /** In a list the card is one row: the chip and facts, then the actions. */
  layout?: SpacesLayout;
  /** Every space of the page, for the linked-spaces picker. */
  linkSpaces?: SpaceRow[];
  /** The page reloads its list after a link changed. */
  onLinksChanged?: () => void;
}) {
  const { t } = useI18n();
  const [folderError, setFolderError] = useState<string | null>(null);
  const nameId = `space-${space.id}-name`;
  const status = space.active ? "active" : "available";
  const reasonOf = (action: SpaceAction): string | undefined => {
    const reason = space.disabled[action];
    // The active card has no Activate button, so the "already active" reason is never shown.
    if (reason === undefined || (action === "switch" && reason === "active")) return undefined;
    return t(whyKey(action, reason));
  };
  const reasonId = (action: string) => `space-${space.id}-why-${action}`;
  const shared = (action: SpaceAction) => ({
    reason: reasonOf(action),
    reasonId: reasonId(action),
    busy,
  });
  // The name and the tooltip carry the folder path, because the folder id no longer mirrors the name.
  const openFolderLabel = space.folder
    ? `${t("spaces-action-open-folder")}: ${space.folder}`
    : t("spaces-action-open-folder");
  // The server opens the folder in the system file manager; only a failure needs words here.
  const openFolder = async () => {
    setFolderError(null);
    const result = await spacesApi.openFolder(space.id);
    if (!result.success) setFolderError(result.error ?? "");
  };

  return (
    <li className="min-w-0">
      <div
        id={spaceCardId(space.id)}
        className={cn(
          "relative flex h-full min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border bg-card p-4 text-start",
          space.active ? "border-status-success" : "border-border",
          layout === "list" && "sm:flex-row sm:items-center sm:gap-4 sm:pe-12"
        )}
      >
        <SpaceChip name={space.name} look={space.look} />
        <div className={cn("min-w-0 space-y-1", layout === "list" && "sm:flex-1")}>
          <h3 id={nameId} className="block break-words text-subsection-title font-semibold">
            <bdi>{space.name}</bdi>
          </h3>
          <p
            className={cn(
              "break-words text-xs",
              space.active ? "font-medium text-status-success" : "text-muted-foreground"
            )}
          >
            {t("spaces-state", { state: t(`spaces-status-${status}`) })}
          </p>
          <p className="break-words text-xs text-muted-foreground">
            {t("spaces-size", { size: formatBytes(space.sizeBytes) })}
          </p>
          <p className="break-words text-xs text-muted-foreground">
            {space.createdAt
              ? t("spaces-created", { date: formatDateOnly(space.createdAt) })
              : t("spaces-created-none")}
          </p>
          {/* The Default space holds every project already, so it has no links. */}
          {space.id !== "default" && linkSpaces && onLinksChanged ? (
            <SpaceLinks space={space} spaces={linkSpaces} busy={busy} onChanged={onLinksChanged} />
          ) : null}
          {folderError ? (
            <p role="alert" className="break-words text-xs text-destructive-label">
              {folderError}
            </p>
          ) : null}
        </div>
        <div
          className={cn(
            "flex flex-wrap items-center gap-1.5",
            layout === "list" && "sm:justify-end"
          )}
        >
          {space.active ? null : (
            <SpaceActionButton
              {...shared("switch")}
              label={t("spaces-action-switch")}
              icon={Play}
              onClick={() => actions.onSwitch(space)}
            />
          )}
          <SpaceActionButton
            reasonId={reasonId("transfer")}
            busy={busy}
            iconOnly
            variant="outline"
            label={t("spaces-action-transfer")}
            icon={ArrowLeftRight}
            onClick={() => actions.onTransfer(space)}
          />
          <SpaceActionButton
            reasonId={reasonId("export")}
            busy={busy}
            iconOnly
            variant="outline"
            label={t("spaces-action-export")}
            icon={Upload}
            onClick={() => actions.onExport(space)}
          />
          <SpaceActionButton
            {...shared("archive")}
            iconOnly
            variant="outline"
            label={t("spaces-action-archive")}
            icon={Archive}
            onClick={() => actions.onArchive(space)}
          />
          <SpaceActionButton
            reasonId={reasonId("backup")}
            busy={busy}
            iconOnly
            variant="outline"
            label={t("spaces-action-backup")}
            icon={DatabaseBackup}
            onClick={() => actions.onBackUp(space)}
          />
          <SpaceActionButton
            reasonId={reasonId("open-folder")}
            busy={busy}
            iconOnly
            variant="outline"
            label={openFolderLabel}
            icon={FolderOpen}
            onClick={() => void openFolder()}
          />
          <SpaceActionButton
            {...shared("delete")}
            iconOnly
            variant="destructive"
            label={t("spaces-action-delete")}
            icon={Trash2}
            onClick={() => actions.onDelete(space)}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute end-2 top-2"
          aria-label={t("spaces-edit-title", { name: space.name })}
          title={t("spaces-edit")}
          disabled={busy}
          onClick={() => actions.onEdit(space)}
        >
          <Pencil aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}
