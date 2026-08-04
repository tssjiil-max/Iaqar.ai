# IAQAR.AI — سير الأحداث

> يوثّق التدفق الحدثي **الحالي** المنفذ فعلًا، والتدفق المستهدف المعتمد.
> كل معالج يجب أن يكون: idempotent، آمنًا للإعادة، واعيًا بالمستأجر (officeId)،
> قابلًا للتدقيق، ويسجل حالة الفشل دون إفساد الفرصة.

## 1. التدفق الحالي (منفذ)

### أ. الاستقبال العام (رابط المكتب / المنصة)

```
نموذج عميل/مالك (access-gate.js / public-intake.js)
  → كتابة offices/{officeId}/publicIntake/{id} بحالة status=new  (قواعد Firestore تتحقق)
  → رفع الوسائط (اختياري): POST /media/public-intake → R2
  → POST /pipeline/public-intake { officeId, intakeId }
      • يقرأ المستند، يطبّع الحقول، يكمل completeness
      • يبحث مرشحين من clients/owners المعاكسين ويرتبهم (rankMatchCandidates)
      • عند مطابقة ≥ العتبة: كتابة matches/{id} + تحديث intake=matched + إشعار FCM
      • بدون مطابقة: تحديث intake=processed (يبقى محفوظًا، بلا بند عمليات جديد)
```

### ب. مشاركة PWA / نص منسوخ (وسيط مسجل)

```
share-target.html → localStorage → workflow-office.js (submitPendingShare)
  → POST /pipeline/intake (Bearer ID Token + officeId)
      • parseRealEstateMessage: نوع الكيان، نوع العقار، الحي، السعر، المساحة،
        الغرف، الجوال، الجدية، الجاهزية التمويلية، المالك المباشر
      • كتابة clients/{id} أو owners/{id} + مطابقة + matches + FCM
```

### ج. واتساب الرسمي (استقبال فقط)

```
Meta Webhook → GET /meta/webhook (تحقق) / POST /meta/webhook
  → تحقق توقيع X-Hub-Signature-256 (HMAC-SHA256 بـ META_APP_SECRET)
  → استخراج الرسائل النصية/التسميات التوضيحية → حفظ inbox + معالجة كمصدر
  → الإرسال الصادر: محظور برمجيًا (403 outbound_disabled)
```

### د. سير العمل التشغيلي

```
إجراء الوسيط في الواجهة → POST /workflow/action
  advance_match / add_match_followup / create_deal / set_deal_stage /
  close_match / mark_lost / complete_deal
  → تحديث matches/deals + timeline/{eventId} + إغلاق المطابقات الشقيقة عند النجاح
  → إشعار FCM للأجهزة المسجلة عند الأحداث المهمة
```

### هـ. الإشعارات (FCM)

```
تسجيل الجهاز: الواجهة → POST /fcm/register → offices/{officeId}/devices
إرسال: Worker → FCM HTTP v1 (fid أولًا ثم token) → رابط عميق /?officeId=..&openMatch=..
تنظيف: الرموز المنتهية (UNREGISTERED) تُعطل تلقائيًا
احترام التفضيلات: حقول notificationPrefs تُخزن في المرحلة 1؛ الربط الكامل
  بتوجيه الإشعارات مجدول للمرحلة 5 (موثق كفجوة معروفة).
```

## 2. التدفق المستهدف المعتمد (مراحل 2–7)

```
SOURCE_RECEIVED → SOURCE_STORED → ANALYSIS_REQUESTED → DATA_EXTRACTED
  → OPPORTUNITY_CREATED_OR_UPDATED → DATA_COMPLETENESS_EVALUATED
  → MATCHING_REQUESTED → MATCH_CREATED → OPERATION_CREATED
  → NOTIFICATION_CREATED → BROKER_ACTION → MESSAGE_DRAFT_CREATED
  → EXTERNAL_RESPONSE_RECEIVED → NEXT_OPERATION_CREATED → COMPLETED
```

مبادئ ملزمة عند التنفيذ:

- إعادة المطابقة تلقائية عند: عرض/طلب جديد، تقديم مالك/عميل، اكتمال بيانات،
  تحديث ذو صلة، فرصة خارجية جديدة، تحديث نطاق تعاون.
- هوية المطابقة الفريدة: الزوج الكنسي للفرص + إصدار قاعدة المطابقة + إصدار البيانات.
- بند العمليات لا يتكرر لنفس الحدث/المصدر (`deduplicationKey`).
- الإشعار يتبع تفضيلات المكتب/الوسيط ويرتبط بالعملية، ولا يكرر.
- فشل تكامل خارجي واحد لا يفسد الفرصة؛ يُسجل كحالة فشل قابلة لإعادة المحاولة.
- نمط outbox مدعوم بقاعدة البيانات مقبول ضمن المكدس الحالي؛ لا وسيط رسائل جديد
  دون موافقة موثقة.

## 3. منع التكرار (الحالي والمستهدف)

| الإشارة | الحالة |
|---|---|
| نفس `eventId` لرسالة مشاركة PWA | يُمرر إلى `/pipeline/intake` ويُستخدم كمفتاح idempotency |
| نفس رسالة واتساب (`message.id`) | يُخزن ويُتجاهل التكرار في معالج الـwebhook |
| نفس زوج المطابقة | منع جزئي اليوم (تحديث نفس matchId للمدخل)؛ الإحكام الكامل بالهوية الكنسية في المرحلة 4 |
| بند عمليات مكرر | المرحلة 5 (`deduplicationKey`) |
| اسم مكتب مكرر | `officeNameClaims` + معاملة ذرية (يعمل منذ ما قبل المرحلة 1) |
