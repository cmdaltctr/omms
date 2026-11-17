import { useEffect, useState } from "react";
import { Loader } from "lucide-react";
import { useSettingsSnapshot } from "@/hooks/useSettingsSnapshot";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import { settingsRequest } from "$lib/settings-api";
import { saveSettingEdits } from "$lib/settings-save";
import { useSettingsText } from "$lib/i18n/settings";
import { useCardText } from "$lib/i18n/settings-cards";
import { versionNotice, type VersionInfo } from "$lib/external-api-settings";
import { SettingRow } from "./SettingRow";
import { ReadOnlyNote } from "./ReadOnlyNote";

type Snapshot = {
  revision: string;
  readOnly?: boolean;
  settings: Record<string, { globalValue?: unknown }>;
};
type LoginItem = { state: string; command?: string };

export function WebAppSection() {
  const s = useSettingsText();
  const t = useCardText();
  const { snapshot, error: loadError } = useSettingsSnapshot<Snapshot>();
  const [item, setItem] = useState<LoginItem>();
  const [version, setVersion] = useState<VersionInfo>();
  const [edit, setEdit] = useState<boolean>();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
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
    return () => {
      active = false;
    };
  }, []);

  const saved = Boolean(snapshot?.settings.webServerAutoStart?.globalValue);
  const enabled = edit ?? saved;
  async function save() {
    if (!snapshot || edit === undefined || edit === saved) return;
    setBusy(true);
    const result = await saveSettingEdits(snapshot.revision, { webServerAutoStart: edit });
    setBusy(false);
    setFailed(!result.success);
    if (result.success) setEdit(undefined);
    setMessage(
      result.success
        ? s(
            "Saved. The login item changes at the next OpenCode or Pi start, or right away with the commands below. With Claude Code alone, run the command yourself."
          )
        : (result.error ?? "")
    );
  }
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Web app")}
    >
      <h2 className="text-section-title font-semibold">{s("Web app")}</h2>
      <p className="text-sm text-muted-foreground">
        {t(
          "OpenCode and Pi start the web app for you. With Claude Code alone, start it yourself with the first command below, or install the login item."
        )}
      </p>
      {loadError ? <p role="alert">{loadError}</p> : null}
      <SettingRow setting="webServerAutoStart" controlId="web-app-autostart">
        <Checkbox
          id="web-app-autostart"
          checked={enabled}
          disabled={busy || !snapshot}
          onCheckedChange={(checked) => {
            setEdit(checked === true);
            setMessage("");
          }}
        />
      </SettingRow>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={
            busy || !snapshot || snapshot.readOnly === true || edit === undefined || edit === saved
          }
          onClick={() => void save()}
        >
          {t("Save")}
        </Button>
        <ReadOnlyNote show={snapshot?.readOnly === true} />
        {busy ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {t("Saving…")}
          </p>
        ) : null}
      </div>
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
        <p role={failed ? "alert" : "status"} className="text-sm">
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
            "The global install is newer than the running OMMS. The next OpenCode, Pi or Claude Code session start replaces the web app."
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
