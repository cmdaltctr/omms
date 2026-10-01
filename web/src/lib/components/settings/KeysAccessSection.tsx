import { useEffect, useState } from "react";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
  withBusy,
} from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import {
  credentialStates,
  passwordStatusMessage,
  type CredentialInput,
  type CredentialState,
} from "$lib/credential-states";
import { ApiTokensTable, revokeAfterConfirm, type ApiToken } from "./ApiTokensTable";
import { cn } from "$lib/utils";
import { caption, tableWrap, td, th, thead, tr } from "./table-styles";

type Snapshot = {
  revision: string;
  secrets: CredentialInput["secrets"];
  effective: { opencode?: { mode?: string }; pi?: { kind: string } };
  claudeFolder?: { exists: boolean };
  /** A recorded Claude Code capture, or a folder saved on the page; the default folder is not evidence. */
  claudeCodeEvidence?: { attempts: boolean; folderSet: boolean };
  access?: CredentialInput["access"] & { authUsername: string | null; configTokenIgnored: boolean };
};

/** The card's input from a settings snapshot; missing fields read as "not in use". */
export function credentialInput(snapshot: Snapshot): CredentialInput {
  return {
    secrets: snapshot.secrets ?? {},
    externalUsed:
      snapshot.effective?.opencode?.mode === "manual" || snapshot.effective?.pi?.kind === "manual",
    claudeCodeInUse: Boolean(
      snapshot.claudeCodeEvidence?.attempts || snapshot.claudeCodeEvidence?.folderSet
    ),
    access: snapshot.access ?? {
      host: "127.0.0.1",
      authEnabled: false,
      tokenAvailable: false,
      embeddingApiUrl: null,
    },
  };
}

const ROWS = [
  {
    id: "memoryApiKey",
    label: "External API key",
    purpose: "Capture and profile learning through the external API. Claude Code always uses it.",
    hosts: "OpenCode, Pi, Claude Code",
    where: "External API card",
  },
  {
    id: "embeddingApiKey",
    label: "Embedding server key",
    purpose: "Sent to an embedding server on another machine.",
    hosts: "OpenCode, Pi, Claude Code",
    where: "Embedding card",
  },
  {
    id: "apiTokens",
    label: "API tokens",
    purpose: "Let scripts and other computers call the web app's API.",
    hosts: "Web app",
    where: "Table below",
  },
  {
    id: "webPassword",
    label: "Browser password",
    purpose: "Asks for a user name and password before the page opens.",
    hosts: "Web app",
    where: "Form below",
  },
] as const;

function StateBadge({ state }: { state: CredentialState }) {
  const s = useSettingsText();
  if (state === "set") return <span>✅ {s("set")}</span>;
  if (state === "missing") return <span className="text-red-600">⛔️ {s("missing")}</span>;
  if (state === "never-used") {
    return <span className="text-muted-foreground">{s("never used before")}</span>;
  }
  return <span className="text-muted-foreground">{s("not needed")}</span>;
}

