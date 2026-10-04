import { useEffect, useState } from "react";
import { onSettingsSnapshot, reloadSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { versionNotice, type VersionInfo } from "$lib/external-api-settings";

type Snapshot = { revision: string; settings: Record<string, { globalValue?: unknown }> };
type LoginItem = { state: string; command?: string };

export function WebAppSection() {
  const s = useSettingsText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [item, setItem] = useState<LoginItem>();
  const [version, setVersion] = useState<VersionInfo>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    void settingsRequest<LoginItem>("/api/settings/web-autostart")
      .then((value) => {
        if (active) setItem(value);
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    void settingsRequest<VersionInfo>("/api/settings/version")
      .then((value) => {
        if (active) setVersion(value);
      })
      .catch(() => {});
    const unsubscribe = onSettingsSnapshot((value) => {
      if (active) setSnapshot(value as Snapshot);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  async function save(enabled: boolean) {
    if (!snapshot) return;
    setBusy(true);
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          edits: { webServerAutoStart: enabled },
          revision: snapshot.revision,
        }),
      });
      setMessage(s("Saved. The login item changes at the next Pi or OpenCode start."));
    } catch (error) {
      setMessage((error as Error).message);
    }
    await reloadSettingsSnapshot<Snapshot>();
    setBusy(false);
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Web app")}
    >
      <h2 className="text-section-title font-semibold">{s("Web app")}</h2>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(snapshot?.settings.webServerAutoStart?.globalValue)}
          disabled={busy || !snapshot}
          onChange={(event) => void save(event.target.checked)}
        />
        {s("Start web app at login")}
      </label>
      <p className="text-sm">
        {s("Login item")}: {s(item?.state ?? "not installed")}
      </p>
      {item?.state === "unsupported" && (
        <p role="status">{s("Login items are unsupported on this platform.")}</p>
      )}
      {item?.state === "no-runtime" && (
        <p role="status">{s("Install Node or Bun to start the web app at login.")}</p>
      )}
      {version && <VersionNotice info={version} />}
      <p className="text-xs text-muted-foreground">
        {s("Use these commands to apply the change now:")}
      </p>
      <div className="space-y-1 font-mono text-xs">
        <p>om-memory-system web</p>
        <p>om-memory-system web install</p>
        <p>om-memory-system web uninstall</p>
        <p>om-memory-system web status</p>
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}

export function VersionNotice({ info }: { info: VersionInfo }) {
  const s = useSettingsText();
  const notice = versionNotice(info);
  return (
    <div className="space-y-1 text-sm">
      <p>
        {s("Running version")}: {info.running} · {s("Global command")}:{" "}
        {info.global ?? s("not installed globally")}
      </p>
      {notice.kind === "older" && (
        <p role="status">
          {s(
            "A newer OMMS copy runs in place of the global install. The global install is optional. To update it:"
          )}
        </p>
      )}
      {notice.kind === "newer" && (
        <p role="status" className="text-amber-600">
          {s(
            "The global install is newer than the running OMMS. The next Pi or OpenCode start replaces the web app."
          )}
        </p>
      )}
      {notice.kind === "missing" && (
        <p className="text-xs text-muted-foreground">
          {s("OMMS is not installed globally. A global install is optional.")}
        </p>
      )}
      {notice.command && <p className="font-mono text-xs">{notice.command}</p>}
    </div>
  );
}
