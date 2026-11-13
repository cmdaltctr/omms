/**
 * Texts for the OpenRouter routing block of the External API card. `settings.ts` merges
 * `openrouterSettingText`, because the card looks its texts up through the settings table.
 */
export const openrouterSettingText = {
  "OpenRouter routing": ["OpenRouter 路由", "توجيه OpenRouter"],
  "Block providers that may train on or store data": [
    "屏蔽可能用于训练或存储数据的提供商",
    "حظر المزوّدين الذين قد يدرّبون على البيانات أو يخزّنونها",
  ],
  "Zero data retention only": ["仅限零数据留存", "الاحتفاظ الصفري بالبيانات فقط"],
  "Providers for this model": ["此模型的提供商", "المزوّدون لهذا النموذج"],
  "Tick providers in the order OpenRouter should try them.": [
    "按 OpenRouter 应尝试的顺序勾选提供商。",
    "حدّد المزوّدين بالترتيب الذي يجب أن يجرّبه OpenRouter.",
  ],
  "Use only these providers": ["仅使用这些提供商", "استخدام هؤلاء المزوّدين فقط"],
  "OpenRouter never falls back to other providers.": [
    "OpenRouter 不会回退到其他提供商。",
    "لن يلجأ OpenRouter إلى مزوّدين آخرين.",
  ],
  "No retention": ["不留存", "بلا احتفاظ"],
  "Abuse checks only": ["仅用于滥用检查", "فحص إساءة الاستخدام فقط"],
  "May keep or train on data": ["可能留存或用于训练数据", "قد يحتفظ بالبيانات أو يدرّب عليها"],
  "Not available while Zero data retention only is on.": [
    "开启“仅限零数据留存”时不可用。",
    "غير متاح أثناء تشغيل «الاحتفاظ الصفري بالبيانات فقط».",
  ],
  "Try position": ["尝试顺序", "ترتيب المحاولة"],
  "Loading the provider list…": ["正在加载提供商列表…", "جارٍ تحميل قائمة المزوّدين…"],
  "Enter a model ID to see its providers.": [
    "输入模型 ID 以查看其提供商。",
    "أدخل معرّف النموذج لعرض مزوّديه.",
  ],
  "OpenRouter has no providers for this model.": [
    "OpenRouter 没有此模型的提供商。",
    "ليس لدى OpenRouter مزوّدون لهذا النموذج.",
  ],
  "The provider list is not available.": ["无法获取提供商列表。", "قائمة المزوّدين غير متاحة."],
  "Provider slug": ["提供商标识", "معرّف المزوّد"],
  "Add provider": ["添加提供商", "إضافة مزوّد"],
  "Remove provider": ["移除提供商", "إزالة المزوّد"],
  "Not a valid provider slug.": ["提供商标识无效。", "معرّف المزوّد غير صالح."],
  "That provider is already in the list.": [
    "该提供商已在列表中。",
    "هذا المزوّد موجود في القائمة.",
  ],
  "Save routing": ["保存路由", "حفظ التوجيه"],
  "Saving routing…": ["正在保存路由…", "جارٍ حفظ التوجيه…"],
  "Routing saved.": ["路由已保存。", "تم حفظ التوجيه."],
  "Other routing fields are set in the config file and are kept.": [
    "其他路由字段在配置文件中设置，并会保留。",
    "حقول التوجيه الأخرى مضبوطة في ملف الإعدادات وسيجري الاحتفاظ بها.",
  ],
  "Save the endpoint first. Routing applies after the OpenRouter URL is saved.": [
    "请先保存端点。保存 OpenRouter 地址后，路由才会生效。",
    "احفظ نقطة النهاية أولاً. يسري التوجيه بعد حفظ عنوان OpenRouter.",
  ],
  "Save the endpoint first. The providers shown are for the model above, which is not saved yet.": [
    "请先保存端点。当前显示的提供商属于上方的模型，该模型尚未保存。",
    "احفظ نقطة النهاية أولاً. المزوّدون المعروضون خاصون بالنموذج أعلاه، وهو غير محفوظ بعد.",
  ],
  "OpenRouter can still use providers labelled Abuse checks only. For strict no retention, set ZDR only in your OpenRouter privacy settings.":
    [
      "OpenRouter 仍可能使用标注为“仅用于滥用检查”的提供商。如需严格不留存，请在 OpenRouter 隐私设置中选择“仅限 ZDR”。",
      "قد يواصل OpenRouter استخدام المزوّدين الموسومين بـ«فحص إساءة الاستخدام فقط». للحصول على عدم احتفاظ صارم، اضبط «ZDR فقط» في إعدادات الخصوصية في OpenRouter.",
    ],
  "OpenRouter routing is still saved and is sent with every request to this endpoint.": [
    "OpenRouter 路由仍处于保存状态，并会随发往此端点的每个请求一起发送。",
    "لا يزال توجيه OpenRouter محفوظاً ويُرسل مع كل طلب إلى نقطة النهاية هذه.",
  ],
  "Remove OpenRouter routing": ["移除 OpenRouter 路由", "إزالة توجيه OpenRouter"],
  "Remove OpenRouter routing? Requests to this endpoint will no longer carry the routing choices.":
    [
      "移除 OpenRouter 路由？发往此端点的请求将不再带有这些路由选项。",
      "هل تريد إزالة توجيه OpenRouter؟ لن تحمل الطلبات المرسلة إلى نقطة النهاية هذه خيارات التوجيه بعد الآن.",
    ],
  "Removing OpenRouter routing…": ["正在移除 OpenRouter 路由…", "جارٍ إزالة توجيه OpenRouter…"],
  "OpenRouter routing removed.": ["OpenRouter 路由已移除。", "تمت إزالة توجيه OpenRouter."],
  "Tick at least one provider first.": [
    "请先至少勾选一个提供商。",
    "حدّد مزوّداً واحداً على الأقل أولاً.",
  ],
  "OpenRouter did not answer within 10 seconds.": [
    "OpenRouter 在 10 秒内没有响应。",
    "لم يردّ OpenRouter خلال 10 ثوانٍ.",
  ],
  "OpenRouter could not be reached.": ["无法连接到 OpenRouter。", "تعذّر الوصول إلى OpenRouter."],
} as const;
