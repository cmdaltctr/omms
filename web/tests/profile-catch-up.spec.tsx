import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CatchUpStatus } from "../src/lib/components/settings/ProfileCatchUpSection.tsx";

const noop = () => {};
const preview = { waiting: 2600, calls: 52 };

it("shows the waiting count and the call count before a run", () => {
  const html = renderToStaticMarkup(
    <CatchUpStatus
      preview={preview}
      job={{ state: "idle", batchesBuilt: 0, remaining: 0 }}
      busy={false}
      onStart={noop}
      onPause={noop}
    />
  );
  expect(html).toContain("2600");
  expect(html).toContain("52");
  expect(html).toContain("Catch up profile");
});

it("shows progress and Pause while running, and Resume after a pause", () => {
  const running = renderToStaticMarkup(
    <CatchUpStatus
      preview={preview}
      job={{ state: "running", batchesBuilt: 3, remaining: 2450 }}
      busy={false}
      onStart={noop}
      onPause={noop}
    />
  );
  expect(running).toContain("2450");
  expect(running).toContain("Pause");
  const paused = renderToStaticMarkup(
    <CatchUpStatus
      preview={preview}
      job={{ state: "paused", batchesBuilt: 3, remaining: 2450 }}
      busy={false}
      onStart={noop}
      onPause={noop}
    />
  );
  expect(paused).toContain("Resume");
});

it("says when a newer run took over, and offers Resume", () => {
  const html = renderToStaticMarkup(
    <CatchUpStatus
      preview={preview}
      job={{ state: "superseded", batchesBuilt: 1, remaining: 2550 }}
      busy={false}
      onStart={noop}
      onPause={noop}
    />
  );
  expect(html).toContain("A newer catch-up run took over.");
  expect(html).toContain("Resume");
});

it("shows the failure reason", () => {
  const html = renderToStaticMarkup(
    <CatchUpStatus
      preview={preview}
      job={{ state: "failed", batchesBuilt: 1, remaining: 2550, reason: "timeout" }}
      busy={false}
      onStart={noop}
      onPause={noop}
    />
  );
  expect(html).toContain("timeout");
  expect(html).toContain("Resume");
});
