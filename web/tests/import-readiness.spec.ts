import { expect, it } from "bun:test";
import {
  externalOptionLabel,
  watchReadiness,
} from "../src/lib/components/settings/ImportSection.tsx";
import { publishSettingsSnapshot } from "../src/lib/settings-api.ts";

const s = (message: string) => message;

it("names the saved external API without its model", () => {
  expect(externalOptionLabel({ external: { state: "ready" } }, s)).toBe("Saved external API");
  expect(externalOptionLabel({ external: { state: "missing-key" } }, s)).toBe(
    "Saved external API — not ready"
  );
});

it("reloads readiness when a settings save publishes a snapshot", () => {
  let reloads = 0;
  const stop = watchReadiness(() => reloads++);
  publishSettingsSnapshot({ revision: "r2" });
  expect(reloads).toBe(1);
  stop();
  publishSettingsSnapshot({ revision: "r3" });
  expect(reloads).toBe(1);
});
