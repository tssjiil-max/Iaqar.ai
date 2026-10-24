# iAqar.ai — تقرير تدقيق المرحلة 0 (على الكود الحقيقي)

- التاريخ: 2026-10-24
- المستودع: `tssjiil-max/Iaqar.ai`
- فرع العمل: `audit/phase0-real-lineage-20261024`
- خط الأساس المدقَّق: `95a09934490a1ca62d9562ed34267804cfe7822c`. تحقّقت من أنه رأس `codex/unified-staging-lineage-2026-08-29` نفسه (0 commit فرقًا)، وأن فرع العمل متفرّع منه.
- النطاق: قراءة الكود، وتشغيل الاختبارات محليًا، وفحوص استكشافية محلية على المحاكي وعلى harness الاختبار. **لم يتغيّر أي سلوك.** لم يُنشر شيء، ولم تُقرأ قاعدة بيانات حقيقية، ولم تُرسل رسالة واتساب.
- يحلّ هذا التقرير محل `docs/ARCHITECTURE_AUDIT_AR.md` الموجود على فرع `plan/security-cleanup-v2`. ذلك التقرير حلّل كود `main` القديم (2026-08-07، والملف `worker/src/index.js` فيه نحو 2638 سطرًا)، لا كود فرع التكامل.
- المرجعية العليا لأي قرار: `docs/PROJECT_CONSTITUTION.md`، ثم `docs/DECISIONS.md`.

**وسوم الأدلة:**
- **[مثبت]**: مثبت بكود مُستشهَد به أو باختبار شُغّل.
- **[بيانات Staging]**: من تقرير أداة PR #258 المنشور على GitHub.
- **[فرضية]**: غير مثبتة.

---

## 1. خط الأساس — نتائج التشغيل الفعلية [مثبت]

البيئة: Node v22.22.0 وJava متوفّر. التثبيت عبر `npm ci` في الجذر وفي `worker/`.

| الأمر | النتيجة |
|---|---|
| `npm test` (`test:web` ثم `test:worker`) | **2352 / 2352 ناجح، 0 فشل**: 2182 اختبار ويب و170 اختبار Worker |
| `npm run check` | ناجح: `829 targets parsed (759 JS, 58 JSON, 16 HTML shells)` |
| `npm run test:rules` (محاكي Firestore) | **52 / 52 ناجح** |

**ملاحظة بيئية لا تخص الكود:** الاختبار `version.json is gitignored and generated from the current commit` في `test/staging-release-unification.test.mjs` يفشل إذا شُغّل من نسخة لا تحتوي `.git`، لأنه يستدعي `git rev-parse HEAD`. نجح عند التشغيل من نسخة Git حقيقية. أي بيئة CI يجب أن تعمل على checkout كامل.

---

## 2. خريطة البنية الفعلية [مثبت]

| الطبقة | الموقع | ملاحظات |
|---|---|---|
| Router الرئيسي | `worker/src/index.js` (8872 سطرًا) | نحو 90 مسارًا بصيغة `method + pathname`، إضافة إلى مسارات regex |
| Office OS API | `worker/src/office-os/routes.js` (نحو 100 مسار `/os/*`) | `PUBLIC_ROUTES`: محدودة المعدّل وبرموز token. `OFFICE_ROUTES`: كلها تمر عبر `resolveActor()` قبل الخدمة (`routes.js:271`) |
| وحدات الخادم | 66 ملفًا في `worker/src/` و39 ملفًا في `worker/src/office-os/` | منطق نطاقات نقي يُشارَك مع الواجهة من `public/os/domain/*` |
| الواجهة | `public/os/` (Office OS)، و`public/js/` (الواجهات القديمة) | تشترك على `offices/{officeId}/opportunities` و`inbox` (`public/os/core/live.js:34,78`) |
| القواعد | `firestore.rules` | انظر القسم 4 |
| البيئات | `worker/wrangler.toml` | ثلاث بيئات: production (`aqar-b5d76`)، و`env.staging` (`iaqar-intake-staging` على `iaqar-ai-staging`)، و`env.preview` |

---

