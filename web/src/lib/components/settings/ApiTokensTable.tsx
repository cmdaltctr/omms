import { useState } from "react";
import { Select } from "$lib/components/ui/select";
import { useSettingsText } from "$lib/i18n/settings";

export type ApiToken = {
  id: string;
  name: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
};

/** Revoke only after the user confirms; returns whether the token was revoked. */
export async function revokeAfterConfirm(
  confirm: () => boolean,
  revoke: () => Promise<void>
): Promise<boolean> {
  if (!confirm()) return false;
  await revoke();
  return true;
}

const EXPIRY = [
  ["7", "7 days"],
  ["30", "30 days"],
  ["90", "90 days"],
  ["never", "Never"],
] as const;

export function ApiTokensTable({
  tokens,
  newValue,
  busy,
  onGenerate,
  onRevoke,
}: {
  tokens: ApiToken[];
  /** The value of the token just generated; shown once, until the next action. */
  newValue?: string;
  busy: boolean;
  onGenerate: (name: string, expiresInDays: number | null) => void;
  onRevoke: (token: ApiToken) => void;
}) {
  const s = useSettingsText();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<string>("30");
  const date = (value: number | null) =>
    value === null ? s("Never") : new Date(value).toLocaleDateString();
  return (
    <div className="space-y-2">
      <table className="w-full text-left text-xs">
        <thead>
          <tr>
            <th>{s("Name")}</th>
            <th>{s("Created")}</th>
            <th>{s("Expires")}</th>
            <th>{s("Last used")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.id}>
              <td>{token.name}</td>
              <td>{date(token.createdAt)}</td>
              <td>{date(token.expiresAt)}</td>
              <td>{token.lastUsedAt === null ? "-" : date(token.lastUsedAt)}</td>
              <td>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-0.5"
                  disabled={busy}
                  onClick={() => onRevoke(token)}
                >
                  {s("Revoke")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {newValue && (
        <div role="status" className="space-y-1 rounded border border-border p-2 text-xs">
          <code className="block break-all">{newValue}</code>
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5"
            onClick={() => void navigator.clipboard?.writeText(newValue)}
          >
            {s("Copy")}
          </button>
          <p className="text-amber-600">{s("Copy this token now. It will not be shown again.")}</p>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="block">
          {s("Token name")}
          <input
            className="mt-1 block rounded border border-border bg-background p-1.5"
            placeholder="ci"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="block">
          {s("Expires after")}
          <Select
            aria-label={s("Expires after")}
            className="mt-1 block rounded border border-border bg-background p-1.5"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          >
            {EXPIRY.map(([value, label]) => (
              <option key={value} value={value}>
                {s(label)}
              </option>
            ))}
          </Select>
        </label>
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5"
          disabled={busy || !name.trim()}
          onClick={() => onGenerate(name.trim(), expiry === "never" ? null : Number(expiry))}
        >
          {s("Generate token")}
        </button>
      </div>
    </div>
  );
}
