import { useEffect, useState } from "react";
import { CircleCheck } from "lucide-react";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { Button } from "$lib/components/ui/button";
import { Label } from "$lib/components/ui/label";
import { Select } from "$lib/components/ui/select";
import { reloadSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { useCardText } from "$lib/i18n/settings-cards";
import { formatDate } from "$lib/format";
import { cn } from "$lib/utils";
import { caption, tableWrap, td, th, thead, tr } from "./table-styles";
import { ReadOnlyNote, useSettingsReadOnly } from "./ReadOnlyNote";

export type ProfileSummary = {
  id: string;
  userId: string;
  displayName: string;
  preferences: number;
  patterns: number;
  workflows: number;
  totalPromptsAnalyzed: number;
  lastAnalyzedAt: number;
  inUse: boolean;
};

/** Shown only when more than one active profile exists: pick the one in use, or merge two. */
export function ProfilesSection() {
  const s = useSettingsText();
  const readOnly = useSettingsReadOnly();
  const t = useCardText();
  const { ask, dialog } = useSettingsConfirm();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const value = await settingsRequest<{ profiles: ProfileSummary[] }>("/api/settings/profiles");
    setProfiles(value.profiles);
  }

  useEffect(() => {
    void load().catch((error: Error) => setMessage(error.message));
  }, []);

  if (profiles.length < 2) return null;

  const use = (profile: ProfileSummary) =>
    ask({
      title: t("Use this profile for every folder?"),
      body: <bdi dir="ltr">{profile.userId}</bdi>,
      confirmLabel: s("Use this profile"),
      busyLabel: t("Saving…"),
      run: async () => {
        setBusy(true);
        try {
          const snapshot = await reloadSettingsSnapshot<{ revision: string }>();
          await settingsRequest("/api/settings/profiles/use", {
            method: "POST",
            body: JSON.stringify({ userId: profile.userId, revision: snapshot?.revision }),
          });
          await reloadSettingsSnapshot();
          await load();
          setMessage(s("Saved. OMMS now uses this profile in every folder."));
          return { success: true };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        } finally {
          setBusy(false);
        }
      },
    });

  const merge = (source: ProfileSummary) => {
    const target = profiles.find(
      (p) => p.id === (targets[source.id] ?? profiles.find((x) => x.id !== source.id)?.id)
    );
    if (!target) return;
    ask({
      title: s("Merge into"),
      body: (
        <>
          <p>
            {s(
              "Merge this profile into the other one? The source profile is turned off, not deleted."
            )}
          </p>
          <p>
            <bdi dir="ltr">{source.userId}</bdi> → <bdi dir="ltr">{target.userId}</bdi>
          </p>
        </>
      ),
      confirmLabel: s("Merge into"),
      busyLabel: t("Saving…"),
      run: async () => {
        setBusy(true);
        try {
          await settingsRequest("/api/settings/profiles/merge", {
            method: "POST",
            body: JSON.stringify({ sourceId: source.id, targetId: target.id }),
          });
          await load();
          setMessage(s("Merged."));
          return { success: true };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Profiles")}
    >
      <h2 className="text-section-title font-semibold">{s("Profiles")}</h2>
      <p className="text-sm text-muted-foreground">
        {s(
          "OMMS keeps one profile for each git email. A folder whose repository has its own email starts a second profile. Choose the profile that is yours, or merge the extra one into it."
        )}
      </p>
      <div className={tableWrap}>
        <table className="w-full text-sm">
          <caption className={cn(caption, "sr-only")}>{s("Profiles")}</caption>
          <thead className={thead}>
            <tr>
              <th className={th}>{s("Email")}</th>
              <th className={th}>{s("Preferences")}</th>
              <th className={th}>{s("Patterns")}</th>
              <th className={th}>{s("Workflows")}</th>
              <th className={th}>{s("Prompts analysed")}</th>
              <th className={th}>{s("Last update")}</th>
              <th className={th}>{s("Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => (
              <tr key={profile.id} className={tr}>
                <td className={cn(td, "font-medium")}>
                  {profile.userId}
                  {profile.inUse && (
                    <span className="ms-2 inline-flex items-center gap-1 text-xs text-status-success">
                      <CircleCheck className="size-3.5" aria-hidden="true" />
                      {s("in use")}
                    </span>
                  )}
                </td>
                <td className={td}>{profile.preferences}</td>
                <td className={td}>{profile.patterns}</td>
                <td className={td}>{profile.workflows}</td>
                <td className={td}>{profile.totalPromptsAnalyzed}</td>
                <td className={td}>{formatDate(profile.lastAnalyzedAt)}</td>
                <td className={cn(td, "space-y-1")}>
                  {!profile.inUse && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || readOnly}
                      onClick={() => use(profile)}
                    >
                      {s("Use this profile")}
                    </Button>
                  )}
                  <div className="flex items-center gap-1">
                    <Label className="sr-only" htmlFor={`merge-${profile.id}`}>
                      {s("Merge into")}
                    </Label>
                    <Select
                      id={`merge-${profile.id}`}
                      aria-label={s("Merge into")}
                      value={
                        targets[profile.id] ?? profiles.find((p) => p.id !== profile.id)?.id ?? ""
                      }
                      onChange={(event) =>
                        setTargets((all) => ({ ...all, [profile.id]: event.target.value }))
                      }
                    >
                      {profiles
                        .filter((p) => p.id !== profile.id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.userId}
                          </option>
                        ))}
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => merge(profile)}
                    >
                      {s("Merge into")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ReadOnlyNote show={readOnly} />
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {dialog}
    </section>
  );
}
