/**
 * Texts for the welcome panel on an empty Memory page.
 * `translations.ts` merges `welcomeText` into each language.
 */
export const welcomeText = {
  en: {
    "welcome-title": "Welcome to OMMS",
    "welcome-body":
      "No memories are saved yet. They appear here after your first sessions in OpenCode, Pi or Claude Code.",
    "welcome-hosts-title": "Can each tool save memories?",
    "welcome-host-ready": "Ready",
    "welcome-host-needs-setup": "Needs setup",
    "welcome-host-missing": "Missing: {settings}",
    "welcome-claude-note":
      "Claude Code capture needs the External API settings. Fill them in to start saving memories.",
    "welcome-api-link": "Open the External API settings",
  },
  zh: {
    "welcome-title": "欢迎使用 OMMS",
    "welcome-body":
      "目前还没有保存任何记忆。在 OpenCode、Pi 或 Claude Code 中完成首次会话后，记忆会显示在这里。",
    "welcome-hosts-title": "各个工具能保存记忆吗？",
    "welcome-host-ready": "已就绪",
    "welcome-host-needs-setup": "需要设置",
    "welcome-host-missing": "缺少：{settings}",
    "welcome-claude-note": "Claude Code 的记忆捕获需要外部 API 设置。填写后即可开始保存记忆。",
    "welcome-api-link": "打开外部 API 设置",
  },
  ar: {
    "welcome-title": "مرحبًا بك في OMMS",
    "welcome-body":
      "لم تُحفظ أي ذكريات بعد. ستظهر هنا بعد جلساتك الأولى في OpenCode أو Pi أو Claude Code.",
    "welcome-hosts-title": "هل تستطيع كل أداة حفظ الذكريات؟",
    "welcome-host-ready": "جاهز",
    "welcome-host-needs-setup": "يحتاج إلى إعداد",
    "welcome-host-missing": "ينقص: {settings}",
    "welcome-claude-note":
      "يحتاج التقاط الذكريات في Claude Code إلى إعدادات واجهة API الخارجية. املأها لبدء حفظ الذكريات.",
    "welcome-api-link": "افتح إعدادات واجهة API الخارجية",
  },
} as const;
