IAQAR Worker — Workflow V5
==========================

المسارات الأساسية:
- GET /health
- GET /meta/config?officeId=...
- GET /meta/status?officeId=...
- GET/POST /meta/webhook
- POST /meta/signup/complete
- POST /pipeline/preview
- POST /pipeline/intake
- POST /matching/preview
- POST /workflow/preview
- POST /workflow/readiness/preview
- POST /workflow/action
- GET /workflow/timeline?officeId=...&recordType=match|deal&recordId=...
- GET /office/analytics?officeId=...
- POST /office/analytics/preview
- GET /fcm/config
- POST /fcm/register
- POST /fcm/unregister

الوظائف:
- ربط واتساب الرسمي لكل مكتب عبر Embedded Signup.
- عزل الربط والرسائل والفرص والصفقات حسب officeId.
- استقبال الرسائل الخاصة فقط ومنع الإرسال التلقائي.
- تحليل الرسالة وإنشاء طلب عميل أو عرض مالك.
- تشغيل محرك المطابقة وترتيب النتائج وشرح الأسباب والتحذيرات.
- حساب جاهزية الإغلاق وحالة المطابقة وصحة الصفقة والخطوة التالية.
- متابعة كل مطابقة بصورة مستقلة وإنشاء سجل نشاط زمني.
- دورة صفقة كاملة حتى الإغلاق.
- إغلاق المطابقات الشقيقة تلقائيًا بعد نجاح صفقة واحدة.
- فحص المتابعات المستحقة كل ساعة بواسطة Cloudflare Cron وإرسال FCM.

إجراءات POST /workflow/action:
- advance_match
- add_match_followup
- close_match
- create_deal
- advance_deal
- set_deal_stage
- add_deal_followup
- add_deal_note
- mark_lost
- close_deal

الأسرار المطلوبة في Cloudflare Worker:
- FIREBASE_CLIENT_EMAIL
- FIREBASE_PRIVATE_KEY
- META_APP_SECRET
- META_WEBHOOK_VERIFY_TOKEN

المتغيرات:
- FIREBASE_PROJECT_ID
- META_APP_ID
- META_CONFIG_ID
- META_GRAPH_VERSION
- FCM_WEB_PUSH_VAPID_KEY

التشغيل المجدول:
- wrangler.toml يشغّل فحص المتابعات كل ساعة: 0 * * * *

الأمان:
- كل عمليات الربط والبيانات والمتابعات والصفقات تتطلب Firebase ID Token.
- الفرص والمتابعات والصفقات متاحة للعضو الفعال في مكتبه فقط.
- ربط Meta يحتاج مالكًا أو admin أو manager أو عضوًا لديه canManageIntegrations.
- مسارات الإرسال الخارجي محظورة، و/ingest القديم يرجع 410.

ملاحظة تعدد المكاتب:
- كل جهاز يسجل داخل offices/{officeId}/devices فقط.
- يمكن تفعيل أو إيقاف إشعارات كل مكتب على كل جهاز بصورة مستقلة.
- لا تُرسل إشعارات مكتب إلى جهاز مسجل في مكتب آخر.
