import { useState } from "react";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Select } from "$lib/components/ui/select";
import { useSettingsText } from "$lib/i18n/settings";
import { formatDateOnly } from "$lib/format";

export type ApiToken = {
  id: string;
  name: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
};

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
  const date = (value: number | null) => (value === null ? s("Never") : formatDateOnly(value));
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
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={busy}
                  onClick={() => onRevoke(token)}
                >
                  {s("Revoke")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {newValue && (
        <div role="status" className="space-y-1 rounded border border-border p-2 text-xs">
          <code className="block break-all">{newValue}</code>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => void navigator.clipboard?.writeText(newValue)}
          >
            {s("Copy")}
          </Button>
          <p className="text-amber-600">{s("Copy this token now. It will not be shown again.")}</p>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <div className="space-y-1">
          <Label htmlFor="api-token-name">{s("Token name")}</Label>
          <Input
            id="api-token-name"
            placeholder="ci"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="api-token-expiry">{s("Expires after")}</Label>
          <Select
            id="api-token-expiry"
            aria-label={s("Expires after")}
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          >
            {EXPIRY.map(([value, label]) => (
              <option key={value} value={value}>
                {s(label)}
              </option>
            ))}
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !name.trim()}
          onClick={() => onGenerate(name.trim(), expiry === "never" ? null : Number(expiry))}
        >
          {s("Generate token")}
        </Button>
      </div>
    </div>
  );
}
