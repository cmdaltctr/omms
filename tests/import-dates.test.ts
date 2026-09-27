import { expect, it } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

it("sends prompt date limits as the start and end of the local day, not UTC", () => {
  const helper = pathToFileURL(join(import.meta.dir, "../web/src/lib/import-dates.ts")).href;
  const script = `
    const { localDayStart, localDayEnd } = await import(${JSON.stringify(helper)});
    const lateTurn = new Date(2026, 0, 31, 23, 30).getTime();
    const earlyTurn = new Date(2026, 0, 1, 0, 30).getTime();
    console.log(JSON.stringify({
      start: localDayStart("2026-01-01"),
      end: localDayEnd("2026-01-31"),
      lateIncluded: lateTurn <= localDayEnd("2026-01-31"),
      earlyIncluded: earlyTurn >= localDayStart("2026-01-01"),
      utcEnd: Date.parse("2026-01-31") + 86_399_999,
      invalid: localDayStart("31/01/2026") ?? null,
    }));
  `;
  const proc = Bun.spawnSync(["bun", "-e", script], {
    env: { ...process.env, TZ: "Asia/Kuala_Lumpur" },
  });
  const result = JSON.parse(proc.stdout.toString());
  // Midnight in UTC+8 is 16:00 UTC on the previous day.
  expect(result.start).toBe(Date.parse("2025-12-31T16:00:00.000Z"));
  expect(result.end).toBe(Date.parse("2026-01-31T15:59:59.999Z"));
  expect(result.lateIncluded).toBe(true);
  expect(result.earlyIncluded).toBe(true);
  // The server's UTC reading of a bare date would have shifted the range by eight hours.
  expect(result.utcEnd).not.toBe(result.end);
  expect(result.invalid).toBeNull();
});
