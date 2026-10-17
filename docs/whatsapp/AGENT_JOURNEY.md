# الموظف العقاري عبر واتساب — رحلة العميل (Staging)

## مسار الرسالة

```
العميل (واتساب)
  → Meta Cloud API → POST /meta/webhook  (توقيع X-Hub-Signature-256 بـ META_APP_SECRET)
  → whatsapp_accounts/{phoneNumberId}  (المكتب يُحدد من الرقم فقط، لا من النص)
  → offices/{office}/inbox/wa_*  (حفظ مرة واحدة لكل message.id) + serviceQueues/whatsapp/jobs
  → drainWhatsAppQueue (waitUntil بعد الـ Webhook + Cron كل 5 دقائق)
  → فهم محلي حتمي (بدون نموذج مدفوع) → حفظ الطلب في CRM المكتب (saveRecord)
  → guestSearch (العروض المنشورة والحية فقط) → إعادة التحقق من كل عرض قبل عرضه
  → رسائل نصية/أزرار/قوائم/صور → Graph API (فقط للأرقام المسموحة وداخل نافذة 24 ساعة)
```

ردود **Meta Business Agent** داخل تطبيق واتساب بزنس لا تمر بهذا المسار ولا تقرأ قاعدة iAqar. لهذا لا تصل عروض قاعدة البيانات إلى المحادثة الحالية.

## المراحل

| المرحلة | ما يفعله الموظف الآلي | ما يبقى قرارًا بشريًا |
|---|---|---|
| الاستقبال | يفهم النوع والحي والميزانية، ويسأل عن الناقص سؤالًا واحدًا في كل مرة | — |
| الموافقة | لا يحفظ ولا يبحث قبل «موافق» | — |
| البحث | أفضل 3 من العروض المنشورة، مع أسباب المطابقة والاختلاف، ثم «عرض بدائل» | النشر (`publicSearchVisible`) |
| التفاصيل والصور | من سجل العقار، والصور التي تخص السجل نفسه فقط | — |
| الاهتمام | يسجّل اهتمامًا وعميلًا محتملًا، ويرسل المطابقة لمراجعة المكتب | اعتماد المطابقة |
| التفاوض | يسجّل عرض العميل ويبلغ المكتب. حد المالك (`negotiationFloor`) لا يظهر للعميل | رد المالك (`negotiation_answer` + مصدر الموافقة) |
| المعاينة | يسجّل الوقت المفضل كطلب، ولا يقول «تم الحجز» | التأكيد (`viewing_confirm`، منسق مع المالك، مع منع التعارض) |
| التذكير والمتابعة | تذكير قبل الموعد، وسؤال المتابعة بعده، كل منهما مرة واحدة | — |
| الاتفاق والإغلاق | يبلغ العميل بما سجله المكتب | `agreement`، ثم `close_won` (موافقة المالك، توقيع العقد، دفع عبر القناة النظامية) |

## واجهات المكتب

- `POST /os/whatsapp-agent/cases`: حالات المكتب. الوسيط يرى حالاته فقط، والمدير يرى الكل.
- `POST /os/whatsapp-agent/case/action`: الحقول `{ caseId, action, input, requestKey }`.
  - قيم `action`: `negotiation_answer` · `viewing_confirm` · `viewing_cancel` · `viewing_result` · `agreement` · `close_won` · `close_lost` · `resume_agent`.
  - تكرار الطلب بنفس `requestKey` لا يغيّر شيئًا ولا يرسل شيئًا.
  - خارج نافذة 24 ساعة تكون الحالة `TEMPLATE_REQUIRED`، ولا يُرسل شيء.

## متغيرات Staging

| المتغير | القيمة للاختبار |
|---|---|
| `WHATSAPP_AGENT_ENABLED` | `enabled` |
| `WHATSAPP_AGENT_OFFICE_IDS` | معرف مكتب الاختبار |
| `WHATSAPP_AGENT_ALLOWED_RECIPIENTS` | أرقام الاختبار فقط |
| `WHATSAPP_AGENT_SEND` | `disabled`: محاكاة، لا يُرسل شيء. `enabled`: إرسال فعلي لقائمة السماح |
| `ECONOMIC_TEST_MODE` | `enabled`: لا شبكة ولا إرسال |
| `WHATSAPP_AGENT_CLASSIFIER` | اتركه فارغًا. Claude لا يُستدعى إلا إذا كانت القيمة `claude` |
| `META_WHATSAPP_ACCESS_TOKEN`، `META_APP_SECRET` | Secrets عبر `wrangler secret put --env staging` |
| `WHATSAPP_MEDIA_ORIGIN` | رابط Worker العام بـ https لإرسال الصور (اختياري) |

## ربط رقم Meta التجريبي (بدون لمس رقم المكتب)

مستند `whatsapp_accounts/{phoneNumberId}` في `iaqar-ai-staging`:

```json
{ "officeId": "<office>", "wabaId": "<test WABA id>", "status": "connected",
  "platformType": "CLOUD_API", "metaPhoneStatus": "CONNECTED", "isTestNumber": true }
```

بعد إنشاء المستند:

1. فعّل الأتمتة للمكتب من `/os/whatsapp-agent/settings`.
2. سجّل الـ Webhook في Meta على رابط `/meta/webhook` الخاص بـ Staging.
3. اشترك في حقل `messages`.

## التكاليف

- لا اشتراك ذكاء اصطناعي.
- رسائل WhatsApp Cloud API تخضع لتسعير Meta، خصوصًا القوالب خارج نافذة 24 ساعة. تحقق من الأسعار الحالية قبل الإنتاج.
