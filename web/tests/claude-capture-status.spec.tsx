import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaudeCaptureStatus } from "../src/lib/components/settings/ClaudeCaptureStatus.tsx";

it("says Claude Code capture is off and names the missing setting", () => {
  const html = renderToStaticMarkup(
    <ClaudeCaptureStatus status={{ ready: false, issues: ["memoryApiKey is not configured"] }} />
  );
  expect(html).toContain("Claude Code");
  expect(html).toContain("Claude Code capture is off");
  expect(html).toContain("memoryApiKey is not configured");
  expect(html).toContain('role="alert"');
  expect(html).not.toContain("Claude Code capture uses the external API.");
});

it("says Claude Code capture uses the external API when it is ready", () => {
  const html = renderToStaticMarkup(
    <ClaudeCaptureStatus status={{ ready: true, mode: "manual", issues: [] }} />
  );
  expect(html).toContain("Claude Code capture uses the external API.");
  expect(html).not.toContain("capture is off");
  expect(html).not.toContain('role="alert"');
});

it("shows no capture state before the settings load", () => {
  const html = renderToStaticMarkup(<ClaudeCaptureStatus />);
  expect(html).not.toContain("capture is off");
  expect(html).not.toContain("uses the external API");
});
