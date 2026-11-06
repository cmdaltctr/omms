import { useState } from "react";
import { SpaceChip } from "./SpaceChip";
import { AvatarEditorDialog } from "$lib/components/avatar/AvatarEditorDialog";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import type { AvatarChange } from "$lib/avatar-look";
import { useI18n } from "$lib/i18n";
import { whyKey, type SpaceRow } from "$lib/spaces-api";

/**
 * The pencil dialog of a space: the shared avatar dialog with a name field. The name field is
 * disabled when the server does not allow a rename (Default), and the reason shows beside it.
 * The folder keeps its name when the display name changes.
 */
export function SpaceEditDialog({
  space,
  onSave,
  onClose,
}: {
  space: SpaceRow;
  /** Saves the new name (when it changed) and the avatar change. Throws an Error to keep the dialog open. */
  onSave: (name: string | undefined, change: AvatarChange | null) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? space.name;
  const blocked = space.disabled.rename;
  const changed = blocked === undefined && name.trim() !== "" && name !== space.name;
  const reasonId = `space-${space.id}-edit-why`;
  const noteId = `space-${space.id}-edit-note`;

  return (
    <AvatarEditorDialog
      title={t("spaces-edit-title", { name: space.name })}
      look={space.look}
      renderAvatar={(look) => <SpaceChip name={name} look={look} />}
      extraChanged={changed}
      onClose={onClose}
      onSave={(change) => onSave(changed ? name : undefined, change)}
      extra={
        <div className="space-y-1">
          <Label htmlFor="space-edit-name">{t("spaces-edit-name")}</Label>
          <Input
            id="space-edit-name"
            value={name}
            disabled={blocked !== undefined}
            aria-describedby={blocked ? reasonId : noteId}
            onChange={(event) => setDraft(event.target.value)}
          />
          {blocked ? (
            <p id={reasonId} className="text-xs text-muted-foreground">
              {t(whyKey("rename", blocked))}
            </p>
          ) : (
            <p id={noteId} className="text-xs text-muted-foreground">
              {t("spaces-edit-name-note")}
            </p>
          )}
        </div>
      }
    />
  );
}
