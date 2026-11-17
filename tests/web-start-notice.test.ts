import { describe, expect, it } from "bun:test";
import { webStartNotice } from "../src/services/web-start-notice.js";

describe("webStartNotice", () => {
  it("names the port and the fix for port-busy", () => {
    const notice = webStartNotice("port-busy", 4747);
    expect(notice?.level).toBe("warning");
    expect(notice?.text).toContain("4747");
    expect(notice?.text).toContain("webServerPort");
  });

  it("names Node 22.14 for no-runtime", () => {
    const notice = webStartNotice("no-runtime", 4747);
    expect(notice?.level).toBe("warning");
    expect(notice?.text).toContain("Node 22.14");
  });

  it("gives null for every result that needs no notice", () => {
    for (const result of ["running", "started", "disabled", "start-timeout"] as const) {
      expect(webStartNotice(result, 4747)).toBeNull();
    }
  });
});