## 3. رحلة رسالة واتساب: من Meta إلى لوحة المكتب

### 3.1 المسار كما هو في الكود [مثبت]

1. **`POST /meta/webhook`** (`index.js:580`) يستدعي `receiveMetaWebhook` (`index.js:2690`).
   - يتحقق من حجم الجسم (1 MiB)، ومن **HMAC** `x-hub-signature-256` على الجسم الأصلي بـ`META_APP_SECRET`.
   - يقبل `field` بقيمة `messages` أو `smb_message_echoes` فقط.
2. **تحديد المكتب:** يقرأ `whatsapp_accounts/{phone_number_id}`. **إذا لم يوجد المستند، أو لم تكن `status == "connected"`:**
   - يزيد العدّاد `unlinked`، ويسجّل `console.warn("[iaqar-whatsapp] unlinked phone number")`.
   - ثم **`continue`، فلا تُحفظ الرسالة في أي مكان**، ويُعاد `200 {ok:true, unlinked:N}` إلى Meta. Meta لا تعيد المحاولة بعد 200، **فالرسالة تضيع نهائيًا.**
3. **التفرّع إلى وكيل واتساب** (`index.js` مباشرة بعد التحقق من الربط). يُفعَّل فقط إذا تحققت كل الشروط:
   - `whatsappAgentAvailable(env)`، أي: `DEPLOYMENT_ENV=staging`، و`FIREBASE_PROJECT_ID=iaqar-ai-staging`، و`WHATSAPP_AGENT_ENABLED=enabled`.
   - وأن يكون `officeId` ضمن `WHATSAPP_AGENT_OFFICE_IDS`.

   عندها تُستدعى `ingestWhatsAppEvents` (`office-os/whatsapp-agent-service.js`)، وهي أيضًا تشترط الربط `connected` مع تطابق `wabaId`. القيمتان `WHATSAPP_AGENT_ENABLED` و`WHATSAPP_AGENT_OFFICE_IDS` غير موجودتين في `wrangler.toml`، فهما أسرار أو غير مضبوطتين.
4. **المسار التقليدي، لبقية المكاتب:** `saveInboundMessage`.
   - يُنشئ `offices/{officeId}/inbox/wa_<sha256(messageId)>` بعملية create-only، فتكرار `messageId` لا ينشئ سجلًا ثانيًا.
   - رسالة بلا نص (وسائط): تُحفظ بحالة `processingState=needs_media_adapter` للمراجعة، ولا تتحول إلى سجل.
   - `classifyInboundMessage` (`public/os/domain/message-class-domain.js`): التحية والسؤال والمتابعة تُحفظ بحالة `kept` وتنتظر الوسيط، ولا تصبح سجلًا.
   - غير ذلك يذهب إلى `processInboundMessage`، ثم `startCanonicalIntake` (`canonical-intake-service.js:196`). هذا يكتب `opportunitySources` و**`opportunities`** و`importJobs`، ثم يجري تحليلًا داخليًا إذا لم يُضبط `ACTIVEPIECES_WEBHOOK_URL`.
   - عند الفشل: يصبح `inbox.processingState=failed` مع `processingError`.
5. **الواجهة:** `watchRecords` يقرأ `opportunities` (حتى 500 سجل)، و`watchInbox` يقرأ `inbox`. كلاهما مسموح للأعضاء بالقراءة، والكتابة للـWorker فقط.

### 3.2 تجربة محلية شغّلتها [مثبت]
شغّلت فحصًا على harness المشروع (`scripts/qa/office-os/server.mjs`)، مع Firestore في الذاكرة، ورسالة موقّعة HMAC. كود الفحص في الملحق B، ولم يُضف إلى المستودع.

| السيناريو | النتيجة |
|---|---|
| رقم **مربوط**، والرسالة: «للبيع شقة في حي العزيزية… 3 غرف السعر 650 ألف…» | `200 {received:1, unlinked:0}`. في `inbox`: `processingState=processed` و`messageClass=OFFER` ومعه `opportunityId`. في `opportunities`: `kind=OFFER` و`purpose=SALE` و`district=العزيزية` و`analysisStatus=analysis_complete` و`internalStatus=NEEDS_DATA`. **ويظهر في قائمة السجلات الافتراضية**: `filterRecords(...).length = 1` |
| رقم **غير مربوط** | `200 {received:0, unlinked:1}`، و**لا يُحفظ أي شيء** |

