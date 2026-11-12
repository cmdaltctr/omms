import { beforeEach, expect, it } from "bun:test";

const { setLanguage, t: translate } = await import("../src/lib/i18n/index.ts");
const { tagMigrationFailure } = await import("../src/lib/tag-migration-result.ts");

const t = (key: string, params?: Record<string, string | number>) => translate(key, params);

beforeEach(() => setLanguage("en"));

it("tells the user to top up when the memory model has no credit", () => {
  const failure = tagMigrationFailure(
    {
      processed: 1,
      total: 3,
      hasMore: false,
      tagged: 0,
      failed: 1,
      errorKind: "no_credit",
      error: "API error: 402 - Insufficient Balance",
    },
    t
  );
  expect(failure?.message).toContain("no credit left");
  expect(failure?.message).toContain("Top up the account");
  expect(failure?.message).toContain("0 of 3 memories were tagged");
  expect(failure?.reason).toBe("Reply from the model: API error: 402 - Insufficient Balance");
});

it("points at the API key when the model rejects it", () => {
  const failure = tagMigrationFailure(
    { processed: 1, total: 2, hasMore: false, tagged: 0, failed: 1, errorKind: "auth" },
    t
  );
  expect(failure?.message).toContain("did not accept the API key");
  expect(failure?.reason).toBeUndefined();
});

it("reports the counts when some memories failed for another reason", () => {
  const failure = tagMigrationFailure(
    { processed: 3, total: 3, hasMore: false, tagged: 1, failed: 2, errorKind: "other" },
    t
  );
  expect(failure?.message).toBe(
    "2 of 3 memories could not be tagged. 1 were tagged. Click Try again to retry the rest."
  );
});

it("returns null only when every memory was tagged", () => {
  expect(
    tagMigrationFailure({ processed: 3, total: 3, hasMore: false, tagged: 3, failed: 0 }, t)
  ).toBeNull();
});

it("uses the interface language", () => {
  setLanguage("zh");
  const failure = tagMigrationFailure(
    { processed: 1, total: 3, hasMore: false, tagged: 0, failed: 1, errorKind: "no_credit" },
    t
  );
  expect(failure?.message).toContain("余额不足");
});
