import { expect, it } from "bun:test";
import { hostName } from "../src/lib/host-label.ts";
import { diagnosticsPath } from "../src/lib/components/settings/DiagnosticsSection.tsx";

it("shows each host id by its display name", () => {
  expect(hostName("claude-code")).toBe("Claude Code");
  expect(hostName("opencode")).toBe("OpenCode");
  expect(hostName("pi")).toBe("Pi");
  expect(hostName("something-else")).toBe("something-else");
});

it("sends the host choice to the server, and no host for All", () => {
  expect(diagnosticsPath(7, "claude-code")).toBe(
    "/api/settings/diagnostics?days=7&host=claude-code"
  );
  expect(diagnosticsPath(30, "all")).toBe("/api/settings/diagnostics?days=30");
});
