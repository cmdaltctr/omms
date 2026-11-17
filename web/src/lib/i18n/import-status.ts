/**
 * Texts for the host status card and the Off state on the Memory page.
 * English message first, then Chinese and Arabic. `settings.ts` merges this
 * table into the Settings table, because the status header looks its texts up
 * through it. The status builder group owns this file.
 */
export const importStatusText = {
  "Turn on automatic import?": ["开启自动导入？", "تشغيل الاستيراد التلقائي؟"],
  "Automatic import will run for every host, not just this one.": [
    "自动导入会在所有宿主上运行，而不只是这一个。",
    "سيعمل الاستيراد التلقائي على جميع المضيفين، وليس هذا المضيف وحده.",
  ],
  "It makes model calls, which can cost money.": [
    "它会调用模型，这可能产生费用。",
    "يجري اتصالات بالنموذج، وقد يكلّف ذلك مالاً.",
  ],
  "Automatic import is off. Use Import new chats to bring in chats by hand.": [
    "自动导入已关闭。请用“导入新聊天”手动导入聊天。",
    "الاستيراد التلقائي متوقف. استخدم «استيراد المحادثات الجديدة» لاستيراد المحادثات يدوياً.",
  ],
  "Automatic import is on. Nothing was waiting before {date}. Use Import new chats for newer chats.":
    [
      "自动导入已开启。{date} 之前没有待导入的内容。较新的聊天请用“导入新聊天”。",
      "الاستيراد التلقائي يعمل. لم يكن هناك ما ينتظر قبل {date}. استخدم «استيراد المحادثات الجديدة» للمحادثات الأحدث.",
    ],
  "Automatic import off · history imported {date} · last saved {when}": [
    "自动导入已关闭 · 历史已导入 {date} · 最近保存 {when}",
    "الاستيراد التلقائي متوقف · استُورد السجل {date} · آخر حفظ {when}",
  ],
  "Automatic import off · history imported {date}": [
    "自动导入已关闭 · 历史已导入 {date}",
    "الاستيراد التلقائي متوقف · استُورد السجل {date}",
  ],
  "Automatic import off · last saved {when}": [
    "自动导入已关闭 · 最近保存 {when}",
    "الاستيراد التلقائي متوقف · آخر حفظ {when}",
  ],
  "Automatic import off": ["自动导入已关闭", "الاستيراد التلقائي متوقف"],
  "Automatic import on": ["自动导入已开启", "الاستيراد التلقائي يعمل"],
  "History imported up to {date}": ["历史已导入至 {date}", "تم استيراد السجل حتى {date}"],
  "{n} chat exchanges waiting": [
    "{n} 段聊天对话等待导入",
    "{n} من تبادلات المحادثة بانتظار الاستيراد",
  ],
  "Automatic import brings in older chats by itself. Import new chats brings in every chat not yet imported, newer ones included.":
    [
      "自动导入会自行导入较早的聊天。“导入新聊天”会导入所有尚未导入的聊天，包括较新的。",
      "يستورد الاستيراد التلقائي المحادثات الأقدم بنفسه. يستورد «استيراد المحادثات الجديدة» كل محادثة لم تُستورد بعد، بما فيها الأحدث.",
    ],
  "Automatic import brings in chats up to {date} by itself. Import new chats brings in every chat not yet imported, newer ones included.":
    [
      "自动导入会自行导入 {date} 之前的聊天。“导入新聊天”会导入所有尚未导入的聊天，包括较新的。",
      "يستورد الاستيراد التلقائي المحادثات حتى {date} بنفسه. يستورد «استيراد المحادثات الجديدة» كل محادثة لم تُستورد بعد، بما فيها الأحدث.",
    ],
  "Turning this on applies to every host.": [
    "开启后对所有宿主生效。",
    "يسري التشغيل على جميع المضيفين.",
  ],
} as const;