**الخلاصة:** المسار التقليدي يعمل من الطرف إلى الطرف عندما يكون الرقم مربوطًا. لا يوجد محرك مطابقة ثانٍ، فالمسار يغذّي الإدخال الموحّد نفسه.

### 3.3 حالة Staging الفعلية [بيانات Staging]
المصدر: تقرير PR #258، الـrun رقم 39248231503 بتاريخ 2026-10-19، على المكتب `sultan` والرقم `356393440882303`:
- `whatsapp_accounts/356393440882303`: **غير موجود**.
- `offices/sultan/integrations/whatsapp`: **بلا `phoneNumberId`**، و`autoReplyEnabled` ليست `true`.
- أسرار Worker على Staging (فُحصت الأسماء فقط): `META_APP_SECRET` موجود، و`META_ACCESS_TOKEN` موجود، و`META_WHATSAPP_ACCESS_TOKEN` **غير موجود**.
- `wrangler.toml` في `env.staging` يضبط `META_PHONE_NUMBER_ID = "356393440882303"`، أي الرقم نفسه، و`META_APP_ID` و`META_CONFIG_ID`، و`ECONOMIC_TEST_MODE = "enabled"`.

### 3.4 الأسباب

| # | السبب | الدرجة |
|---|---|---|
| W1 | **الرقم غير مربوط بالمكتب** (`whatsapp_accounts` مفقود). الـWebhook يتجاهل كل رسائله، فلا يصل للوحة شيء | **مؤكد**: بالكود (3.1 بند 2)، وبالتجربة المحلية (3.2)، وبحالة Staging (3.3) |
| W2 | **الرسائل الواردة لرقم غير مربوط تضيع بصمت.** لا سجل دائم، ولا تنبيه للمنصة، والرد 200 يمنع إعادة المحاولة. هذا يجعل التشخيص صعبًا، ويخالف قاعدة «فشل التحليل يترك رسالة للمراجعة ولا يفقدها بصمت» في تكليف `plan/security-cleanup-v2` | **مؤكد بالكود**، وعيب تصميم |
| W3 | بعد الربط، التحيات والأسئلة تبقى `kept` في `inbox` ولا تصبح سجلات، وهذا سلوك مقصود. **تصحيح (2026-10-24، أثناء B-04):** كانت هذه الخانة تقول إن الوسائط بلا نص تبقى `needs_media_adapter`، وهذا **خطأ**. `extractMessageText()` يعيد النص البديل `[رسالة image]`، فلا يصل التنفيذ أبدًا إلى فرع `needs_media_adapter`. النتيجة أن الصورة أو الرسالة الصوتية بلا تعليق **تصبح سجلًا فارغًا بلا نوع** (`NEEDS_DATA`) يظهر في قائمة السجلات، ولا تُحفظ الوسائط نفسها. انظر B-07 | التحيات: **مؤكد**. الوسائط: **عيب مؤكد باختبار** (`test/whatsapp-legacy-intake-journey.test.mjs`) |
| W4 | على Production: القيمتان `META_APP_ID` و`META_CONFIG_ID` فارغتان في `[vars]`، فـ`completeEmbeddedSignup` يرفض (`index.js:2780`) ما لم تكونا مضبوطتين كأسرار | **فرضية** (لم تُفحص أسرار الإنتاج) |
| W5 | السر `META_WHATSAPP_ACCESS_TOKEN` غير موجود على Staging. يؤثر على **الرد** من وكيل واتساب، لا على الاستقبال | **مؤكد** (أسماء الأسرار)، وتأثيره على الاستقبال **فرضية: لا تأثير** |

---

## 4. الصلاحيات وعزل المكاتب

### 4.1 فحوص المحاكي التي شغّلتها [مثبت]
الفحوص على `firestore.rules` الحالي، مع إعادة بذر البيانات قبل كل اختبار. كودها في الملحق A، ولم يُضف إلى المستودع.

