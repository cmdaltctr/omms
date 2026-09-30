import { describe, expect, it } from "bun:test";
import { parseNetstatListeners } from "./port-listeners.js";

describe("parseNetstatListeners", () => {
  it("returns each process listening on the port once, and skips other ports and states", () => {
    const text = [
      "Active Connections",
      "",
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    0.0.0.0:4747           0.0.0.0:0              LISTENING       1234",
      "  TCP    127.0.0.1:4747         0.0.0.0:0              LISTENING       1234",
      "  TCP    127.0.0.1:47470        0.0.0.0:0              LISTENING       5678",
      "  TCP    127.0.0.1:4747         127.0.0.1:50000        ESTABLISHED     1234",
      "  TCP    [::1]:4747             [::]:0                 LISTENING       4321",
    ].join("\r\n");
    expect(parseNetstatListeners(text, 4747)).toEqual(["1234", "4321"]);
  });
});
