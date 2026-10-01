import { useEffect, useState } from "react";
import { reloadSettingsSnapshot, settingsRequest, withBusy } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { cn } from "$lib/utils";
import { caption, tableWrap, td, th, thead, tr } from "./table-styles";

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
    withBusy(setBusy, async () => {
      if (!window.confirm(`${s("Use this profile for every folder?")} ${profile.userId}`)) return;
      try {
        const snapshot = await reloadSettingsSnapshot<{ revision: string }>();
        await settingsRequest("/api/settings/profiles/use", {
          method: "POST",
          body: JSON.stringify({ userId: profile.userId, revision: snapshot?.revision }),
        });
        await reloadSettingsSnapshot();
        await load();
        setMessage(s("Saved. OMMS now uses this profile in every folder."));
      } catch (error) {
        setMessage((error as Error).message);
      }
    });

  const merge = (source: ProfileSummary) =>
    withBusy(setBusy, async () => {
      const target = profiles.find(
        (p) => p.id === (targets[source.id] ?? profiles.find((x) => x.id !== source.id)?.id)
      );
      if (!target) return;
      if (
        !window.confirm(
          `${s("Merge this profile into the other one? The source profile is turned off, not deleted.")}\n${source.userId} → ${target.userId}`
        )
      )
        return;
      try {
        await settingsRequest("/api/settings/profiles/merge", {
          method: "POST",
          body: JSON.stringify({ sourceId: source.id, targetId: target.id }),
        });
        await load();
        setMessage(s("Merged."));
      } catch (error) {
        setMessage((error as Error).message);
      }
    });

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Profiles")}
    >
      <h2 className="text-lg font-medium">{s("Profiles")}</h2>
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
                    <span className="ms-2 text-xs text-green-700">✅ {s("in use")}</span>
                  )}
                </td>
                <td className={td}>{profile.preferences}</td>
                <td className={td}>{profile.patterns}</td>
                <td className={td}>{profile.workflows}</td>
                <td className={td}>{profile.totalPromptsAnalyzed}</td>
                <td className={td}>{new Date(profile.lastAnalyzedAt).toLocaleString()}</td>
                <td className={cn(td, "space-y-1")}>
                  {!profile.inUse && (
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1"
                      disabled={busy}
                      onClick={() => void use(profile)}
                    >
                      {s("Use this profile")}
                    </button>
                  )}
                  <div className="flex items-center gap-1">
                    <label className="sr-only" htmlFor={`merge-${profile.id}`}>
                      {s("Merge into")}
                    </label>
                    <select
                      id={`merge-${profile.id}`}
                      className="rounded border border-border bg-background px-1 py-1 text-xs"
                      value={targets[profile.id] ?? ""}
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
                    </select>
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1"
                      disabled={busy}
                      onClick={() => void merge(profile)}
                    >
                      {s("Merge into")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
