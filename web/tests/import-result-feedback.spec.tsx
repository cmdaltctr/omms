import { afterEach, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as react from "react";
import { setLanguage } from "../src/lib/i18n/index";
import type { ImportJob } from "../src/lib/components/memory/import-types";

// Read the client language snapshot during server rendering, as other web specs do.
mock.module("react", () => ({
  ...react,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
const { ImportResults } = await import("../src/lib/components/memory/ImportResults");
afterEach(() => setLanguage("en"));

function renderError(error: string, blocker = false) {
  // Synthetic extra diagnostic data must stay outside the metadata-only display.
  const profile = {
    promptsRecorded: 0,
    promptsWouldRecord: 0,
    batchesBuilt: 0,
    remaining: 0,
    failed: true,
    error: "raw model reply",
  };
  const job: ImportJob = {
    id: "synthetic-feedback",
    dryRun: blocker,
    state: "failed",
    error: blocker ? undefined : error,
    summary: { profile },
    hosts: [{ host: "pi", state: "failed", ...(blocker ? { blocker: error } : { error }) }],
  };
  return renderToStaticMarkup(<ImportResults job={job} />);
}

for (const [language, copy] of [
  [
    "zh",
    {
      memory: "记忆处理失败。",
      profile: "画像学习失败。",
      retry: "请刷新预览后重试。",
      stale: "会话列表已过期。请刷新列表后重试。",
      changed: "历史记录来源已更改。请重新选择。",
      invalid: "历史记录来源已失效。请重新选择。",
      preparation: "导入准备失败。",
      claim: "已有 OpenCode 导入正在运行",
    },
  ],
  [
    "ar",
    {
      memory: "فشلت معالجة الذاكرة.",
      profile: "فشل تعلّم الملف الشخصي.",
      retry: "حدّث المعاينة ثم أعد المحاولة.",
      stale: "قائمة الجلسات قديمة. حدّث القائمة ثم أعد المحاولة.",
      changed: "تغيّر مصدر السجل. اختره مجدداً.",
      invalid: "لم يعد مصدر السجل صالحاً. اختره مجدداً.",
      preparation: "فشل تحضير الاستيراد.",
      claim: "استيراد OpenCode قيد التشغيل بالفعل",
    },
  ],
] as const) {
  it(`${language}: translates grouped memory failures in both host and overall alerts`, () => {
    setLanguage(language);
    const html = renderError("Pi: Memory work failed. Refresh the preview and retry.");
    expect(html.split(copy.memory)).toHaveLength(3);
    expect(html.split(copy.retry)).toHaveLength(3);
    expect(html).toContain('<bdi dir="ltr">Pi</bdi>');
    expect(html).not.toContain("Memory work failed");
  });

  it(`${language}: translates profile failures without exposing model replies`, () => {
    setLanguage(language);
    const html = renderError("OpenCode: Profile learning failed. Refresh the preview and retry.");
    expect(html.split(copy.profile)).toHaveLength(3);
    expect(html).toContain(copy.retry);
    expect(html).not.toContain("Profile learning failed");
    expect(html).not.toContain("raw model reply");
  });

  it(`${language}: translates stale selections and changed or expired sources`, () => {
    setLanguage(language);
    for (const [message, expected] of [
      ["The session list is out of date. Refresh the list and try again.", copy.stale],
      ["The history source changed. Choose it again.", copy.changed],
      ["The history source is no longer valid. Choose it again.", copy.invalid],
    ]) {
      const html = renderError(`Claude Code: ${message}`, true);
      expect(html).toContain(expected);
      expect(html).toContain('<bdi dir="ltr">Claude Code</bdi>');
      expect(html).not.toContain(message);
    }
  });

  it(`${language}: translates competing claims for every host`, () => {
    setLanguage(language);
    for (const [host, article] of [
      ["Pi", "A"],
      ["OpenCode", "An"],
      ["Claude Code", "A"],
    ]) {
      const html = renderError(`${host}: ${article} ${host} import is already running`);
      const plain = html.replace(/<[^>]*>/g, "");
      expect(plain).toContain(copy.claim.replace("OpenCode", host!));
      expect(html).not.toContain("import is already running");
    }
  });

  it(`${language}: translates preparation and retry wording while keeping reason codes literal`, () => {
    setLanguage(language);
    expect(renderError("Import preparation failed. Refresh the preview and retry.")).toContain(
      copy.preparation
    );
    for (const code of [
      "timeout",
      "http-429",
      "invalid-reply",
      "no-tool-call",
      "not-configured",
      "error",
      "future-code",
    ]) {
      const html = renderError(`Pi: ${code}. Refresh the preview and retry.`);
      expect(html).toContain(`<bdi dir="ltr">${code}</bdi>`);
      expect(html).toContain(copy.retry);
      expect(html).not.toContain("Refresh the preview and retry.");
      expect(html).not.toContain("raw model reply");
    }
  });
}

it("preserves English feedback and redacted unknown messages/model identifiers", () => {
  for (const language of ["en", "zh", "ar"] as const) {
    setLanguage(language);
    const unknown = "OpenCode: provider/model-v2 unavailable [REDACTED]";
    const fallback = renderError(unknown);
    expect(fallback.replace(/<[^>]*>/g, "")).toContain(unknown);
    expect(fallback).toContain('<bdi dir="ltr">provider/model-v2 unavailable [REDACTED]</bdi>');
    const code = renderError("Pi: future-code. Refresh the preview and retry.");
    expect(code).toContain("future-code");
    if (language === "en") {
      for (const error of [
        "Pi: Memory work failed. Refresh the preview and retry.",
        "OpenCode: Profile learning failed. Refresh the preview and retry.",
        "Claude Code: The session list is out of date. Refresh the list and try again.",
        "Pi: The history source changed. Choose it again.",
        "Pi: The history source is no longer valid. Choose it again.",
        "Import preparation failed. Refresh the preview and retry.",
        "Pi: future-code. Refresh the preview and retry.",
        "OpenCode: An OpenCode import is already running",
      ])
        expect(renderError(error).replace(/<[^>]*>/g, "")).toContain(error);
    }
  }
});
