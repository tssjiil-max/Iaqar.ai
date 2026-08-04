# IAQAR.AI — معمارية النظام

> يصف هذا الملف المعمارية **الحالية** كما هي في المستودع (بعد تدقيق المرحلة 0)،
> والمعمارية المستهدفة المعتمدة. لا يُسمح باستبدال أي مكوّن دون موافقة المالك.

## 1. المكونات الحالية (واقع — تم التحقق منه)

| المكوّن | الموقع | الوصف |
|---|---|---|
| واجهة PWA ثابتة | `public/index.html` + `public/js/*.js` | صفحة واحدة عربية RTL بلا خطوة بناء؛ تُحمَّل عبر Firebase Hosting مع Firebase compat SDK 12.16.0 من CDN |
| Firebase Auth | عبر Worker | دخول المكتب برقم الجوال + كلمة مرور عبر `POST /auth/phone-login` (Custom Token)؛ دخول إدارة المنصة بالبريد |
| Firestore | قاعدة البيانات | عزل المستأجرين: `offices/{officeId}/...` + قواعد `firestore.rules` |
| FCM | `public/js/fcm-fid.js`، `public/firebase-messaging-sw.js`، مسارات `/fcm/*` في Worker | تسجيل الأجهزة بمعرّف FID أولًا مع رجوع لرمز FCM القديم، إشعارات Web Push |
| Cloudflare Worker | `worker/src/index.js` (`iaqar-macrodroid-intake`) | الاستقبال، التحليل، المطابقة، سير العمل، FCM HTTP v1، رفع الوسائط |
| Cloudflare R2 | bucket `iaqar-media` (binding `IAQAR_MEDIA`) | تخزين صور وفيديو الطلبات العامة وصور غلاف/شعار المكتب |
| PWA | `public/manifest.webmanifest`، `public/share-target.html` | تثبيت على الجهاز + استقبال المشاركة من أندرويد |
| سكربتات إدارية | `admin/*.mjs` | إنشاء مدير المنصة وربط دخول الجوال عبر Firebase Admin SDK |

### مسارات Worker الفعلية (موجودة وتعمل)

- الصحة والإعداد: `GET /health`، `GET /meta/config`، `GET /meta/status`، `GET /fcm/config`، `GET /fcm/status`
- واتساب الرسمي (استقبال فقط): `GET/POST /meta/webhook` (تحقق توقيع HMAC-SHA256)، `POST /meta/signup/complete`
- المعالجة: `POST /pipeline/preview`، `POST /pipeline/intake`، `POST /pipeline/public-intake`، `POST /matching/preview`
- سير العمل: `POST /workflow/action`، `GET /workflow/timeline`، `POST /workflow/preview`، `POST /workflow/readiness/preview`
- التحليلات: `GET /office/analytics`، `POST /office/analytics/preview`
- الوسائط: `POST /media/public-intake`، `POST /media/office-cover`، `POST /media/office-logo`، `GET /media/public/office-covers/*`، `GET /media/public/office-logos/*`
- الهوية: `POST /auth/phone-login`، `POST /auth/forgot-password`، `POST /broker/apply`
- الإدارة: `GET /admin/broker-applications`، `POST /admin/broker-applications/action`
- المكتب: `GET /office/name-availability` (فحص توفر الاسم المطبّع)
- FCM: `POST /fcm/register`، `POST /fcm/unregister`، `POST /fcm/test`
- معطل عمدًا: `POST /ingest` (410)، أي إرسال واتساب صادر (403)

### بنية الواجهة (public/js)

| الملف | الدور |
|---|---|
| `firebase-office.js` | تهيئة Firebase وحل `officeId` (رابط ← تخزين محلي ← `platform`) وبناء مراجع المجموعات |
| `access-gate.js` | بوابة الوصول: المنصة العامة، رابط المكتب العام `/o/{slug}`، نماذج عميل/مالك، تسجيل وسيط، الدخول، طلبات الإدارة |
| `office-utils.js` | منطق نقي مشترك (تطبيع الاسم، التحقق، تفضيلات الإشعارات، أنماط التعاون، إعدادات القص) — يُستخدم في الواجهة واختبارات Node |
| `office-settings.js` | إعدادات المكتب: الهوية البصرية، البيانات، تفرد الاسم، الرابط/QR، تفضيلات الإشعارات، نمط التعاون، بطاقة المشاركة |
| `opportunity-bank.js` | بنك الفرص الخاص بالمكتب (عرض حقيقي من `owners` و`clients`) |
| `workflow-office.js` | مركز العمليات الحي (matches/deals/publicIntake)، إدارة الفرصة، FCM للجهاز |
| `whatsapp-office.js` | ربط واتساب أعمال الرسمي (Embedded Signup، استقبال فقط) |
| `qrcode.js` | توليد QR محلي دون خدمة خارجية |

## 2. تدفق البيانات الحالي

```
مصدر (رابط مكتب عام / مشاركة PWA / واتساب webhook)
  → offices/{officeId}/publicIntake أو /pipeline/intake
  → Worker: تحليل نصي بقواعد محلية (parseRealEstateMessage)
  → كتابة clients/{id} أو owners/{id} + توليد مرشحي المطابقة
  → matches/{id} مع score وأسباب + تحديث alerts
  → FCM لأجهزة المكتب المسجلة (offices/{officeId}/devices)
  → الواجهة تعرض العمليات من matches/deals/publicIntake مباشرة
```

## 3. المعمارية المستهدفة المعتمدة (بدون تغيير المنصة)

- نفس المكدس (Firebase + Cloudflare Worker + R2 + PWA). لا هجرة.
- كيان Opportunity موحد (المرحلة 2–3) فوق نفس مجموعات المكتب مع `officeId` إلزامي.
- بنك الفرص خاص بالمكتب ويُفتح من إعدادات المكتب (مدخل أُضيف في المرحلة 1).
- محرك مطابقة idempotent مع إعادة مطابقة تلقائية (المرحلة 4) ومركز عمليات
  حقيقي بسجلات Operation (المرحلة 5).
- تعاون بين الوسطاء بأنماط: `disabled` / `approval_required` (الافتراضي) /
  `smart_automatic` (المرحلة 6) — حقل `cooperationMode` أُضيف لوثيقة المكتب في المرحلة 1.
- محوّلات واتساب/تيليجرام بعقود نظيفة ووسم صادق (المرحلة 7).
- أحداث عبر نمط outbox مدعوم بقاعدة البيانات عند الحاجة (لا وسيط رسائل جديد دون موافقة).

## 4. قرارات مثبتة

- اسم Worker يحتفظ بـ`macrodroid` للحفاظ على رابط الـWebhook الحالي لدى Meta فقط؛
  المسار القديم `/ingest` معطل (410) والإرسال الصادر محظور (403).
- لا Firebase Storage؛ R2 عبر Worker هو مخزن الوسائط المعتمد.
- لا مفاتيح Firebase في كود العميل باستثناء `apiKey` العام لـFirebase Web
  (مقيد بقواعد Firestore وApp Check مستقبلًا) — لا أسرار أخرى.
- نسبة قص الغلاف العريض إعداد تصميمي قابل للضبط (`OFFICE_DESIGN.coverCrop`
  في `public/js/office-utils.js`) ولا تُثبَّت أبعاد منصة خارجية دون متطلبات موثقة.

انظر أيضًا: `docs/DECISIONS.md`، `docs/DATA_MODEL.md`، `docs/EVENT_WORKFLOW.md`.
