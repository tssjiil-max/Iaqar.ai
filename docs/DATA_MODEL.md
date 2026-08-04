# IAQAR.AI — نموذج البيانات

> يوثّق المجموعات والحقول والفهارس والملكية والوصول كما هي فعلًا في
> `firestore.rules` و`firestore.indexes.json` والكود. كل مستند بإطار مكتب يتضمن
> `officeId` حتى لو كان المسار يحوي المعرّف نفسه.

## 1. المجموعات الجذرية

### `offices/{officeId}`

الوصول: قراءة أعضاء المكتب؛ إنشاء مدير المنصة فقط؛ تحديث مالك/مدير المكتب مع
`validOfficeProfile()`؛ حذف المالك أو مدير المنصة.

| الحقل | النوع | ملاحظات |
|---|---|---|
| `officeId` | string | يساوي معرّف المستند (عزل المستأجر) |
| `officeName` | string ≤80 | إلزامي، ≥4 أحرف دالة للوسيط |
| `officeNameKey` | string ≤100 | الاسم المطبّع للتفرد (NFKC + lowercase + إزالة الفواصل) |
| `brokerName` | string | اسم الوسيط |
| `phone` | string | رقم التواصل (الجوال) |
| `whatsapp` | string | رقم واتساب المكتب (يُستخدم في البطاقة والصفحة العامة) |
| `licenseNumber` | string | رقم رخصة فال |
| `city` | string | المدينة |
| `specialties` | list ≤4 | من: `sale, purchase, rent, property_management` |
| `coverUrl` | string ≤2000 | صورة الغلاف/الواجهة (R2 عبر Worker) |
| `logoUrl` | string ≤2000 | شعار المكتب (R2 عبر Worker) — **المرحلة 1** |
| `publicSlug` | string ≤64 | slug الرابط العام `/o/{publicSlug}` |
| `cooperationMode` | string | `disabled` \| `approval_required` (افتراضي) \| `smart_automatic` — **المرحلة 1** |
| `notificationPrefs` | map | مفاتيح: `matches, contacts, cooperation, messages, appointments, system` — قيم bool — **المرحلة 1** |
| `ownerUid` | string | مالك المكتب (لا يغيّره الوسيط مباشرة) |
| `createdAt/updatedAt` | timestamp | |

### `offices/{officeId}/members/{uid}`

قراءة أعضاء المكتب؛ كتابة المالك/المدير. حقول: `role` (`owner|admin|manager`)،
`active`، `canManageIntegrations`.

### `offices/{officeId}/publicIntake/{docId}`

إنشاء عام بدون تسجيل (نموذج العميل/المالك) بتحقق صارم في القواعد؛ قراءة/تحديث/حذف
لأعضاء المكتب. حقول: `kind (client|owner)`، `name`، `phone`، `propertyType`،
`district`، `details`، `mediaPaths[]`، `imageCount`، `hasVideo`، `source`،
`status (new|…)`، `completeness`، `mediaMissing`، `createdAt`.

### `offices/{officeId}/{owners|clients}/{id}`

طلبات العملاء وعروض الملاك المعتمدة بعد المعالجة (مصدرها `publicIntake` أو
`/pipeline/intake`). الحقول المشتركة: `officeId`، `contactName`، `contactPhone`،
`propertyType`، `district`، `city`، `price|priceMin|priceMax`، `area`، `rooms`،
`completeness`، `status`، `workflowStage`، `source*`، `createdAt/updatedAt`.
هذه هي السجلات التي يعرضها «بنك الفرص» في المرحلة 1 إلى أن يُوحَّد كيان
Opportunity في المرحلة 2–3.

### `offices/{officeId}/matches/{matchId}` (+ `timeline/{eventId}`)

مطابقة بين طلب وعرض: `clientRequestId`، `ownerOfferId`، `score`، `reasonsJson`،
`warningsJson`، `status`، `workflowStage`، `closingReadinessScore/Key/Label`،
`nextAction`، `nextFollowUpAt`، `viewingAt`، `dealId`، `attentionRequired`،
`matchGroupId`، `officeId`، طوابع زمنية.

### `offices/{officeId}/deals/{dealId}` (+ `timeline/{eventId}`)

صفقة قيد التنفيذ: `matchId`، `workflowStage (contact→…→closed|lost)`، `status`،
`commissionExpected/Actual`، `finalPrice`، `internalNote`، `nextFollowUpAt`،
`healthScore/Key`، `officeId`.

### `offices/{officeId}/alerts/{alertId}`

