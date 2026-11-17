/**
 * Texts for the import confirm dialog, the progress bar and the finish summary
 * on the Memory page. English message first, then Chinese and Arabic.
 * `settings.ts` merges this table into the Settings table. The dialog and
 * summary group owns this file. The line "Chats already imported are skipped,
 * so running an import again is safe." lives in `import-flow.ts`; the dialog
 * uses the same English message.
 */
export const importResultText = {
  "Import chats?": ["导入聊天？", "استيراد المحادثات؟"],
  "OMMS sends parts of these chats to your model. This can cost money.": [
    "OMMS 会把这些聊天的部分内容发送给您的模型，这可能产生费用。",
    "سيرسل OMMS أجزاء من هذه المحادثات إلى نموذجك. قد يكلّف ذلك مالاً.",
  ],
  "Sessions to import: {sessions}": [
    "待导入的会话：{sessions}",
    "الجلسات المراد استيرادها: {sessions}",
  ],
  "From: {hosts}": ["来自：{hosts}", "من: {hosts}"],
  "Model calls: about {calls}": ["模型调用：约 {calls} 次", "استدعاءات النموذج: نحو {calls}"],
  "Time: about {minutes} min": ["用时：约 {minutes} 分钟", "المدة: نحو {minutes} دقيقة"],
  "The time is known once the import starts.": [
    "导入开始后才能知道用时。",
    "تُعرف المدة بعد بدء الاستيراد.",
  ],
  "These numbers are estimates.": ["这些数字只是估计值。", "هذه الأرقام تقديرية."],
  "Starting the import…": ["正在开始导入…", "جارٍ بدء الاستيراد…"],
  "The import did not start: {reason}": ["导入没有开始：{reason}", "لم يبدأ الاستيراد: {reason}"],
  "Saving memories": ["正在保存记忆", "حفظ الذكريات"],
  "Learning your profile": ["正在学习你的画像", "تعلّم ملفك الشخصي"],
  "About {minutes} min left": ["约剩 {minutes} 分钟", "يتبقى نحو {minutes} دقيقة"],
  "Time left: not known yet": ["剩余时间：暂时未知", "الوقت المتبقي: غير معروف بعد"],
  "Memories saved: {n}": ["已保存的记忆：{n}", "الذكريات المحفوظة: {n}"],
  "Profile updated from 1 prompt": [
    "已根据 1 条提示更新画像",
    "تم تحديث الملف الشخصي من مطالبة واحدة",
  ],
  "Profile updated from {n} prompts": [
    "已根据 {n} 条提示更新画像",
    "تم تحديث الملف الشخصي من {n} من المطالبات",
  ],
  "Failed: {n}": ["失败：{n}", "الفاشلة: {n}"],
  "Nothing failed.": ["没有失败的内容。", "لم يفشل شيء."],
  "The import stopped before it finished.": [
    "导入在完成前停止了。",
    "توقف الاستيراد قبل أن ينتهي.",
  ],
  "Profile learning failed": ["画像学习失败", "فشل تعلّم الملف الشخصي"],
  "Profile learning needs your email address. Set it with git config --global user.email, then import again. Completed memory work is saved.":
    [
      "画像学习需要你的电子邮件地址。请用 git config --global user.email 设置，然后再次导入。已完成的记忆处理已保存。",
      "يحتاج تعلّم الملف الشخصي إلى بريدك الإلكتروني. اضبطه بالأمر git config --global user.email، ثم استورد مرة أخرى. عمل الذاكرة المكتمل محفوظ.",
    ],
  "Retry failed": ["重试失败的部分", "إعادة محاولة الفاشل"],
  "Some work did not finish. Retry failed tries only that work.": [
    "有些内容没有完成。“重试失败的部分”只会重试这些内容。",
    "لم يكتمل بعض العمل. تعيد «إعادة محاولة الفاشل» ذلك العمل فقط.",
  ],
  "Check the model settings, then select Retry failed.": [
    "请检查模型设置，然后选择“重试失败的部分”。",
    "تحقق من إعدادات النموذج، ثم اختر «إعادة محاولة الفاشل».",
  ],
  Details: ["详情", "التفاصيل"],
} as const;
