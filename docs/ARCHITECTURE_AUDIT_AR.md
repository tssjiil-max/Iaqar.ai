# iAqar.ai — تقرير التدقيق الهندسي الأولي (المرحلة 0)
التاريخ: 2026-10-23
المستودع: tssjiil-max/Iaqar.ai
الفرع: plan/security-cleanup-v2
الحالة: **فحص كود ثابت مبدئي؛ ليس فحص إنتاج ولا اختبارات تنفيذية**.

## خلاصة مثبتة من الكود
- `worker/src/index.js` ملف رئيسي كبير (~2638 سطرًا)، يحوي المسارات والخدمات والتحليل والمطابقة والمتابعة؛ يبرر الفصل التدريجي إلى وحدات دون إعادة كتابة.
- GET/POST `/meta/webhook` و`/pipeline/intake` و`/matching/preview` موجودة في Router.
- `processInboundMessage` يحلل الرسالة، ويضع `unknown` في `inbox` بحالة `needs_review` بدل إنشاء عميل/عرض.
- معالجة رسالة WhatsApp تحفظ `inbox` أولاً، ثم تستدعي `processInboundMessage` داخل try/catch؛ عند الفشل تسجل `processingState=failed` و`processingError` في المستند دون تحويله إلى `clients/owners`، مع إكمال مسار الحفظ. **هذا احتمال تشخيصي مهم** لبلاغ المستخدم: رسائل واتساب لا تظهر كعروض/طلبات، بينما المطابقة في الويب تعمل.
- `/pipeline/public-intake` له مسار مختلف: يحول طلب الرابط إلى `clients/owners` و`opportunities` ثم `findAndSaveMatches`. إذن هناك مساران للإدخال ينبغي اختبار تطابق ناتجهما، لا إنشاء محرك مطابقة آخر.
- `firestore.rules` يقيّد المكاتب بأدوار/عضوية (يلزم تدقيق حقول الكتابة وعزل cross-office). وجود officeId ليس ضمانًا كافيًا وحده.
- README-AR.txt يؤكد أن الإرسال التلقائي لواتساب محظور في النسخة الموثقة؛ لا تفعّله أثناء إصلاح الإدخال.

## ما لا نعرفه بعد
- هل Webhook الحقيقي يستقبل رسالة المستخدم؟ وهل يتطابق phoneNumberId مع مكتب المستخدم؟
- هل `inbox` يحتوي فعليًا على `failed` أو `needs_review` أو هل الرسالة لم تصل مطلقًا؟
- هل إعدادات Cloudflare وFirebase في بيئة الإنتاج متطابقة مع فرع GitHub؟
- هل المزامنة مع الواجهة أو قواعد الصلاحيات هي ما يمنع ظهور المستندات؟
- هل ثلاثة وكلاء أذكياء قائمون بالفعل في الكود؟ لم يثبت من هذا الفحص.

## فرضيات مشروطة وخطوة الحسم
1. لا يوجد `inbox` => افحص Meta webhook signature/subscription وPhone Number ID وحالة الربط (صلاحيات قراءة سجلات فقط).
2. يوجد inbox بحالة `needs_review` => افحص نتائج parser والنصوص التي فشل تصنيفها.
3. يوجد inbox بحالة `failed` => افحص `processingError` وسجلات Worker وكتابات Firestore اللاحقة.
4. يوجد سجل في clients/owners ولا يوجد match => افحص شروط المطابقة وتوافق البيانات وحالة المعالجة.
5. توجد matches لا تظهر في الواجهة => افحص اشتراكات Firestore/UI والأذونات.

## إعادة التنظيم المطلوبة (بعد الاختبارات)
- الحفاظ على محرك المطابقة الحالي ووحدات data store / workflow والتعامل مع WhatsApp كموصل.
- عقود واجهة داخلية مستقرة: normalizedRecord, officeScope, source, messageId, reviewStatus, matchResult.
- فصل وحدات: Auth/Tenancy, Ingestion/Adapters, Matching, Viewing, Negotiation, Workflow, Notifications, Agent Orchestrator.
- لا تدّعي أن وكلاء المطابقة والمعاينة والتفاوض موجودون؛ تصميمهم مرحلة تنفيذ لاحقة مع fallback يدوي وFeature Flags.

## اختبارات القبول قبل أي تغيير
- Webhook صالح برسالة عرض/طلب -> مكتب صحيح -> inbox -> clients/owners -> matches (أو سبب موثق لعدم المطابقة).
- Duplicate messageId لا ينشئ سجلين.
- فشل التحليل يترك رسالة للمراجعة ولا يفقدها بصمت.
- تعذر كتابة Firestore يسجل خطأ تشغيليًا دون الادعاء بنجاح تسجيل الطلب.
- منع عبور الرسائل بين مكتبين ومنع تغيير المكتب عبر officeId غير مخوّل.
- عند إيقاف AI، تبقى وظائف المطابقة والمتابعة الأساسية متاحة.

## سياسة التنفيذ
- المرحلة 0 فقط موثقة هنا؛ لم يُصلح الكود ولم تُشغّل الاختبارات ولم يُعدّل إنتاج.
- البدء لاحقًا باختبارات محلية اصطناعية وإصلاح صغير في فرع التطوير فقط؛ لا حذف بيانات ولا تفعيل مدفوعات ولا دمج أو نشر دون اعتماد.
## المصادر من المستودع
- `worker/src/index.js` خصوصًا Router ومقاطع `processInboundMessage` و`handlePublicIntakeMatching`.
- `worker/test/worker.test.mjs` (توجد اختبارات parsing/matching/preview).
- `firestore.rules`, `README-AR.txt`, `docs/STEP-5-COMPLETE-CYCLE-AR.txt`.