تنبيهات داخلية للمكتب (تُنشأ من Worker): `type`، `recordType/recordId`،
`status`، `officeId`.

### `offices/{officeId}/devices/{deviceId}`

سرية بالكامل (`read,write: false` للعملاء) — تُدار حصريًا من Worker بحساب الخدمة:
`fcmRegistrationId`، `registrationType (fid|token)`، `enabled`، `installationId`،
`userUid`، `appVersion`.

### `offices/{officeId}/contacts/{phone}`

جهات اتصال المكتب (مالك/عميل) مجمّعة برقم الجوال: `fullName`، `roles[]`،
`lastRecordId/Type`.

### `offices/{officeId}/inbox/{id}`، `usage/{id}`، `timeline` الفرعية

صندوق وارد واتساب الخام، عدادات الاستخدام اليومية، وسجلات النشاط — جميعها تحت
قاعدة المجموعة العامة (أعضاء المكتب فقط، و`officeId` مطابق عند الكتابة).

### `publicOffices/{officeId}`

قراءة عامة (لصفحة المكتب العامة وحل الـslug)؛ كتابة المالك/المدير فقط.
حقول: `officeId`، `officeName`، `brokerName`، `phone`، `whatsapp`،
`licenseNumber`، `city`، `specialties`، `coverUrl`، `logoUrl`، `publicSlug`.

### `officeNameClaims/{nameKey}`

حجز تفرد اسم المكتب: قراءة لأي مسجّل؛ إنشاء/تحديث لمدير المكتب المالك مع
`nameKey ≥ 4` (مدير المنصة مستثنى)؛ حذف المالك/المدير. حقول: `officeId`،
`ownerUid`، `officeName`، `updatedAt`. التفرد يُفرض ذريًا بمعاملة Firestore في
`office-settings.js` (`reserveOfficeName`).

### `brokerApplications/{applicationId}`

إنشاء مغلق للعملاء؛ قراءة/تحديث/حذف مدير المنصة فقط (عبر Worker).

### `whatsapp_accounts/{phoneNumberId}`، `_system/**`

مغلقة بالكامل للعملاء — Worker بحساب الخدمة فقط.

## 2. مخزن الوسائط (Cloudflare R2 — bucket `iaqar-media`)

| المسار | المحتوى | الوصول |
|---|---|---|
| `public-intake/{officeId}/{intakeId}/image-N.*`، `video.*` | وسائط طلبات الملاك | كتابة عبر Worker بتحقق النوع/الحجم؛ قراءة غير عامة |
| `office-covers/{officeId}/cover` | غلاف المكتب | كتابة بصلاحية إدارة المكتب؛ قراءة عامة عبر `GET /media/public/office-covers/*` |
| `office-logos/{officeId}/logo` | شعار المكتب | كتابة بصلاحية إدارة المكتب؛ قراءة عامة عبر `GET /media/public/office-logos/*` |

## 3. الفهارس (`firestore.indexes.json`)

- `matches`: `status ASC, createdAt DESC` (COLLECTION)؛`matchGroupId ASC, updatedAt DESC` (COLLECTION)؛`status ASC, nextFollowUpAt ASC` (COLLECTION_GROUP)
- `deals`: `status ASC, updatedAt DESC` (COLLECTION)؛`status ASC, nextFollowUpAt ASC` (COLLECTION_GROUP)
- `alerts`: `status ASC, createdAt DESC` (COLLECTION)

لا فهارس جديدة في المرحلة 1 (استعلامات بنك الفرص تستخدم ترتيب `createdAt`
الافتراضي على مجموعتي `owners` و`clients`).

## 4. حقول محمية

- `ownerUid` وحقول الملكية لا يكتبها الوسيط مباشرة إلا ضمن معاملة حفظ الإعدادات
  التي تحافظ على القيمة الأصلية.
- `devices` و`whatsapp_accounts` و`_system` لا يصل إليها العميل إطلاقًا.
- حقول التعاون والإشعار الجديدة محصورة القيم في `validOfficeProfile()` لمنع
  الإسناد الجماعي لقيم غير معتمدة.

## 5. الخريطة المستقبلية (مراحل 2–7 — غير منفذة بعد)

`opportunities` الموحدة، `opportunitySources`، `matches` (v2 idempotent)،
`operations`، `cooperationRequests/cooperations`، `conversations/messages`،
`notifications`، `auditLogs`، `backgroundJobs/eventOutbox`. ستُوثَّق عند تنفيذها
مع خطة ترحيل قبل أي إعادة تسمية للمجموعات المستقرة.
