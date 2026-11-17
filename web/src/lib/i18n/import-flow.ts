/**
 * Texts for the import panel on the Memory page: the primary button, the
 * readiness checklist, the model line, Customise and the missing-folder notice.
 * English message first, then Chinese and Arabic. `settings.ts` merges this
 * table into the Settings table. The import panel group owns this file.
 */
export const importFlowText = {
  "Import new chats": ["导入新聊天", "استيراد المحادثات الجديدة"],
  "Testing the model…": ["正在测试模型…", "جارٍ اختبار النموذج…"],
  "Listing sessions…": ["正在列出会话…", "جارٍ عرض الجلسات…"],
  "Checking what is new…": ["正在检查有哪些新内容…", "جارٍ فحص الجديد…"],
  "Nothing new to import": ["没有需要导入的新内容", "لا يوجد جديد للاستيراد"],
  "Chats already imported are skipped, so running an import again is safe.": [
    "已导入的聊天会被跳过，所以再次导入是安全的。",
    "تُتجاوز المحادثات المستوردة سابقاً، لذا فإعادة الاستيراد آمنة.",
  ],
  "The chat list changed while checking. Try again.": [
    "检查时聊天列表发生了变化。请重试。",
    "تغيّرت قائمة المحادثات أثناء الفحص. حاول مرة أخرى.",
  ],
  "Chats already imported are analysed again. This can cost more model calls.": [
    "已导入的聊天会被重新分析。这可能产生更多模型调用。",
    "ستُحلَّل المحادثات المستوردة سابقاً مرة أخرى. قد يكلّف هذا استدعاءات أكثر للنموذج.",
  ],
  "Checks the model with one short call first.": [
    "会先用一次简短调用检查模型。",
    "يفحص النموذج أولاً باستدعاء واحد قصير.",
  ],
  "The model service did not accept your API key. Check the key in the External API settings.": [
    "模型服务不接受你的 API 密钥。请在外部 API 设置中检查密钥。",
    "لم تقبل خدمة النموذج مفتاح API الخاص بك. تحقّق من المفتاح في إعدادات API الخارجية.",
  ],
  "The model service could not find this model or address. Check the model and web address in the External API settings.":
    [
      "模型服务找不到这个模型或地址。请在外部 API 设置中检查模型和网址。",
      "لم تعثر خدمة النموذج على هذا النموذج أو العنوان. تحقّق من النموذج وعنوان الويب في إعدادات API الخارجية.",
    ],
  "The model service is busy or your quota is used up. Try again later.": [
    "模型服务繁忙，或你的额度已用完。请稍后重试。",
    "خدمة النموذج مشغولة أو نفدت حصتك. حاول مرة أخرى لاحقاً.",
  ],
  "The model service had a problem. Try again later.": [
    "模型服务出现问题。请稍后重试。",
    "واجهت خدمة النموذج مشكلة. حاول مرة أخرى لاحقاً.",
  ],
  "The test call to your model failed. Check the External API settings.": [
    "对模型的测试调用失败。请检查外部 API 设置。",
    "فشل الاستدعاء التجريبي لنموذجك. تحقّق من إعدادات API الخارجية.",
  ],
  "OMMS could not reach the model service. Check the web address and your connection.": [
    "OMMS 无法连接到模型服务。请检查网址和网络连接。",
    "تعذّر على OMMS الوصول إلى خدمة النموذج. تحقّق من عنوان الويب واتصالك.",
  ],
  "Error code: {code}": ["错误代码：{code}", "رمز الخطأ: {code}"],
  Profile: ["画像", "الملف الشخصي"],
  "Profile learning needs your email address. Set it with {command}, or untick User profile in Customise.":
    [
      "画像学习需要你的电子邮件地址。请用 {command} 设置，或在“自定义”中取消勾选“用户画像”。",
      "يحتاج تعلّم الملف الشخصي إلى بريدك الإلكتروني. اضبطه بالأمر {command}، أو ألغِ تحديد الملف الشخصي للمستخدم في تخصيص.",
    ],
  "Before you import": ["导入之前", "قبل الاستيراد"],
  "Memories saving": ["记忆保存", "حفظ الذكريات"],
  "History found": ["找到历史记录", "العثور على السجل"],
  Ready: ["就绪", "جاهز"],
  "Ready, not tested": ["就绪，尚未测试", "جاهز، لم يُختبر بعد"],
  "Not ready": ["未就绪", "غير جاهز"],
  "Memories can be saved.": ["记忆可以保存。", "يمكن حفظ الذكريات."],
  "Memories cannot be saved: {reason}": [
    "记忆无法保存：{reason}",
    "لا يمكن حفظ الذكريات: {reason}",
  ],
  "History found for {hosts}.": ["已找到 {hosts} 的历史记录。", "تم العثور على سجل {hosts}."],
  "Left out, no history found: {hosts}.": [
    "已略过，未找到历史记录：{hosts}。",
    "تم استبعاده لعدم العثور على سجل: {hosts}.",
  ],
  "No {host} history found. Install {host} and use it once.": [
    "未找到 {host} 的历史记录。请安装 {host} 并使用一次。",
    "لم يُعثر على سجل {host}. ثبّت {host} واستخدمه مرة واحدة.",
  ],
  "{host} history could not be read. Untick {host} in Customise.": [
    "无法读取 {host} 的历史记录。请在“自定义”中取消勾选 {host}。",
    "تعذّرت قراءة سجل {host}. ألغِ تحديد {host} في «تخصيص».",
  ],
  "Open the external API settings": ["打开外部 API 设置", "افتح إعدادات واجهة API الخارجية"],
  "Model: {model}": ["模型：{model}", "النموذج: {model}"],
  "Saved external API ({model})": [
    "已保存的外部 API（{model}）",
    "واجهة API الخارجية المحفوظة ({model})",
  ],
  Change: ["更改", "تغيير"],
  "Automatic import for {host} uses {model}. Change it in the {host} settings card further down the page.":
    [
      "{host} 的自动导入使用 {model}。请在页面下方的 {host} 设置卡片中更改。",
      "يستخدم الاستيراد التلقائي لـ {host} النموذج {model}. غيّره في بطاقة إعدادات {host} أسفل الصفحة.",
    ],
  "Automatic import for {host} uses the model of your open {host} session. Change it in the {host} settings card further down the page.":
    [
      "{host} 的自动导入使用你打开的 {host} 会话的模型。请在页面下方的 {host} 设置卡片中更改。",
      "يستخدم الاستيراد التلقائي لـ {host} نموذج جلسة {host} المفتوحة. غيّره في بطاقة إعدادات {host} أسفل الصفحة.",
    ],
  "Fix the settings, then reload this page to test the model again.": [
    "修正设置后，重新加载此页面以再次测试模型。",
    "أصلح الإعدادات، ثم أعد تحميل هذه الصفحة لاختبار النموذج مرة أخرى.",
  ],
  Customise: ["自定义", "تخصيص"],
  "Choose hosts, sessions, outputs and the model by hand.": [
    "手动选择宿主、会话、输出内容和模型。",
    "اختر المضيفين والجلسات والمخرجات والنموذج يدوياً.",
  ],
  "1 session skipped: folder missing.": [
    "1 个会话已跳过：文件夹缺失。",
    "تم تخطي جلسة واحدة: المجلد مفقود.",
  ],
  "{n} sessions skipped: folder missing.": [
    "{n} 个会话已跳过：文件夹缺失。",
    "تم تخطي {n} من الجلسات: المجلد مفقود.",
  ],
  Resolve: ["解决", "حل"],
  "The preview found no new work.": ["预览没有发现新的工作。", "لم تجد المعاينة عملاً جديداً."],
} as const;