| # | السيناريو | النتيجة |
|---|---|---|
| C3 | مدير مكتب A يقرأ `offices/office-b/inbox/*` | **مرفوض ✔** |
| C4 | مدير مكتب A يضيف نفسه عضوًا في مكتب B | **مرفوض ✔** |
| C1 | وسيط (`broker`) يغيّر `offices/{id}.ownerUid` | **مرفوض ✔** |
| C2 | وسيط يرقّي نفسه إلى `owner` | **مرفوض ✔** |
| **P1** | مدير (`manager`) يغيّر `offices/{id}.ownerUid` إلى نفسه | **مسموح ✘** |
| **P2** | مدير يغيّر `subscriptionStatus` في وثيقة المكتب (من `expired` إلى `active`) | **مسموح ✘** |
| **P3** | مدير يرقّي وسيطًا إلى `role: "owner"` | **مسموح ✘** |
| **P4** | مدير يضيف uid من خارج المكتب بدور `admin` | **مسموح ✘** |
| **P5** | مدير يعطّل عضوية المالك (`active:false`) | **مسموح ✘** |

**العزل بين المكاتب سليم** في الحالات المفحوصة. **الثغرة داخل المكتب الواحد:**
- `match /offices/{officeId}` يسمح بـ`allow update: if canManage(officeId) && validOfficeProfile()`، و`validOfficeProfile()` لا يقيّد الحقول المتغيّرة (لا يوجد `affectedKeys().hasOnly`).
- `match /members/{uid}` يسمح بـ`allow write: if canManage(officeId)` دون أي قيد على الحقول.
- هذا يخالف `PROJECT_CONSTITUTION.md` §10: «Prevent … mass assignment of protected fields, and direct broker edits to ownership fields».
- **الأثر:**
  - مدير يستولي على ملكية المكتب، فـ`isOfficeOwner` يقرأ `ownerUid` من الوثيقة.
  - مدير يتحكم في حالة الاشتراك وتاريخ انتهائه. اليوم لا تُفرض الاشتراكات في أي مسار، فـ`subscriptionStatus` تُعرض فقط في `admin-domain.js`. **لكن أي فرض مستقبلي للاشتراكات سيكون قابلًا للتجاوز.**
  - مدير يمنح صلاحيات لأي حساب.
- **الخطورة:** عالية داخل المكتب. يحتاج المهاجم دور `manager` أولًا، والأثر لا يعبر إلى مكاتب أخرى.

### 4.2 نقاط دخول Worker
- المصادقة في المسارات المفحوصة: `authorizeOfficeRequest` (Firebase ID token ثم العضوية)، و`requirePlatformIdentity`، و`resolveActor` لكل مسارات `/os/*` المكتبية، وHMAC للـWebhook.
- مسارات بلا مصادقة عن قصد: `/health`، والإدخال العام (`/pipeline/public-intake`، وعليه محدّد معدّل `PUBLIC_RATE_LIMITS.PUBLIC_INTAKE`)، و`PUBLIC_ROUTES` في `/os/public/*` و`/os/reply/*` و`/os/session/*` (برموز token).
- مسارات بلا مصادقة تحتاج انتباهًا:

| المسار | الملاحظة | الخطورة |
|---|---|---|
| **`POST /auth/phone-login-resolve`** (`index.js:893`) | يعيد **البريد الحقيقي للحساب** و`officeId` لأي رقم جوال. **بلا مصادقة وبلا حد معدّل** (محدّد D-017 يغطي الإدخال العام والوسائط فقط). أسباب الرفض مختلفة (`directory_missing` مقابل `directory_inactive`)، فيمكن **تعداد الوسطاء** وكشف بريدهم. يخالف قرار «إخفاء جزء من البريد» في `CHANGELOG-PHONE-LOGIN-OPTIONAL-MEDIA-AR.txt`، و§10 من الدستور. المسار المجاور `/auth/phone-login` عليه قفل `loginRateLimits`، لكن `resolve` يتجاوزه | **متوسطة إلى عالية** [مثبت بالكود] |
| `GET /platform/pilot-status?officeId=` | يقرأ حالة التجربة لأي مكتب دون جلسة. مُعدّ عمدًا كـ«ملخص عام» | منخفضة [يُراجَع مضمونه] |
| `POST /matching/preview`، و`/workflow/readiness/preview`، و`/office/analytics/preview` | حساب نقي على بيانات يرسلها الطالب، بلا قراءة Firestore | منخفضة (تكلفة CPU فقط) |

