import { beforeEach, expect, it, mock } from "bun:test";
import {
  allText,
  byText,
  installFetch,
  installReact,
  resetRender,
  settle,
  type Node,
} from "./space-kit.tsx";

installReact();
mock.module("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

const { TagMigrationDialog } =
  await import("../src/lib/components/explorer/TagMigrationDialog.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [TagMigrationDialog];
let completed = 0;
let held: Promise<void> = Promise.resolve();
const page = <TagMigrationDialog open count={3} onComplete={() => completed++} />;

beforeEach(() => {
  resetRender();
  setLanguage("en");
  completed = 0;
});

async function start(): Promise<Node[]> {
  const tree = await settle(page, own);
  const button = byText(tree, Button, "Start Migration")[0];
  expect(button).toBeDefined();
  // Hold the request so the page renders once while the run is busy, as React does.
  let release = () => {};
  held = new Promise<void>((resolve) => (release = resolve));
  const run = (button.props.onClick as () => Promise<void>)();
  await settle(page, own);
  release();
  await run;
  return settle(page, own);
}

it("keeps the dialog open and tells the user to top up when the model has no credit", async () => {
  installFetch(async () => {
    await held;
    return {
      body: {
        success: true,
        data: {
          processed: 1,
          total: 3,
          hasMore: false,
          tagged: 0,
          failed: 1,
          errorKind: "no_credit",
          error: "API error: 402 - Insufficient Balance",
        },
      },
    };
  });
  const tree = await start();
  const words = allText(tree);
  expect(words).toContain("no credit left");
  expect(words).toContain("Reply from the model: API error: 402 - Insufficient Balance");
  expect(words).not.toContain("Migration completed successfully");
  expect(byText(tree, Button, "Try again")).toHaveLength(1);
  expect(completed).toBe(0);
});

it("still reports success when every memory was tagged", async () => {
  installFetch(() => ({
    body: {
      success: true,
      data: { processed: 3, total: 3, hasMore: false, tagged: 3, failed: 0 },
    },
  }));
  const words = allText(await start());
  expect(words).toContain("Migration completed successfully");
  expect(words).not.toContain("no credit");
});
