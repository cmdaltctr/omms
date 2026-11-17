/**
 * Chinese and Arabic texts that only the shared Memory page cards need (Reranker and Keyword
 * matching). The English text is the key. `settings-catalogue.ts` merges this table, so the
 * cards read it through `useCatalogueText`.
 */
export const memoryCardText: Readonly<Record<string, readonly [string, string]>> = {
  "Enter a web address that starts with http:// or https://.": [
    "请输入以 http:// 或 https:// 开头的网址。",
    "أدخل عنوان ويب يبدأ بـ http:// أو https://.",
  ],
  "Replace the key file?": ["替换密钥文件？", "استبدال ملف المفتاح؟"],
  Replace: ["替换", "استبدال"],
  "Testing the reranker…": ["正在测试重排序器…", "جارٍ اختبار معيد الترتيب…"],
  "A memory that has a word from your prompt gets a small bonus in the order of the results.": [
    "含有你提示中某个词的记忆，在结果排序中会获得一点加分。",
    "تحصل الذكرى التي تحتوي كلمة من مطالبتك على مكافأة صغيرة في ترتيب النتائج.",
  ],
};
