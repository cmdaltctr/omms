import { AvatarEditorDialog } from "$lib/components/avatar/AvatarEditorDialog";
import { hostLabel, type WebHost } from "$lib/host-label";
import { useHostLooks } from "$lib/host-looks";
import { useSettingsText } from "$lib/i18n/settings";
import { HostAvatar } from "./HostAvatar";

/** Change one host's avatar: upload an image, choose an icon, or go back to the default mark. */
export function AvatarDialog({ host, onClose }: { host: WebHost; onClose: () => void }) {
  const s = useSettingsText();
  const { looks, setIcon, setImage, reset } = useHostLooks();
  return (
    <AvatarEditorDialog
      title={`${s("Change icon")}: ${hostLabel(host)}`}
      look={looks[host]}
      renderAvatar={(look) => <HostAvatar host={host} look={look} />}
      onClose={onClose}
      onSave={async (change) => {
        if (change === null) return;
        if (change.kind === "reset") await reset(host);
        else if (change.kind === "icon") await setIcon(host, change.icon);
        else await setImage(host, change.png);
      }}
    />
  );
}
