import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EmbeddingRunStatus,
  EmbeddingSummary,
} from "../src/lib/components/settings/EmbeddingSection.tsx";
import {
  canApply,
  candidateBody,
  candidateKey,
  confirmation,
  presetUrl,
  type EmbeddingFields,
} from "../src/lib/embedding-settings.ts";

const current = {
  kind: "server" as const,
  url: "http://localhost:11434/v1",
  model: "qwen3-embedding:0.6b",
  dimensions: 1024,
  memoryCount: 3530,
  run: { state: "idle" as const, progress: { processed: 0, total: 0 } },
};
const fields: EmbeddingFields = {
  kind: "server",
  url: "",
  model: "",
  key: "none",
  keyInput: { name: "", path: "", value: "" },
};

it("starts locked: the embedder in use with no editable fields", () => {
  const html = renderToStaticMarkup(<EmbeddingSummary current={current} keySet={false} />);
  expect(html).toContain("qwen3-embedding:0.6b");
  expect(html).toContain("1024");
  expect(html).toContain("3,530");
  expect(html).not.toContain("<input");
});

it("fills the URL from a preset and keeps a typed model name", () => {
  const url = presetUrl("ollama", "");
  expect(url).toBe("http://localhost:11434/v1");
  expect(presetUrl("custom", "http://gpu-box:9000/v1")).toBe("http://gpu-box:9000/v1");
  expect(candidateBody({ ...fields, url, model: "nomic-embed-text" })).toEqual({
    kind: "server",
    url: "http://localhost:11434/v1",
    model: "nomic-embed-text",
    key: { source: "none" },
  });
});

it("enables Apply only after a passing test of the current values", () => {
  const tested = { ...fields, url: "http://localhost:11434/v1", model: "nomic-embed-text" };
  expect(canApply(undefined, tested)).toBe(false);
  const passed = candidateKey(tested);
  expect(canApply(passed, tested)).toBe(true);
  expect(canApply(passed, { ...tested, model: "nomic-embed-text-v2" })).toBe(false);
});

it("states the memory count and the risks before a change", () => {
  const hosted = confirmation(3530, { ...fields, url: "https://openrouter.ai/api/v1" });
  expect(hosted.count).toBe("3,530");
  expect(hosted.risks.join(" ")).toContain("called once for each memory");
  expect(hosted.risks.join(" ")).toContain("Search results are poor");
  expect(hosted.risks.join(" ")).toContain("Restart open OpenCode and Pi sessions");
  const local = confirmation(3530, { ...fields, url: "http://localhost:11434/v1" });
  expect(local.risks.join(" ")).not.toContain("called once for each memory");
});

it("shows progress, and the reason with Retry after a failure", () => {
  const running = renderToStaticMarkup(
    <EmbeddingRunStatus
      run={{ state: "running", progress: { processed: 10, total: 3530 } }}
      onRetry={() => {}}
    />
  );
  expect(running).toContain("10/3530");
  const failed = renderToStaticMarkup(
    <EmbeddingRunStatus
      run={{ state: "failed", progress: { processed: 10, total: 3530 }, error: "503" }}
      onRetry={() => {}}
    />
  );
  expect(failed).toContain("503");
  expect(failed).toContain("Retry");
});
