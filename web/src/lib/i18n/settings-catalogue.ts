/**
 * Chinese and Arabic texts for the shared settings pieces: the catalogue page labels, the plain
 * notes, the reranker sentences, and the text of `SettingRow`, `KeySourceField`,
 * `SettingsSearch`, `SettingsConfirmDialog` and `ConfigProblemBanner`. The row texts live in
 * `settings-catalogue-rows.ts` and `settings-catalogue-memory-rows.ts`. The English text is the
 * key, as in `settings.ts`. `settings.ts` may merge `settingsCatalogueText` like `openrouter.ts`;
 * the pieces here read it through `useCatalogueText`, so they need no merge.
 */
import { useI18n } from "./index";
import { settingsCardsText } from "./settings-cards-text";
import { settingsCatalogueMemoryRowText } from "./settings-catalogue-memory-rows";
import { settingsCatalogueRowText } from "./settings-catalogue-rows";
import { memoryCardText } from "./settings-memory-cards";

type Language = "en" | "zh" | "ar";

const pieceText = {
  // Pages named in search results.
  "Settings page": ["设置页面", "صفحة الإعدادات"],
  "Memory page": ["记忆页面", "صفحة الذاكرة"],
  "Memorisation page": ["记忆存档页面", "صفحة الحفظ"],
  "Skills page": ["技能页面", "صفحة المهارات"],
  // Plain notes for the Memory cards.
  "Text sizes are counted in bytes. An English letter is one byte; some languages use more.": [
    "文本大小按字节计算。一个英文字母是一个字节，有些语言占用更多。",
    "تُحسب أحجام النص بالبايت. الحرف الإنجليزي بايت واحد، وبعض اللغات تستخدم أكثر.",
  ],
  "A word piece is a small part of a word. A provider can count a few more or fewer for the same text.":
    [
      "词片段是词的一小部分。对同一段文本，提供商统计的数量可能略多或略少。",
      "قطعة الكلمة جزء صغير من الكلمة. قد يحسب المزوّد عدداً أكثر أو أقل قليلاً للنص نفسه.",
    ],
  "Merge two ranked lists (experimental)": [
    "合并两个排名列表（实验性）",
    "دمج قائمتين مرتّبتين (تجريبي)",
  ],
  "Merging ranks a list by meaning and a list by words together. A memory with a word from your prompt can come back even when its meaning score is low. Experimental: it has not been shown to help.":
    [
      "合并会把按含义排序的列表和按词语排序的列表一起排名。含有你提示中某个词的记忆，即使含义得分很低也可能被返回。实验性：尚未证明有帮助。",
      "يرتّب الدمج قائمة بحسب المعنى وقائمة بحسب الكلمات معاً. قد تعود ذكرى تحتوي كلمة من مطالبتك حتى لو كانت درجة معناها منخفضة. تجريبي: لم يثبت أنه مفيد.",
    ],
  "Merging is not used while the reranker is on. Search uses the bonus.": [
    "重排序器开启时不使用合并，搜索使用加分模式。",
    "لا يُستخدم الدمج أثناء تشغيل معيد الترتيب. يستخدم البحث المكافأة.",
  ],
  // Reranker test sentences.
  "OMMS could not reach the reranker server. Check the URL, and check that the server is running.":
    [
      "OMMS 无法连接重排序服务器。请检查网址，并确认服务器正在运行。",
      "تعذّر على OMMS الوصول إلى خادم إعادة الترتيب. تحقق من العنوان ومن أن الخادم يعمل.",
    ],
  "The reranker server did not answer in time. Try a longer wait time, or a faster server.": [
    "重排序服务器没有及时回应。请延长等待时间，或换一台更快的服务器。",
    "لم يرد خادم إعادة الترتيب في الوقت المناسب. جرّب مدة انتظار أطول أو خادماً أسرع.",
  ],
  "The reranker server answered with an error. Check the model name and the key.": [
    "重排序服务器返回了错误。请检查模型名称和密钥。",
    "ردّ خادم إعادة الترتيب بخطأ. تحقق من اسم النموذج والمفتاح.",
  ],
  "The reranker server sent a reply that OMMS could not read. Check that the URL points to a reranker.":
    [
      "重排序服务器返回的内容 OMMS 无法读取。请确认网址指向的是重排序服务。",
      "أرسل خادم إعادة الترتيب ردّاً لم يستطع OMMS قراءته. تحقق من أن العنوان يشير إلى خادم إعادة ترتيب.",
    ],
  "The reranker answered, but it ranked the sample text in the wrong order. Check the model name.":
    [
      "重排序器有回应，但把示例文本排错了顺序。请检查模型名称。",
      "ردّ معيد الترتيب لكنه رتّب النص التجريبي بترتيب خاطئ. تحقق من اسم النموذج.",
    ],
  "The reranker is on, but its URL or model is missing. Add both, or turn it off.": [
    "重排序器已开启，但缺少网址或模型。请补上两者，或将其关闭。",
    "معيد الترتيب قيد التشغيل لكن عنوانه أو نموذجه مفقود. أضف الاثنين أو أوقفه.",
  ],
  "The reranker test failed.": ["重排序测试失败。", "فشل اختبار معيد الترتيب."],
  // SettingRow.
  Default: ["默认值", "القيمة الافتراضية"],
  Affects: ["影响", "التأثير"],
  "This project's file decides this setting here.": [
    "这里由当前项目的文件决定此设置。",
    "ملف هذا المشروع هو الذي يحدد هذا الإعداد هنا.",
  ],
  // KeySourceField.
  "How OMMS gets the key": ["OMMS 如何获取密钥", "كيف يحصل OMMS على المفتاح"],
  "Environment variable": ["环境变量", "متغير البيئة"],
  "Key file": ["密钥文件", "ملف المفتاح"],
  "Save key to a private file": ["将密钥保存到私有文件", "حفظ المفتاح في ملف خاص"],
  "No key": ["无密钥", "بلا مفتاح"],
  "Variable name": ["变量名", "اسم المتغير"],
  "Key file path": ["密钥文件路径", "مسار ملف المفتاح"],
  "Key file name": ["密钥文件名", "اسم ملف المفتاح"],
  "Key to save": ["要保存的密钥", "المفتاح المراد حفظه"],
  "A login web app does not see variables set only in a shell profile. A key file works everywhere.":
    [
      "登录时启动的网页应用看不到只在 shell 配置文件中设置的变量。密钥文件在任何地方都有效。",
      "لا يرى تطبيق الويب المشغَّل عند تسجيل الدخول المتغيرات المضبوطة في ملف إعدادات الصدفة فقط. ملف المفتاح يعمل في كل مكان.",
    ],
  "OMMS writes the key to a file that only you can read, in ~/.config/omms/secrets/. It is never shown again.":
    [
      "OMMS 会把密钥写入 ~/.config/omms/secrets/ 中只有你能读取的文件。之后不会再显示。",
      "يكتب OMMS المفتاح في ملف لا يقرؤه سواك داخل ~/.config/omms/secrets/. لا يُعرض مرة أخرى.",
    ],
  "Saved key": ["已保存的密钥", "المفتاح المحفوظ"],
  "environment variable": ["环境变量", "متغير البيئة"],
  "key file": ["密钥文件", "ملف المفتاح"],
  "set in the config file": ["在配置文件中设置", "مضبوط في ملف الإعدادات"],
  "No key is saved": ["尚未保存密钥", "لا يوجد مفتاح محفوظ"],
  "The web app can read it": ["网页应用可以读取", "يستطيع تطبيق الويب قراءته"],
  "The web app cannot read it": ["网页应用无法读取", "لا يستطيع تطبيق الويب قراءته"],
  "No key is sent.": ["不发送密钥。", "لا يُرسل أي مفتاح."],
  // SettingsSearch.
  "Search settings": ["搜索设置", "ابحث في الإعدادات"],
  "Search settings, for example reranker": [
    "搜索设置，例如重排序器",
    "ابحث في الإعدادات، مثل معيد الترتيب",
  ],
  "Matching settings": ["匹配的设置", "الإعدادات المطابقة"],
  "No setting matches. Some settings live only in the config file. See the Configuration guide, docs/configuration.md.":
    [
      "没有匹配的设置。有些设置只能在配置文件中修改。请参阅配置指南 docs/configuration.md。",
      "لا يوجد إعداد مطابق. بعض الإعدادات موجودة في ملف الإعدادات فقط. راجع دليل الإعدادات (Configuration guide) في docs/configuration.md.",
    ],
  // SettingsConfirmDialog.
  Cancel: ["取消", "إلغاء الأمر"],
  "Saving…": ["正在保存…", "جارٍ الحفظ…"],
  // ConfigProblemBanner.
  "Problem in your config file": ["配置文件有问题", "مشكلة في ملف الإعدادات"],
  "{name} has a value OMMS cannot use.": [
    "“{name}”的值 OMMS 无法使用。",
    "قيمة «{name}» لا يستطيع OMMS استخدامها.",
  ],
  "A setting has a value OMMS cannot use.": [
    "有一项设置的值 OMMS 无法使用。",
    "أحد الإعدادات له قيمة لا يستطيع OMMS استخدامها.",
  ],
  "It accepts {accepted}.": ["它接受{accepted}。", "يقبل {accepted}."],
  "“{name}” is off until you fix it.": [
    "在你修正之前，“{name}”已关闭。",
    "«{name}» متوقف إلى أن تصلحه.",
  ],
  "OMMS uses the default for it until you fix it.": [
    "在你修正之前，OMMS 使用它的默认值。",
    "يستخدم OMMS القيمة الافتراضية له إلى أن تصلحه.",
  ],
  "line {line}": ["第 {line} 行", "السطر {line}"],
  "whole numbers of 1 or more": ["1 或更大的整数", "أعداد صحيحة من 1 فأكثر"],
  "whole numbers from {min} to {max}": [
    "{min} 到 {max} 之间的整数",
    "أعداد صحيحة من {min} إلى {max}",
  ],
  "numbers from {min} to {max}": ["{min} 到 {max} 之间的数字", "أرقام من {min} إلى {max}"],
  "true or false": ["true 或 false", "true أو false"],
  "a web address that starts with http:// or https://": [
    "以 http:// 或 https:// 开头的网址",
    "عنوان ويب يبدأ بـ http:// أو https://",
  ],
  "text that is not empty": ["非空文本", "نص غير فارغ"],
  "an env:// or file:// reference": ["env:// 或 file:// 引用", "مرجع env:// أو file://"],
  "Your OMMS settings file has an error, so until you fix it OMMS uses the last settings it could read, or its defaults if it has none.":
    [
      "你的 OMMS 设置文件有错误，所以在你修正之前，OMMS 使用它上次能读取的设置；如果没有，就使用默认设置。",
      "في ملف إعدادات OMMS خطأ، لذلك إلى أن تصلحه يستخدم OMMS آخر إعدادات تمكّن من قراءتها، أو إعداداته الافتراضية إن لم توجد.",
    ],
  "line {line}, column {column}": ["第 {line} 行，第 {column} 列", "السطر {line}، العمود {column}"],
  "Saving is turned off until the file is fixed.": [
    "文件修正之前，保存已关闭。",
    "الحفظ متوقف إلى أن يُصلَح الملف.",
  ],
  "The cards below show the last settings OMMS could read.": [
    "下面的卡片显示 OMMS 上次能读取的设置。",
    "تعرض البطاقات أدناه آخر إعدادات تمكّن OMMS من قراءتها.",
  ],
  "Fix the file, then reload this page.": [
    "请修正文件，然后重新加载此页面。",
    "أصلح الملف ثم أعد تحميل هذه الصفحة.",
  ],
} as const;

export const settingsCatalogueText: Readonly<Record<string, readonly [string, string]>> = {
  ...settingsCatalogueRowText,
  ...settingsCatalogueMemoryRowText,
  ...settingsCardsText,
  ...memoryCardText,
  ...pieceText,
};

/** The text in a language. Unknown text and English come back unchanged. `{name}` is replaced. */
export function translateCatalogue(
  message: string,
  language: Language,
  params: Record<string, string | number> = {}
): string {
  const pair = settingsCatalogueText[message];
  let text = language === "en" || !pair ? message : pair[language === "zh" ? 0 : 1];
  for (const [name, value] of Object.entries(params)) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

/** The translator for the shared settings pieces. It follows the language of the page. */
export function useCatalogueText() {
  const { language } = useI18n();
  return (message: string, params?: Record<string, string | number>): string =>
    translateCatalogue(message, language, params);
}
