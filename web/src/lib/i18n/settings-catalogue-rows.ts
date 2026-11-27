/**
 * Chinese and Arabic texts for the settings catalogue rows (`settings-catalogue*.ts`): names,
 * descriptions, defaults and "what it affects". The English text is the key. Product names, such
 * as OpenCode and Pi, stay as they are.
 */
export const settingsCatalogueRowText = {
  // What a setting affects.
  "Saving memories from your sessions": ["保存会话中的记忆", "حفظ الذكريات من جلساتك"],
  "Finding memories for your prompts": ["为你的提示查找记忆", "العثور على الذكريات لمطالباتك"],
  "Memories added to your prompts": ["添加到提示中的记忆", "الذكريات المضافة إلى مطالباتك"],
  "What you see in the terminal": ["你在终端中看到的内容", "ما تراه في الطرفية"],
  "Your user profile": ["你的用户画像", "ملفك الشخصي"],
  "Deleting old memories": ["删除旧记忆", "حذف الذكريات القديمة"],
  "Capture diagnostics": ["捕获诊断", "تشخيص الالتقاط"],
  "The web app": ["网页应用", "تطبيق الويب"],
  "Who can open the web app": ["谁可以打开网页应用", "من يمكنه فتح تطبيق الويب"],
  "Which model saves memories": ["由哪个模型保存记忆", "أي نموذج يحفظ الذكريات"],
  "Importing past sessions": ["导入过往会话", "استيراد الجلسات السابقة"],
  "Skill learning": ["技能学习", "تعلّم المهارات"],
  "How memories are matched by meaning": ["如何按含义匹配记忆", "كيف تُطابَق الذكريات بحسب المعنى"],
  "The order of search results": ["搜索结果的顺序", "ترتيب نتائج البحث"],
  "Reading Claude Code history": ["读取 Claude Code 历史记录", "قراءة سجل Claude Code"],
  Memorisations: ["记忆存档", "الحفظ"],
  // Defaults.
  On: ["开", "قيد التشغيل"],
  Off: ["关", "متوقف"],
  "Not set": ["未设置", "غير محدد"],
  "Default ({value})": ["默认（{value}）", "افتراضي ({value})"],
  None: ["无", "لا شيء"],
  // The list of changes in a settings confirm dialog.
  "changes to": ["改为", "يتغير إلى"],
  "This project": ["本项目", "هذا المشروع"],
  "OpenAI Chat Completions": ["OpenAI Chat Completions", "OpenAI Chat Completions"],
  "Session model": ["会话模型", "نموذج الجلسة"],
  "External API, else the session model": [
    "外部 API，没有时使用会话模型",
    "الواجهة البرمجية الخارجية، وإلا فنموذج الجلسة",
  ],
  "Built-in nomic-embed-text": ["内置 nomic-embed-text", "نموذج nomic-embed-text المدمج"],
  "Read from the model": ["从模型读取", "يُقرأ من النموذج"],
  "Not set (built-in model)": ["未设置（使用内置模型）", "غير محدد (النموذج المدمج)"],
  "30 days": ["30 天", "30 يوماً"],
  "7 days": ["7 天", "7 أيام"],
  "72 hours": ["72 小时", "72 ساعة"],
  "500 prompts": ["500 条提示", "500 مطالبة"],
  "The usual Claude folder": ["常用的 Claude 文件夹", "مجلد Claude المعتاد"],
  "Same as the conversation": ["与对话相同", "مثل لغة المحادثة"],
  "The usual skill folders": ["常用的技能文件夹", "مجلدات المهارات المعتادة"],
  "10 memories": ["10 条记忆", "10 ذكريات"],
  "128 KB of text": ["128 KB 文本", "128 كيلوبايت من النص"],
  "32 KB of text": ["32 KB 文本", "32 كيلوبايت من النص"],
  "2,000 word pieces": ["2,000 个词片段", "2,000 قطعة كلمات"],
  "0.6 (0.5 with qwen3-embedding)": [
    "0.6（使用 qwen3-embedding 时为 0.5）",
    "0.6 (0.5 مع qwen3-embedding)",
  ],
  "project architecture, setup, conventions and key decisions": [
    "英文搜索文本：project architecture, setup, conventions and key decisions",
    "نص البحث بالإنجليزية: project architecture, setup, conventions and key decisions",
  ],
  "Add a bonus for word matches": ["为词语匹配加分", "إضافة مكافأة لتطابق الكلمات"],
  "4 seconds": ["4 秒", "4 ثوانٍ"],
  "800 characters": ["800 个字符", "800 حرف"],
  "2,000 characters": ["2,000 个字符", "2,000 حرف"],
  "5,000 characters": ["5,000 个字符", "5,000 حرف"],
  Characters: ["字符", "الأحرف"],
  "Add a new one": ["新增一条", "إضافة واحدة جديدة"],
  // Names and descriptions on the Settings page.
  "Save memories automatically": ["自动保存记忆", "حفظ الذكريات تلقائياً"],
  "Saves a short memory from your coding sessions as you work.": [
    "在你编程时，从会话中保存简短的记忆。",
    "يحفظ ذكرى قصيرة من جلسات البرمجة أثناء عملك.",
  ],
  "Recall memories in prompts": ["在提示中调用记忆", "استدعاء الذكريات في المطالبات"],
  "Adds the memories that match your prompt, so the agent remembers earlier work.": [
    "加入与你的提示相符的记忆，让助手记得之前的工作。",
    "يضيف الذكريات المطابقة لمطالبتك ليتذكر الوكيل العمل السابق.",
  ],
  "Show recall rows": ["显示调用记录行", "إظهار صفوف الاستدعاء"],
  "Shows a line in the terminal each time memories are added to a prompt.": [
    "每次把记忆加入提示时，在终端显示一行。",
    "يعرض سطراً في الطرفية كلما أُضيفت ذكريات إلى مطالبة.",
  ],
  "Add your profile to prompts": ["把你的画像加入提示", "إضافة ملفك الشخصي إلى المطالبات"],
  "Adds your learned preferences and habits to the memories the agent gets.": [
    "把学到的偏好和习惯加入助手收到的记忆。",
    "يضيف تفضيلاتك وعاداتك المتعلَّمة إلى الذكريات التي يتلقاها الوكيل.",
  ],
  "Where a search looks": ["搜索的范围", "أين يبحث البحث"],
  "Searches this project only, or every project, when a search does not say.": [
    "搜索未指定范围时，只搜索当前项目，或搜索所有项目。",
    "يبحث في هذا المشروع فقط أو في كل المشاريع عندما لا يحدد البحث ذلك.",
  ],
  "Delete old memories automatically": ["自动删除旧记忆", "حذف الذكريات القديمة تلقائياً"],
  "Deletes memories that have not changed for a set number of days. A deleted memory cannot be restored.":
    [
      "删除在设定天数内没有变化的记忆。删除后的记忆无法恢复。",
      "يحذف الذكريات التي لم تتغير خلال عدد محدد من الأيام. لا يمكن استعادة الذكرى المحذوفة.",
    ],
  "Days before a memory is old": ["记忆变旧所需的天数", "عدد الأيام قبل أن تُعدّ الذكرى قديمة"],
  "A memory that has not changed for this many days counts as old.": [
    "超过这么多天没有变化的记忆算作旧记忆。",
    "تُعدّ الذكرى التي لم تتغير خلال هذا العدد من الأيام قديمة.",
  ],
  "Model service type": ["模型服务类型", "نوع خدمة النموذج"],
  "The kind of service that runs the model that writes your memories.": [
    "运行记忆撰写模型的服务类型。",
    "نوع الخدمة التي تشغّل النموذج الذي يكتب ذكرياتك.",
  ],
  "Model service address": ["模型服务地址", "عنوان خدمة النموذج"],
  "The web address of the service. Every provider needs one, except OrcaRouter, which has its own.":
    [
      "服务的网址。除 OrcaRouter 有自己的地址外，每个提供商都需要填写。",
      "عنوان الويب للخدمة. يحتاجه كل مزوّد، إلا OrcaRouter لأن له عنوانه الخاص.",
    ],
  "Model name": ["模型名称", "اسم النموذج"],
  "The model that writes your memories.": ["撰写你的记忆的模型。", "النموذج الذي يكتب ذكرياتك."],
  "Model service key": ["模型服务密钥", "مفتاح خدمة النموذج"],
  "The key that lets OMMS use the service. It stays in a private file or an environment variable.":
    [
      "让 OMMS 使用该服务的密钥。它保存在私有文件或环境变量中。",
      "المفتاح الذي يتيح لـ OMMS استخدام الخدمة. يبقى في ملف خاص أو متغير بيئة.",
    ],
  "OpenCode model service": ["OpenCode 模型服务", "خدمة نموذج OpenCode"],
  "The service OpenCode uses to write memories. Choose the session's model to use the one you chat with.":
    [
      "OpenCode 用来撰写记忆的服务。选择会话所用的模型，即使用你聊天的那个模型。",
      "الخدمة التي يستخدمها OpenCode لكتابة الذكريات. اختر نموذج الجلسة لاستخدام النموذج الذي تتحدث معه.",
    ],
  "OpenCode model": ["OpenCode 模型", "نموذج OpenCode"],
  "The model OpenCode uses to write memories.": [
    "OpenCode 用来撰写记忆的模型。",
    "النموذج الذي يستخدمه OpenCode لكتابة الذكريات.",
  ],
  "Pi model service": ["Pi 模型服务", "خدمة نموذج Pi"],
  "The service Pi uses to write memories. Choose the session's model to use the one you chat with.":
    [
      "Pi 用来撰写记忆的服务。选择会话所用的模型，即使用你聊天的那个模型。",
      "الخدمة التي يستخدمها Pi لكتابة الذكريات. اختر نموذج الجلسة لاستخدام النموذج الذي تتحدث معه.",
    ],
  "Pi model": ["Pi 模型", "نموذج Pi"],
  "The model Pi uses to write memories.": [
    "Pi 用来撰写记忆的模型。",
    "النموذج الذي يستخدمه Pi لكتابة الذكريات.",
  ],
  "OpenCode import model": ["OpenCode 导入模型", "نموذج استيراد OpenCode"],
  "The model that reads past OpenCode sessions during an import.": [
    "导入时读取过往 OpenCode 会话的模型。",
    "النموذج الذي يقرأ جلسات OpenCode السابقة أثناء الاستيراد.",
  ],
  "Pi import model": ["Pi 导入模型", "نموذج استيراد Pi"],
  "The model that reads past Pi sessions during an import.": [
    "导入时读取过往 Pi 会话的模型。",
    "النموذج الذي يقرأ جلسات Pi السابقة أثناء الاستيراد.",
  ],
  "Embedding model": ["嵌入模型", "نموذج التضمين"],
  "The model that turns text into numbers, so OMMS can match memories by meaning.": [
    "把文本变成数字的模型，让 OMMS 能按含义匹配记忆。",
    "النموذج الذي يحوّل النص إلى أرقام ليطابق OMMS الذكريات بحسب المعنى.",
  ],
  "Embedding size": ["嵌入维度", "حجم التضمين"],
  "How many numbers describe one memory. Change it only when the model needs it.": [
    "用多少个数字描述一条记忆。只有模型需要时才修改。",
    "كم رقماً يصف ذكرى واحدة. غيّره فقط عندما يتطلب النموذج ذلك.",
  ],
  "Embedding server address": ["嵌入服务器地址", "عنوان خادم التضمين"],
  "Where OMMS asks for embeddings. Empty means the built-in model runs on this machine.": [
    "OMMS 向哪里请求嵌入。留空表示在本机运行内置模型。",
    "المكان الذي يطلب منه OMMS التضمينات. الفارغ يعني تشغيل النموذج المدمج على هذا الجهاز.",
  ],
  "Embedding server key": ["嵌入服务器密钥", "مفتاح خادم التضمين"],
  "The key for the embedding server, when it needs one.": [
    "嵌入服务器的密钥（需要时才填）。",
    "مفتاح خادم التضمين عندما يحتاج إليه.",
  ],
  "Browser user name": ["浏览器用户名", "اسم مستخدم المتصفح"],
  "The user name for the web app when you open it from another machine.": [
    "从其他设备打开网页应用时使用的用户名。",
    "اسم المستخدم لتطبيق الويب عند فتحه من جهاز آخر.",
  ],
  "Browser password": ["浏览器密码", "كلمة مرور المتصفح"],
  "The password for the web app. It stays in a private file.": [
    "网页应用的密码。它保存在私有文件中。",
    "كلمة مرور تطبيق الويب. تبقى في ملف خاص.",
  ],
  "Record capture traces": ["记录保存追踪", "تسجيل آثار الحفظ"],
  "Saves the text sent to and from the memory model, to help find problems. A trace can hold your conversations.":
    [
      "保存发送给记忆模型和从中返回的文本，便于排查问题。追踪可能包含你的对话。",
      "يحفظ النص المرسل إلى نموذج الذاكرة والعائد منه للمساعدة في إيجاد المشكلات. قد يحتوي الأثر على محادثاتك.",
    ],
  "Days to keep traces": ["追踪保留天数", "أيام الاحتفاظ بالآثار"],
  "How long a trace file stays before OMMS deletes it.": [
    "追踪文件在被 OMMS 删除前保留多久。",
    "المدة التي يبقى فيها ملف الأثر قبل أن يحذفه OMMS.",
  ],
  "Days to keep capture records": ["保存记录保留天数", "أيام الاحتفاظ بسجلات الحفظ"],
  "How long OMMS keeps the record of each save attempt.": [
    "OMMS 保留每次保存尝试记录的时长。",
    "المدة التي يحتفظ فيها OMMS بسجل كل محاولة حفظ.",
  ],
  "Hours to keep failed turns": ["失败回合保留小时数", "ساعات الاحتفاظ بالأدوار الفاشلة"],
  "How long a turn that failed to save waits for a retry. 0 turns retries off and deletes the waiting turns.":
    [
      "保存失败的回合等待重试的时长。0 表示关闭重试并删除等待中的回合。",
      "المدة التي ينتظر فيها الدور الذي فشل حفظه إعادة المحاولة. القيمة 0 توقف إعادة المحاولة وتحذف الأدوار المنتظرة.",
    ],
  "Start the web app at login": ["登录时启动网页应用", "تشغيل تطبيق الويب عند تسجيل الدخول"],
  "Adds a login item that starts the OMMS web app when you sign in to your computer. OpenCode, Pi and Claude Code all use the web app.":
    [
      "添加一个登录项，在你登录电脑时启动 OMMS 网页应用。OpenCode、Pi 和 Claude Code 都使用这个网页应用。",
      "يضيف عنصر تسجيل دخول يشغّل تطبيق ويب OMMS عند تسجيل دخولك إلى الحاسوب. يستخدم OpenCode وPi وClaude Code تطبيق الويب.",
    ],
  "Claude Code folder": ["Claude Code 文件夹", "مجلد Claude Code"],
  "The folder where Claude Code keeps its settings and history.": [
    "Claude Code 保存设置和历史记录的文件夹。",
    "المجلد الذي يحفظ فيه Claude Code إعداداته وسجله.",
  ],
  "Memory language": ["记忆语言", "لغة الذاكرة"],
  "The language that saved memories are written in.": [
    "保存的记忆所使用的语言。",
    "اللغة التي تُكتب بها الذكريات المحفوظة.",
  ],
  "Learn from skill use": ["从技能使用中学习", "التعلّم من استخدام المهارات"],
  "Records each turn, so OMMS can rank your skills and draft better versions.": [
    "记录每个回合，让 OMMS 能为你的技能排序并起草更好的版本。",
    "يسجل كل دور ليتمكن OMMS من ترتيب مهاراتك وصياغة نسخ أفضل.",
  ],
  "Hide private text in skill records": [
    "在技能记录中隐藏私密文本",
    "إخفاء النص الخاص في سجلات المهارات",
  ],
  "Removes private text and secrets before a turn is recorded.": [
    "在记录回合前移除私密文本和机密内容。",
    "يزيل النص الخاص والأسرار قبل تسجيل الدور.",
  ],
  "Skill folders": ["技能文件夹", "مجلدات المهارات"],
  "The folders OMMS reads your skills from.": [
    "OMMS 读取你技能的文件夹。",
    "المجلدات التي يقرأ منها OMMS مهاراتك.",
  ],
} as const;
