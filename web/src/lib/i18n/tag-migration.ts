/**
 * Texts for the memory tagging dialog: what the run costs, and why a run failed.
 * `translations.ts` merges `tagMigrationText` into each language.
 */
export const tagMigrationText = {
  en: {
    "tag-migration-cost":
      "OMMS asks your memory model (Settings > External API) to suggest tags for each memory. Each memory is one call to that API, which may use paid credit.",
    "tag-migration-no-credit":
      "Your memory model account has no credit left, so tagging stopped. {tagged} of {total} memories were tagged. Top up the account, or choose another model in Settings > External API, then click Try again.",
    "tag-migration-auth":
      "Your memory model did not accept the API key, so tagging stopped. {tagged} of {total} memories were tagged. Check the key in Settings > External API, then click Try again.",
    "tag-migration-partial":
      "{failed} of {total} memories could not be tagged. {tagged} were tagged. Click Try again to retry the rest.",
    "tag-migration-reason": "Reply from the model: {error}",
    "tag-migration-retry": "Try again",
  },
  zh: {
    "tag-migration-cost":
      "OMMS 会请您的记忆模型（设置 > 外部 API）为每条记忆生成标签。每条记忆调用一次该 API，可能消耗付费额度。",
    "tag-migration-no-credit":
      "您的记忆模型账户余额不足，标签生成已停止。已为 {total} 条中的 {tagged} 条记忆生成标签。请为账户充值，或在设置 > 外部 API 中选择其他模型，然后点击“重试”。",
    "tag-migration-auth":
      "您的记忆模型不接受该 API 密钥，标签生成已停止。已为 {total} 条中的 {tagged} 条记忆生成标签。请在设置 > 外部 API 中检查密钥，然后点击“重试”。",
    "tag-migration-partial":
      "{total} 条记忆中有 {failed} 条无法生成标签，{tagged} 条已生成。点击“重试”处理其余记忆。",
    "tag-migration-reason": "模型的回复：{error}",
    "tag-migration-retry": "重试",
  },
  ar: {
    "tag-migration-cost":
      "يطلب OMMS من نموذج الذاكرة (الإعدادات > واجهة API الخارجية) اقتراح وسوم لكل ذكرى. كل ذكرى هي طلب واحد إلى تلك الواجهة، وقد يستهلك رصيدًا مدفوعًا.",
    "tag-migration-no-credit":
      "لا يوجد رصيد كافٍ في حساب نموذج الذاكرة، لذلك توقف إضافة الوسوم. تمت إضافة وسوم إلى {tagged} من {total} ذكرى. اشحن الحساب، أو اختر نموذجًا آخر في الإعدادات > واجهة API الخارجية، ثم انقر على إعادة المحاولة.",
    "tag-migration-auth":
      "لم يقبل نموذج الذاكرة مفتاح API، لذلك توقف إضافة الوسوم. تمت إضافة وسوم إلى {tagged} من {total} ذكرى. تحقق من المفتاح في الإعدادات > واجهة API الخارجية، ثم انقر على إعادة المحاولة.",
    "tag-migration-partial":
      "تعذر إضافة وسوم إلى {failed} من {total} ذكرى، وتمت إضافة وسوم إلى {tagged}. انقر على إعادة المحاولة لمعالجة الباقي.",
    "tag-migration-reason": "رد النموذج: {error}",
    "tag-migration-retry": "إعادة المحاولة",
  },
};
