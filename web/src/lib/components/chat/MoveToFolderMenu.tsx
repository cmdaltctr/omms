import { Select } from "$lib/components/ui/select";
import { useI18n } from "$lib/i18n";
import type { ChatFolder } from "$lib/chat-api";

const NO_FOLDER = "__none__";

type Props = {
  folders: ChatFolder[];
  folderId: string | null;
  onMove: (folderId: string | null) => void;
};

/** Moves one chat into a folder, or out of every folder. */
export function MoveToFolderMenu({ folders, folderId, onMove }: Props) {
  const { t } = useI18n();
  return (
    <Select
      className="h-8 w-full text-xs"
      aria-label={t("chat-move")}
      value={folderId ?? NO_FOLDER}
      onChange={(event) => onMove(event.target.value === NO_FOLDER ? null : event.target.value)}
    >
      <option value={NO_FOLDER}>{t("chat-no-folder")}</option>
      {folders.map((folder) => (
        <option key={folder.id} value={folder.id}>
          {folder.name}
        </option>
      ))}
    </Select>
  );
}
