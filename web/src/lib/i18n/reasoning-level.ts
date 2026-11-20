/**
 * Texts for the Reasoning level control of the External API card. `settings.ts` merges
 * `reasoningLevelText`, because the card looks its texts up through the settings table.
 */
export const reasoningLevelText = {
  "Reasoning level": ["推理级别", "مستوى الاستدلال"],
  Default: ["默认", "افتراضي"],
  "Default ({effort})": ["默认（{effort}）", "افتراضي ({effort})"],
  Off: ["关闭", "إيقاف"],
  On: ["开启", "تشغيل"],
  Minimal: ["最低", "الحد الأدنى"],
  Low: ["低", "منخفض"],
  Medium: ["中", "متوسط"],
  High: ["高", "مرتفع"],
  "Extra high": ["极高", "مرتفع جداً"],
  Max: ["最大", "الأقصى"],
  "Set in the config file": ["已在配置文件中设置", "محدّد في ملف الإعدادات"],
  "Lower levels answer faster.": ["级别越低，回答越快。", "المستويات الأدنى تجيب بشكل أسرع."],
  "OpenRouter uses the nearest level the model supports.": [
    "OpenRouter 会使用模型支持的最接近的级别。",
    "يستخدم OpenRouter أقرب مستوى يدعمه النموذج.",
  ],
  "This endpoint may ignore or refuse this field. Default sends nothing.": [
    "此端点可能忽略或拒绝该字段。选择默认则不发送任何内容。",
    "قد يتجاهل هذا العنوان الحقل أو يرفضه. الخيار الافتراضي لا يرسل شيئاً.",
  ],
  "Reasoning for this provider is set in memoryExtraParams in the config file.": [
    "此提供商的推理设置写在配置文件的 memoryExtraParams 中。",
    "يُضبط الاستدلال لهذا المزوّد في memoryExtraParams داخل ملف الإعدادات.",
  ],
  "OpenRouter ignores the saved thinking field.": [
    "OpenRouter 会忽略已保存的 thinking 字段。",
    "يتجاهل OpenRouter حقل thinking المحفوظ.",
  ],
  "DeepSeek ignores the saved reasoning field.": [
    "DeepSeek 会忽略已保存的 reasoning 字段。",
    "يتجاهل DeepSeek حقل reasoning المحفوظ.",
  ],
  "Saving a level replaces it.": ["保存级别会替换它。", "حفظ مستوى سيستبدله."],
  "Replace the value in the config file?": [
    "要替换配置文件中的值吗？",
    "هل تريد استبدال القيمة في ملف الإعدادات؟",
  ],
  "The config file holds a reasoning value that this control cannot show. Saving a level replaces it.":
    [
      "配置文件中有一个此控件无法显示的推理值。保存级别会替换它。",
      "يحتوي ملف الإعدادات على قيمة استدلال لا يستطيع هذا العنصر عرضها. حفظ مستوى سيستبدلها.",
    ],
  "Save the endpoint first. The level applies to the saved URL, provider and model.": [
    "请先保存端点。该级别适用于已保存的 URL、提供商和模型。",
    "احفظ العنوان أولاً. يُطبَّق المستوى على العنوان والمزوّد والنموذج المحفوظة.",
  ],
  "Save reasoning level": ["保存推理级别", "حفظ مستوى الاستدلال"],
  "Saving reasoning level…": ["正在保存推理级别…", "جارٍ حفظ مستوى الاستدلال…"],
  "Reasoning level saved.": ["推理级别已保存。", "تم حفظ مستوى الاستدلال."],
} as const;
