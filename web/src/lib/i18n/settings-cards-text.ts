/**
 * Chinese and Arabic texts for the Settings page cards of friendly-settings (Memory basics,
 * Memory cleanup, External API, Embedding and Capture diagnostics). The English text is the key,
 * as in `settings.ts`. `settings-catalogue.ts` merges this table, and `useCardText` in
 * `settings-cards.ts` reads it before the older `settings.ts` table.
 */
export const settingsCardsText: Readonly<Record<string, readonly [string, string]>> = {
  // Shared by the cards.
  Save: ["保存", "حفظ"],
  "Saved.": ["已保存。", "تم الحفظ."],
  "Nothing to save.": ["没有需要保存的内容。", "لا يوجد ما يُحفظ."],
  "Saving…": ["正在保存…", "جارٍ الحفظ…"],
  Test: ["测试", "اختبار"],
  "Testing…": ["正在测试…", "جارٍ الاختبار…"],
  Clear: ["清除", "مسح"],
  "Use a whole number of 1 or more.": [
    "请填写 1 或更大的整数。",
    "استخدم عدداً صحيحاً يساوي 1 أو أكثر.",
  ],
  "{count} days": ["{count} 天", "{count} يوم"],
  "{count} hours": ["{count} 小时", "{count} ساعة"],
  // Memory basics.
  "Memory basics": ["记忆基础", "أساسيات الذاكرة"],
  "The main switches for saving and recalling memories. They apply to OpenCode, Pi and Claude Code.":
    [
      "保存和回忆记忆的主要开关，适用于 OpenCode、Pi 和 Claude Code。",
      "المفاتيح الرئيسية لحفظ الذكريات واستدعائها. تنطبق على OpenCode وPi وClaude Code.",
    ],
  "This project": ["本项目", "هذا المشروع"],
  "All projects": ["所有项目", "كل المشاريع"],
  "Save memory basics": ["保存记忆基础设置", "حفظ أساسيات الذاكرة"],
  "Save memory basics?": ["保存记忆基础设置？", "حفظ أساسيات الذاكرة؟"],
  // Memory cleanup.
  "Memory cleanup": ["记忆清理", "تنظيف الذاكرة"],
  "Turning this on deletes memories. It removes memories that are not pinned and have not changed for the number of days below, in every project. A deleted memory cannot be restored. OpenCode, Pi and Claude Code all follow this switch.":
    [
      "开启后会删除记忆：删除未固定、且在下面所填天数内没有变化的记忆，涉及所有项目。已删除的记忆无法恢复。OpenCode、Pi 和 Claude Code 都遵循这个开关。",
      "تفعيل هذا الخيار يحذف الذكريات: يحذف الذكريات غير المثبَّتة التي لم تتغير خلال عدد الأيام أدناه، في كل المشاريع. لا يمكن استرجاع ذكرى محذوفة. يتبع OpenCode وPi وClaude Code هذا المفتاح.",
    ],
  "A project file cannot change these settings.": [
    "项目文件无法更改这些设置。",
    "لا يستطيع ملف المشروع تغيير هذه الإعدادات.",
  ],
  "Counting…": ["正在统计…", "جارٍ العدّ…"],
  "Turn on deletion": ["开启删除", "تفعيل الحذف"],
  "Delete memories sooner": ["提前删除记忆", "حذف الذكريات أبكر"],
  "Turn on automatic deletion?": ["开启自动删除？", "تفعيل الحذف التلقائي؟"],
  "Delete memories after fewer days?": ["缩短天数后删除记忆？", "حذف الذكريات بعد أيام أقل؟"],
  "Turn off memory cleanup?": ["关闭记忆清理？", "إيقاف تنظيف الذاكرة؟"],
  "Save memory cleanup?": ["保存记忆清理设置？", "حفظ إعدادات تنظيف الذاكرة؟"],
  "1 memory has not changed for {days} days. OMMS deletes it at its next daily check.": [
    "有 1 条记忆已 {days} 天没有变化。OMMS 会在下一次每日检查时删除它。",
    "هناك ذكرى واحدة لم تتغير منذ {days} يوماً. يحذفها OMMS في فحصه اليومي التالي.",
  ],
  "{count} memories have not changed for {days} days. OMMS deletes them at its next daily check.": [
    "有 {count} 条记忆已 {days} 天没有变化。OMMS 会在下一次每日检查时删除它们。",
    "هناك {count} ذكرى لم تتغير منذ {days} يوماً. يحذفها OMMS في فحصه اليومي التالي.",
  ],
  "No memory is that old yet, so the next daily check deletes nothing. From then on a memory is deleted when it reaches {days} days without a change.":
    [
      "目前还没有这么旧的记忆，所以下一次每日检查不会删除任何内容。之后，记忆在 {days} 天没有变化时会被删除。",
      "لا توجد ذكرى بهذا القدم بعد، لذلك لن يحذف الفحص اليومي التالي شيئاً. بعد ذلك تُحذف الذكرى عندما تبلغ {days} يوماً دون تغيير.",
    ],
  "Pinned memories and memorisations stay. OMMS checks once a day. A deleted memory cannot be restored.":
    [
      "已固定的记忆和记忆存档会保留。OMMS 每天检查一次。已删除的记忆无法恢复。",
      "تبقى الذكريات المثبَّتة والعناصر المحفوظة. يفحص OMMS مرة كل يوم. لا يمكن استرجاع ذكرى محذوفة.",
    ],
  "OMMS could not count the memories this would delete, so it will not turn deletion on. Try again in a moment. If it fails again, the Log card on this page shows why.":
    [
      "OMMS 无法统计这会删除多少条记忆，所以不会开启删除。请稍后重试。如果再次失败，本页的“日志”卡片会显示原因。",
      "تعذّر على OMMS عدّ الذكريات التي سيحذفها هذا، لذلك لن يفعّل الحذف. حاول مرة أخرى بعد قليل. إن فشل مرة أخرى، تعرض بطاقة السجل في هذه الصفحة السبب.",
    ],
  "Deletion is off for now, because a value in your config file cannot be used. The message at the top of the page says which one.":
    [
      "删除暂时关闭，因为配置文件中有一个值无法使用。页面顶部的提示说明是哪一个。",
      "الحذف متوقف حالياً، لأن قيمة في ملف الإعدادات لا يمكن استخدامها. الرسالة أعلى الصفحة تذكر أيّها.",
    ],
  // External API.
  "Save settings": ["保存设置", "حفظ الإعدادات"],
  "The URL must start with http:// or https://.": [
    "网址必须以 http:// 或 https:// 开头。",
    "يجب أن يبدأ العنوان بـ http:// أو https://.",
  ],
  "Test passed": ["测试通过", "نجح الاختبار"],
  "Test failed": ["测试失败", "فشل الاختبار"],
  "A key file with this name already exists. Replace it?": [
    "已有同名的密钥文件。要替换它吗？",
    "يوجد ملف مفتاح بهذا الاسم. هل تريد استبداله؟",
  ],
  Replace: ["替换", "استبدال"],
  "Replace the key file?": ["替换密钥文件？", "استبدال ملف المفتاح؟"],
  "Remove OpenRouter routing?": ["移除 OpenRouter 路由？", "إزالة توجيه OpenRouter؟"],
  "Requests to this endpoint will no longer carry the routing choices.": [
    "发往此端点的请求将不再带有路由选项。",
    "لن تحمل الطلبات المرسلة إلى هذه النقطة خيارات التوجيه بعد الآن.",
  ],
  Remove: ["移除", "إزالة"],
  "Removing…": ["正在移除…", "جارٍ الإزالة…"],
  "Empty turns the external API off, except for OrcaRouter, which has its own address.": [
    "留空会关闭外部 API；OrcaRouter 除外，它有自己的地址。",
    "ترك الحقل فارغاً يوقف واجهة API الخارجية، إلا مع OrcaRouter لأن له عنوانه الخاص.",
  ],
  "Empty turns the external API off, except for OrcaRouter, which picks its own model.": [
    "留空会关闭外部 API；OrcaRouter 除外，它会自己选择模型。",
    "ترك الحقل فارغاً يوقف واجهة API الخارجية، إلا مع OrcaRouter لأنه يختار نموذجه بنفسه.",
  ],
  "The test call worked: {provider}, model {model}.": [
    "测试调用成功：{provider}，模型 {model}。",
    "نجح استدعاء الاختبار: {provider}، النموذج {model}.",
  ],
  "its own default": ["它自己的默认模型", "نموذجه الافتراضي"],
  "Status code {status}": ["状态码 {status}", "رمز الحالة {status}"],
  "The provider refused the key. Check the key, then test again.": [
    "提供商拒绝了该密钥。请检查密钥，然后再次测试。",
    "رفض المزوّد المفتاح. تحقق من المفتاح ثم اختبر مرة أخرى.",
  ],
  "The address or the model was not found. Check both.": [
    "找不到该地址或模型。请检查两者。",
    "لم يُعثر على العنوان أو النموذج. تحقق من كليهما.",
  ],
  "The provider got too many requests. Wait a minute, then test again.": [
    "提供商收到的请求过多。请等一分钟后再测试。",
    "تلقّى المزوّد طلبات كثيرة جداً. انتظر دقيقة ثم اختبر مرة أخرى.",
  ],
  "The provider had a problem on its side. Try again later.": [
    "提供商那边出了问题。请稍后再试。",
    "حدثت مشكلة لدى المزوّد. حاول مرة أخرى لاحقاً.",
  ],
  "OMMS could not reach the address. Check the address and your network.": [
    "OMMS 无法连接到该地址。请检查地址和你的网络。",
    "تعذّر على OMMS الوصول إلى العنوان. تحقق من العنوان ومن شبكتك.",
  ],
  "Some settings are missing. Fill in the address, the model and the key.": [
    "缺少部分设置。请填写地址、模型和密钥。",
    "بعض الإعدادات ناقصة. املأ العنوان والنموذج والمفتاح.",
  ],
  "The test call failed. Check the provider, the address, the model and the key.": [
    "测试调用失败。请检查提供商、地址、模型和密钥。",
    "فشل استدعاء الاختبار. تحقق من المزوّد والعنوان والنموذج والمفتاح.",
  ],
  "Nothing was saved.": ["没有保存任何内容。", "لم يُحفظ أي شيء."],
  "Save without a working test?": ["在测试未通过的情况下保存？", "الحفظ دون اختبار ناجح؟"],
  "Save these settings anyway? Capture fails until OMMS can reach the address.": [
    "仍要保存这些设置吗？在 OMMS 能连接到该地址之前，记忆捕获会失败。",
    "هل تحفظ هذه الإعدادات على أي حال؟ سيفشل الالتقاط إلى أن يتمكن OMMS من الوصول إلى العنوان.",
  ],
  "Save anyway": ["仍然保存", "احفظ على أي حال"],
  "Save external API settings?": ["保存外部 API 设置？", "حفظ إعدادات واجهة API الخارجية؟"],
  "The external API will be turned off.": ["外部 API 将被关闭。", "سيتم إيقاف واجهة API الخارجية."],
  // Models.
  "When OpenCode or Pi has no model of its own, OMMS uses the external API model {model}.": [
    "当 OpenCode 或 Pi 没有自己的模型时，OMMS 使用外部 API 模型 {model}。",
    "عندما لا يكون لدى OpenCode أو Pi نموذج خاص به، يستخدم OMMS نموذج واجهة API الخارجية {model}.",
  ],
  "The external API is not set up, so when OpenCode or Pi has no model of its own, OMMS uses the session model.":
    [
      "外部 API 尚未设置，所以当 OpenCode 或 Pi 没有自己的模型时，OMMS 使用会话模型。",
      "لم تُضبط واجهة API الخارجية، لذلك عندما لا يكون لدى OpenCode أو Pi نموذج خاص به، يستخدم OMMS نموذج الجلسة.",
    ],
  "Save key": ["保存密钥", "حفظ المفتاح"],
  // Web app.
  "Save web app settings?": ["保存网页应用设置？", "حفظ إعدادات تطبيق الويب؟"],
  "OpenCode and Pi start the web app for you. With Claude Code alone, start it yourself with the first command below, or install the login item.":
    [
      "OpenCode 和 Pi 会替你启动网页应用。只使用 Claude Code 时，请用下面第一条命令自己启动，或安装登录启动项。",
      "يشغّل OpenCode وPi تطبيق الويب نيابةً عنك. إذا كنت تستخدم Claude Code وحده فشغّله بنفسك بالأمر الأول أدناه أو ثبّت عنصر بدء التشغيل.",
    ],
  // Embedding.
  "Unlock to change": ["解锁以更改", "افتح القفل للتغيير"],
  Lock: ["锁定", "قفل"],
  "Re-embed every memory?": ["重新嵌入所有记忆？", "إعادة تضمين كل الذكريات؟"],
  "Every stored memory will be re-embedded": [
    "所有已存储的记忆都将重新嵌入",
    "ستُعاد عملية تضمين كل الذكريات المخزنة",
  ],
  "The saved key is kept.": ["保留已保存的密钥。", "يُحتفظ بالمفتاح المحفوظ."],
  "Replace the saved key": ["替换已保存的密钥", "استبدال المفتاح المحفوظ"],
  "Re-embed": ["重新嵌入", "إعادة التضمين"],
  "Re-embedding…": ["正在重新嵌入…", "جارٍ إعادة التضمين…"],
  "Retry the re-embed?": ["重试重新嵌入？", "إعادة محاولة إعادة التضمين؟"],
  "The re-embed will run again and send every stored memory to the embedding model.": [
    "重新嵌入会再次运行，并把每条已存储的记忆发送到嵌入模型。",
    "ستُشغَّل إعادة التضمين مرة أخرى، وتُرسَل كل ذكرى مخزنة إلى نموذج التضمين.",
  ],
  // Capture diagnostics.
  "Save retention": ["保存保留设置", "حفظ إعدادات الاحتفاظ"],
  "Save retention?": ["保存保留设置？", "حفظ إعدادات الاحتفاظ؟"],
  "Retry waiting turns?": ["重试等待中的回合？", "إعادة محاولة الأدوار المنتظرة؟"],
  "The waiting turns will be sent to the model again.": [
    "等待中的回合会再次发送给模型。",
    "ستُرسَل الأدوار المنتظرة إلى النموذج مرة أخرى.",
  ],
  "Retrying…": ["正在重试…", "جارٍ إعادة المحاولة…"],
  "Use a whole number of days, 1 or more.": [
    "请填写天数，1 或更大的整数。",
    "استخدم عدداً صحيحاً من الأيام، 1 أو أكثر.",
  ],
  "Use a whole number of hours from 0 to 720.": [
    "请填写 0 到 720 之间的整数小时。",
    "استخدم عدداً صحيحاً من الساعات بين 0 و720.",
  ],
  "Turn off the retry queue?": ["关闭重试队列？", "إيقاف قائمة إعادة المحاولة؟"],
  "1 waiting turn will be deleted. The queue stays off until you set a number of hours again.": [
    "有 1 个等待中的回合会被删除。在你重新设置小时数之前，队列保持关闭。",
    "سيُحذف دور واحد ينتظر. تبقى القائمة متوقفة حتى تضبط عدد الساعات مرة أخرى.",
  ],
  "{count} waiting turns will be deleted. The queue stays off until you set a number of hours again.":
    [
      "有 {count} 个等待中的回合会被删除。在你重新设置小时数之前，队列保持关闭。",
      "ستُحذف {count} أدوار تنتظر. تبقى القائمة متوقفة حتى تضبط عدد الساعات مرة أخرى.",
    ],
  "No turn is waiting. The queue stays off until you set a number of hours again.": [
    "没有等待中的回合。在你重新设置小时数之前，队列保持关闭。",
    "لا يوجد دور ينتظر. تبقى القائمة متوقفة حتى تضبط عدد الساعات مرة أخرى.",
  ],
  "Turn off and delete": ["关闭并删除", "إيقاف وحذف"],
  "OMMS could not count the waiting turns, so it will not turn the queue off. Try again.": [
    "OMMS 无法统计等待中的回合，所以不会关闭队列。请重试。",
    "تعذّر على OMMS عدّ الأدوار المنتظرة، لذلك لن يوقف القائمة. حاول مرة أخرى.",
  ],
  "Turn on trace saving?": ["开启捕获痕迹保存？", "تفعيل حفظ آثار الالتقاط؟"],
  "Turn on": ["开启", "تشغيل"],
  "Delete trace file?": ["删除痕迹文件？", "حذف ملف الأثر؟"],
  "Revoke this token?": ["撤销此令牌？", "إلغاء هذا الرمز؟"],
  "Scripts that use it stop working.": [
    "使用它的脚本会停止工作。",
    "ستتوقف السكربتات التي تستخدمه.",
  ],
  "Save the browser password?": ["保存浏览器密码？", "حفظ كلمة مرور المتصفح؟"],
  "The password is stored in a private file on this computer. The web app asks for it after it restarts.":
    [
      "密码存储在这台电脑上的一个私有文件中。网页应用重启后会要求输入它。",
      "تُخزَّن كلمة المرور في ملف خاص على هذا الحاسوب. يطلبها تطبيق الويب بعد إعادة تشغيله.",
    ],
  "Clear the browser password?": ["清除浏览器密码？", "مسح كلمة مرور المتصفح؟"],
  "The browser password is removed. The web app stops asking for it after it restarts.": [
    "浏览器密码会被移除。网页应用重启后不再要求输入。",
    "تُزال كلمة مرور المتصفح. يتوقف تطبيق الويب عن طلبها بعد إعادة تشغيله.",
  ],
  "Generate a token?": ["生成令牌？", "إنشاء رمز؟"],
  "OMMS creates a token that lets scripts and other computers call this web app's API.": [
    "OMMS 会创建一个令牌，让脚本和其他计算机调用此网页应用的 API。",
    "ينشئ OMMS رمزاً يتيح للسكربتات والحاسوبات الأخرى استدعاء واجهة API لتطبيق الويب هذا.",
  ],
  "Use this profile for every folder?": [
    "在所有文件夹中使用此画像？",
    "استخدام هذا الملف الشخصي في كل المجلدات؟",
  ],
};
