import { useState } from "react";
import { settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";

type Check = { check: string; status: "pass" | "warn" | "fail"; reason: string };

export function HealthSection() {
  const s = useSettingsText();
  const [checks, setChecks] = useState<Check[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(testModels: boolean) {
    setBusy(true);
    try {
      const response = await settingsRequest<{ checks: Check[] }>("/api/settings/health", {
        method: "POST",
        body: JSON.stringify({ testModels }),
      });
      setChecks(response.checks);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="settings-health"
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Health")}
    >
      <h2 className="text-section-title font-semibold">{s("Health")}</h2>
      <div className="flex gap-2">
        <button
          className="rounded-lg border border-border px-3 py-1.5 text-sm"
          disabled={busy}
          onClick={() => void run(false)}
        >
          {s("Run checks")}
        </button>
        <button
          className="rounded-lg border border-border px-3 py-1.5 text-sm"
          disabled={busy}
          onClick={() => void run(true)}
        >
          {s("Run checks and test models")}
        </button>
      </div>
      {busy && <p role="status">{s("Checking…")}</p>}
      {error && <p role="alert">{error}</p>}
      <ul className="space-y-2 text-sm">
        {checks.map((row) => (
          <li className="rounded-lg border border-border p-2" key={row.check}>
            <strong
              className={
                row.status === "fail"
                  ? "text-red-600"
                  : row.status === "warn"
                    ? "text-amber-600"
                    : "text-green-600"
              }
            >
              {s(row.status).toUpperCase()}
            </strong>{" "}
            · {s(row.check)}: {row.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}
