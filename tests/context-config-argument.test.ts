import { expect, it, mock } from "bun:test";

const profileCalls: unknown[] = [];
mock.module("../src/services/user-profile/profile-context.js", () => ({
  getUserProfileContext: async (config: unknown) => {
    profileCalls.push(config);
    return "PROFILE-BLOCK";
  },
}));

const { CONFIG } = await import("../src/config.js");
const { formatContextForPrompt } = await import("../src/services/context.js");

const results = { results: [{ similarity: 0.8, memory: "Fixed the port clash." }] };
const profileFields = {
  userProfileInjectPreferences: 5,
  userProfileInjectPatterns: 5,
  userProfileInjectWorkflows: 3,
  similarityThreshold: 0.5,
};

it("uses the injectProfile value the caller passes, not the module's CONFIG", async () => {
  const previous = CONFIG.injectProfile;
  try {
    profileCalls.length = 0;
    CONFIG.injectProfile = false;
    const passedOn = { injectProfile: true, ...profileFields };
    const on = await formatContextForPrompt("user", results, undefined, undefined, passedOn);
    expect(on).toContain("PROFILE-BLOCK");
    expect(profileCalls).toEqual([passedOn]);

    CONFIG.injectProfile = true;
    const off = await formatContextForPrompt("user", results, undefined, undefined, {
      injectProfile: false,
      ...profileFields,
    });
    expect(off).not.toContain("PROFILE-BLOCK");
  } finally {
    CONFIG.injectProfile = previous;
  }
});

it("reads the passed value again on every call", async () => {
  const passed = { injectProfile: true, ...profileFields };
  const previous = CONFIG.injectProfile;
  try {
    // The module's own CONFIG says the opposite of the passed object each time.
    CONFIG.injectProfile = false;
    expect(await formatContextForPrompt("user", results, undefined, undefined, passed)).toContain(
      "PROFILE-BLOCK"
    );
    passed.injectProfile = false;
    CONFIG.injectProfile = true;
    expect(
      await formatContextForPrompt("user", results, undefined, undefined, passed)
    ).not.toContain("PROFILE-BLOCK");
    passed.injectProfile = true;
    expect(await formatContextForPrompt("user", results, undefined, undefined, passed)).toContain(
      "PROFILE-BLOCK"
    );
  } finally {
    CONFIG.injectProfile = previous;
  }
});