- **محدّد المعدّل العام في الذاكرة لكل isolate** (`public-rate-limit.js`، D-017)، فلا يمنع الإساءة الموزّعة على عدة isolates. **[فرضية بحسب طبيعة Workers]**
- تغطية الأدوار داخل خدمات `/os/*`، أي فحوص `isManager` و`canActOn` لكل خدمة، **لم تُفحص خدمة بخدمة** في هذه المرحلة.

---

## 5. جرد العقل المركزي والوكلاء [مثبت بالملفات]

| الدور في التكليف | الموجود فعلًا | الحالة |
|---|---|---|
| المنسّق المركزي | `central-orchestrator-domain.js` و`central-orchestrator-service.js`. أحداث: `INTAKE_PERSISTED` و`SEARCH_REQUESTED` و`MATCH_CREATED` و`VIEWING_CONFIRMED` و`DEAL_CREATED` و`DEAL_STAGE_CHANGED` و`NOTIFICATION_REQUESTED`… مع مالك لكل حدث، و«AI: extraction-only» | قائم. **لا يُبنى منسّق آخر** |
| الإدخال الموحّد | `canonical-intake-domain.js` و`canonical-intake-service.js`، مع idempotency بالبصمة | قائم، وتمر به رسائل واتساب التقليدية |
| محرك المطابقة | `matching-engine.js` (نقي ومُرقّم بالإصدار)، و`matching-admission-domain.js`، و`match-integrity-domain.js`، و`match-event-service.js` | قائم، مع بوابة إصدار `test:matching:gate` |
| **وكيل المطابقة** | لا يوجد وكيل مستقل. المطابقة حتمية، وتُعرض للوسيط عبر Journey | **غير موجود كوكيل**، والمحرك موجود |
| **وكيل المعاينة** | `journey-service.js` (`confirmViewing` و`recordViewingResult`)، و`reservation-service.js`، و`iaqar-appointment`. `whatsapp-agent-service` يسجّل طلب المعاينة ولا يؤكدها | منطق المعاينة قائم، و**لا وكيل** |
| **وكيل التفاوض** | `session-service.js` (غرفة التفاوض بروابط لكل طرف)، و`proposal-service.js`، و`mandate-service.js` (حد المالك، للـWorker فقط)، واعتماد السعر `PRICE_APPROVAL` (PR #255) | منطق التفاوض المضبوط قائم، و**لا وكيل** |
| وكلاء AI قائمون | `office-os/agent-service.js` («مدير المكتب الذكي»: أدوات ثابتة، والنموذج يسمّي الأداة فقط، والموافقة لكل تغيير، وممنوع عليه المال والعقود والأسعار النهائية)، و`whatsapp-agent-service.js` (موظف واتساب، Staging فقط، مع بوابات fail-closed)، و`assist-service.js` (اقتراح مع رجوع حتمي)، و`scout-*` (الباحث عن الفرص) | قائمة على Staging |
| عقد الوكيل `{agentId, version, capabilities, allowedTools, officeScope, requiresApproval, enabled}` | لا يوجد سجل وكلاء موحّد بهذا الشكل. كل وكيل له مفاتيحه وبواباته | **غير موجود**، ومرشّح للمرحلة 2 |
| الاشتراكات | `admin-domain.js` (`resolveSubscriptionStatus`: trial/expired، وتاريخ الانتهاء)، و`admin-service.js` (`handleAdminSubscriptionUpdate` لمدير المنصة). الحقول في وثيقة `offices/{id}` | تُعرض ولا تُفرض. **وقابلة للتعديل من مدير المكتب (P2)** |
| PostgreSQL / RLS | لا يوجد في الكود | **غير موجود**. لا تُنقل ترحيلات PostgreSQL |

---

## 6. سجل المخاطر

| ID | الخطر | الخطورة | الدليل | الإجراء المقترح |
|---|---|---|---|---|
| R1 | مدير مكتب يستولي على الملكية، أو يغيّر الاشتراك، أو يمنح أدوارًا (P1–P5). **إضافة (2026-10-24):** أي عضو، حتى الوسيط، كان يرقّي نفسه إلى `owner` عبر القاعدة العامة إذا تضمّنت الوثيقة `officeId` | **حرجة** | 4.1، وD-020 | ✅ **أُغلق في B-01 (D-020)** |
| R2 | `/auth/phone-login-resolve` يكشف البريد و`officeId` ويسمح بالتعداد دون حد. **إضافة (2026-10-24):** `/auth/phone-login` كان يقبل مفتاح مشروع Firebase آخر ويصدر جلسة حقيقية، أي مسار استيلاء على الحساب | **حرجة** | 4.2، وD-021 | ✅ **أُغلق في B-02 (D-021)**، والمخاطر المتبقية في D-021 |
| R3 | ضياع رسائل واتساب الواردة لرقم غير مربوط بصمت | متوسطة (تشغيلية) | 3.4 W2 | Backlog B-03 |
| R4 | الرقم `356393440882303` غير مربوط بمكتب `sultan` على Staging | سبب العطل المبلّغ عنه | 3.3 | إجراء يدوي من المالك (Backlog M-01) |
| R5 | محدّد المعدّل لكل isolate | منخفضة إلى متوسطة | 4.2 | لاحقًا |
| R6 | فحوص الأدوار داخل كل خدمة `/os/*` لم تُدقَّق | غير معروفة | 4.2 | Backlog B-06 |

## 7. حدود هذا التدقيق
- لم تُقرأ قاعدة بيانات Staging أو Production. بيانات Staging هنا منقولة من تقرير PR #258 المنشور فقط.
- التجارب محلية: محاكي Firestore وharness الاختبار. **لا تثبت أن Meta الحقيقي يرسل إلى الـWebhook.**
- لم يُفحص أي سر بقيمته. لم تُفحص أسرار Production حتى بالأسماء.
- لم تُراجع 9 PRs مفتوحة سطرًا بسطر: #258 و#256 و#246 و#245 و#241 و#240 و#242 و#234 و#229.

---

## ملحق A — فحص قواعد Firestore (للتكرار)
شغّله من جذر نسخة الفرع، بعد وضع الملف في `test/emulator/zz-phase0-probe.emulator.test.mjs`:

```bash
npx firebase emulators:exec --only firestore --project demo-iaqar-probe \
  "node --test --test-concurrency=1 test/emulator/zz-phase0-probe.emulator.test.mjs"
```

```js
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc } from "firebase/firestore";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let env;
test.before(async () => { env = await initializeTestEnvironment({ projectId: "demo-iaqar-probe", firestore: { rules: readFileSync(resolve(ROOT, "firestore.rules"), "utf8") } }); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "offices/office-a"), { officeId: "office-a", ownerUid: "owner-a", officeName: "office-a", officeNameKey: "officeakey", specialties: [], subscriptionStatus: "expired" });
    await setDoc(doc(db, "offices/office-a/members/owner-a"), { uid: "owner-a", role: "owner", active: true });
    await setDoc(doc(db, "offices/office-a/members/manager-a"), { uid: "manager-a", role: "manager", active: true });
    await setDoc(doc(db, "offices/office-a/members/broker-a"), { uid: "broker-a", role: "broker", active: true });
    await setDoc(doc(db, "offices/office-b"), { officeId: "office-b", ownerUid: "owner-b", officeName: "office-b", officeNameKey: "officebkey", specialties: [] });
    await setDoc(doc(db, "offices/office-b/inbox/m1"), { officeId: "office-b", messageText: "x" });
  });
});
test.after(async () => { await env?.cleanup(); });
const as = (uid) => env.authenticatedContext(uid).firestore();
// assertSucceeds below documents CURRENT behaviour (the gap). The fix flips P1–P5 to assertFails.
test("P1 manager sets office ownerUid to self", async () => { await assertSucceeds(updateDoc(doc(as("manager-a"), "offices/office-a"), { ownerUid: "manager-a" })); });
test("P2 manager flips subscriptionStatus on office doc", async () => { await assertSucceeds(updateDoc(doc(as("manager-a"), "offices/office-a"), { subscriptionStatus: "active" })); });
test("P3 manager promotes broker to owner role", async () => { await assertSucceeds(updateDoc(doc(as("manager-a"), "offices/office-a/members/broker-a"), { role: "owner" })); });
test("P4 manager adds outside uid as admin", async () => { await assertSucceeds(setDoc(doc(as("manager-a"), "offices/office-a/members/outsider"), { uid: "outsider", role: "admin", active: true })); });
test("P5 manager deactivates owner's member doc", async () => { await assertSucceeds(updateDoc(doc(as("manager-a"), "offices/office-a/members/owner-a"), { active: false })); });
test("C1 broker cannot set ownerUid", async () => { await assertFails(updateDoc(doc(as("broker-a"), "offices/office-a"), { ownerUid: "broker-a" })); });
test("C2 broker cannot promote self", async () => { await assertFails(updateDoc(doc(as("broker-a"), "offices/office-a/members/broker-a"), { role: "owner" })); });
test("C3 office-a manager cannot read office-b inbox", async () => { await assertFails(getDoc(doc(as("manager-a"), "offices/office-b/inbox/m1"))); });
test("C4 office-a manager cannot add self to office-b", async () => { await assertFails(setDoc(doc(as("manager-a"), "offices/office-b/members/manager-a"), { uid: "manager-a", role: "owner", active: true })); });
```

النتيجة المسجّلة: 9 من 9 كما في الجدول 4.1، أي أن P1–P5 تنجح، وهي الثغرة.

## ملحق B — فحص مسار واتساب (للتكرار)
ضع الملف في `test/zz-phase0-wa-probe.test.mjs`، ثم شغّل `node --test test/zz-phase0-wa-probe.test.mjs`:

```js
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { startOfficeOsHarness } from '../scripts/qa/office-os/server.mjs';
import { kindOf, filterRecords } from '../public/os/domain/records-domain.js';
const h = await startOfficeOsHarness(); test.after(() => h.server.close());
Object.assign(h.env, { META_APP_SECRET: 'probe-secret', META_WEBHOOK_VERIFY_TOKEN: 'v' });
const send = (phoneId, waba, id, text) => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: waba, changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneId }, contacts: [{ wa_id: '966500000009', profile: { name: 'سالم أحمد' } }], messages: [{ id, from: '966500000009', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] });
  return h.worker.fetch(new Request('https://worker.test/meta/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', 'probe-secret').update(body).digest('hex') }, body }), h.env, { waitUntil() {} });
};
test('linked number: offer -> inbox -> opportunity -> visible record', async () => {
  h.store.seed('whatsapp_accounts/probe-phone', { officeId: 'office-probe', wabaId: 'probe-waba', status: 'connected' });
  const r = await send('probe-phone', 'probe-waba', 'probe-1', 'للبيع شقة في حي العزيزية بالمدينة المنورة 3 غرف السعر 650 ألف للتواصل 0500000009');
  console.log('status', r.status, JSON.stringify(await r.json()));
  console.log('inbox', JSON.stringify(h.store.list('offices/office-probe/inbox')));
  const opps = h.store.list('offices/office-probe/opportunities');
  console.log('kinds', opps.map(kindOf), 'visible', filterRecords(opps).length);
});
test('unlinked number: acknowledged, stored nowhere', async () => {
  const r = await send('unknown-phone', 'x-waba', 'probe-2', 'أبحث عن شقة للإيجار في قباء');
  console.log('status', r.status, JSON.stringify(await r.json()));
});
```

النتيجة المسجّلة:
- المربوط: `{"received":1,"unlinked":0}`، والسجل `OFFER` ظاهر (`visible 1`).
- غير المربوط: `{"received":0,"unlinked":1}`.
