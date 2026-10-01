import { describe, expect, it } from "bun:test";
import {
  resolveProfileUserId,
  type ProfileIdentityDeps,
} from "../src/services/profile-identity.js";

function deps(over: Partial<ProfileIdentityDeps> = {}): ProfileIdentityDeps {
  return {
    cwdGitEmail: () => null,
    globalGitEmail: () => null,
    activeProfileUserIds: async () => [],
    ...over,
  };
}

describe("resolveProfileUserId", () => {
  it("uses userEmailOverride before any git email", async () => {
    const id = await resolveProfileUserId(
      { userEmailOverride: "me@example.com" },
      deps({ cwdGitEmail: () => "bot@example.com" })
    );
    expect(id).toBe("me@example.com");
  });

  it("uses the working directory's git email next", async () => {
    const id = await resolveProfileUserId(
      {},
      deps({ cwdGitEmail: () => "bot@example.com", globalGitEmail: () => "me@example.com" })
    );
    expect(id).toBe("bot@example.com");
  });

  it("falls back to the global git email outside a project", async () => {
    const id = await resolveProfileUserId({}, deps({ globalGitEmail: () => "me@example.com" }));
    expect(id).toBe("me@example.com");
  });

  it("uses the only active profile when no email is found", async () => {
    const id = await resolveProfileUserId(
      {},
      deps({ activeProfileUserIds: async () => ["solo@example.com"] })
    );
    expect(id).toBe("solo@example.com");
  });

  it("returns null when no email is found and several profiles exist", async () => {
    const id = await resolveProfileUserId(
      { userEmailOverride: "  " },
      deps({ activeProfileUserIds: async () => ["a@example.com", "b@example.com"] })
    );
    expect(id).toBeNull();
  });
});