export function CredentialRows({ states }: { states: ReturnType<typeof credentialStates> }) {
  const s = useSettingsText();
  return (
    <div className={tableWrap}>
      <table className="w-full text-sm">
        <caption className={cn(caption, "sr-only")}>{s("Keys and access")}</caption>
        <thead className={thead}>
          <tr>
            <th className={th}>{s("Credential")}</th>
            <th className={th}>{s("State")}</th>
            <th className={th}>{s("Used for")}</th>
            <th className={th}>{s("Hosts")}</th>
            <th className={th}>{s("Change it in")}</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.id} className={cn(tr, "align-top")}>
              <td className={cn(td, "font-medium")}>{s(row.label)}</td>
              <td className={cn(td, "whitespace-nowrap")}>
                <StateBadge state={states[row.id]} />
              </td>
              <td className={td}>{s(row.purpose)}</td>
              <td className={td}>{row.hosts === "Web app" ? s("Web app") : row.hosts}</td>
              <td className={td}>{s(row.where)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type PasswordInput = { username: string; value: string };

/** The user name and password inputs, each with a visible label. */
export function PasswordFields({
  value,
  onChange,
}: {
  value: PasswordInput;
  onChange: (next: PasswordInput) => void;
}) {
  const s = useSettingsText();
  return (
    <>
      <label className="block">
        <span>{s("User name")}</span>
        <input
          className="mt-1 block w-full rounded border border-border bg-background p-2"
          autoComplete="username"
          value={value.username}
          onChange={(event) => onChange({ ...value, username: event.target.value })}
        />
      </label>
      <label className="block">
        <span>{s("Password")}</span>
        <input
          type="password"
          autoComplete="new-password"
          className="mt-1 block w-full rounded border border-border bg-background p-2"
          value={value.value}
          onChange={(event) => onChange({ ...value, value: event.target.value })}
        />
      </label>
    </>
  );
}

export function KeysAccessSection() {
  const s = useSettingsText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [local, setLocal] = useState(false);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [newValue, setNewValue] = useState<string>();
  const [password, setPassword] = useState({ username: "", value: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadTokens() {
    const list = await settingsRequest<{ tokens: ApiToken[] }>("/api/settings/tokens");
    setTokens(list.tokens);
  }

  useEffect(() => {
    let active = true;
    const read = beginSettingsRead();
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => {
        if (active && read.isCurrent()) setSnapshot(value);
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    void settingsRequest<{ isLocal?: boolean }>("/api/web/status")
      .then(async (status) => {
        if (!active || !status.isLocal) return;
        setLocal(true);
        await loadTokens();
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

  async function act(action: () => Promise<void>) {
    await withBusy(setBusy, async () => {
      try {
        await action();
      } catch (error) {
        setMessage((error as Error).message);
      }
      await reloadSettingsSnapshot<Snapshot>();
    }).catch(() => {});
  }

  const generate = (name: string, expiresInDays: number | null) =>
    act(async () => {
      const created = await settingsRequest<{ value: string }>("/api/settings/tokens", {
        method: "POST",
        body: JSON.stringify({ name, expiresInDays }),
      });
      setNewValue(created.value);
      setMessage("");
      await loadTokens();
    });

  const revoke = (token: ApiToken) =>
    act(async () => {
      setNewValue(undefined);
      await revokeAfterConfirm(
        () => window.confirm(s("Revoke this token? Scripts that use it stop working.")),
        async () => {
          await settingsRequest(`/api/settings/tokens/${token.id}`, { method: "DELETE" });
          await loadTokens();
        }
      );
    });

  const savePassword = (clear: boolean) =>
    act(async () => {
      if (!snapshot) return;
      await settingsRequest("/api/settings/web-password", {
        method: "POST",
        body: JSON.stringify(
          clear
            ? { clear: true, revision: snapshot.revision }
            : {
                password: password.value,
                username: password.username,
                revision: snapshot.revision,
              }
        ),
      });
      // The password leaves the page as soon as it is saved.
      setPassword({ username: "", value: "" });
      setMessage(s(passwordStatusMessage(clear)));
    });

  const access = snapshot?.access;
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Keys and access")}
    >
      <h2 className="text-lg font-medium">{s("Keys and access")}</h2>
      {snapshot && <CredentialRows states={credentialStates(credentialInput(snapshot))} />}
      {access?.configTokenIgnored && (
        <p className="text-xs text-amber-600">
          {s(
            "The config file still sets webServerApiToken. OMMS imported it once as the token “from config file” and no longer reads the key. Use the token table instead."
          )}
        </p>
      )}
      {!local ? (
        <p className="text-sm text-muted-foreground">
          {s("Open this page on the computer that runs OMMS to manage tokens and the password.")}
        </p>
      ) : (
        <>
          <h3 className="font-medium">{s("API tokens")}</h3>
          <ApiTokensTable
            tokens={tokens}
            newValue={newValue}
            busy={busy}
            onGenerate={(name, days) => void generate(name, days)}
            onRevoke={(token) => void revoke(token)}
          />
          <fieldset className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <legend className="px-1 font-medium">{s("Browser password")}</legend>
            <p className="text-xs text-muted-foreground">
              {!access?.authEnabled
                ? s("No browser password is set.")
                : access.authUsername
                  ? `${s("A browser password is set for user")} ${access.authUsername}.`
                  : s("A browser password is set for your computer user name.")}
            </p>
            <PasswordFields value={password} onChange={setPassword} />
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded border border-border px-3 py-1.5"
                disabled={busy || !snapshot || !password.value}
                onClick={() => void savePassword(false)}
              >
                {s("Save password")}
              </button>
              <button
                type="button"
                className="rounded border border-border px-3 py-1.5"
                disabled={busy || !snapshot || !access?.authEnabled}
                onClick={() => void savePassword(true)}
              >
                {s("Clear password")}
              </button>
            </div>
          </fieldset>
        </>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
