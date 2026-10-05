/**
 * «تصنيف الرسائل الواردة» — what kind of message arrived on a channel:
 *
 *   SOCIAL   تحية أو شكر أو مجاملة            → تبقى في مركز التواصل، لا تتحول إلى سجل
 *   INQUIRY  سؤال قصير بلا تفاصيل عقار         → تبقى للوسيط ليرد عليها
 *   DEAL     متابعة صفقة قائمة (موعد، عربون…)  → تبقى للوسيط ليربطها بصفقتها
 *   OFFER    عرض عقار                          → يُعالج كعرض
 *   REQUEST  طلب عقار                          → يُعالج كطلب
 *   UNKNOWN  غير واضح                          → يُعالج بالمسار المعتاد (لا يُهمل)
 *
 * The rule is deliberately conservative: a message is kept out of the records only when it is
 * clearly not a property offer or request. Nothing is ever dropped — every message stays in
 * the office inbox with its class, and the broker can turn a kept message into a record.
 * Pure rules shared by the Worker (inbound channels) and «مركز التواصل».
 */

export const MESSAGE_CLASS = Object.freeze({
  SOCIAL: "SOCIAL", INQUIRY: "INQUIRY", DEAL: "DEAL", OFFER: "OFFER", REQUEST: "REQUEST", UNKNOWN: "UNKNOWN"
});

export const MESSAGE_CLASS_LABEL = Object.freeze({
  SOCIAL: "اجتماعية", INQUIRY: "استفسار", DEAL: "متعلقة بصفقة", OFFER: "عرض", REQUEST: "طلب", UNKNOWN: "غير مصنّفة"
});

export const MESSAGE_CLASS_ORDER = Object.freeze(["OFFER", "REQUEST", "INQUIRY", "DEAL", "SOCIAL", "UNKNOWN"]);

/** Classes that are processed into a record automatically. The rest wait for the broker. */
export function autoConverts(messageClass) {
  return messageClass === MESSAGE_CLASS.OFFER || messageClass === MESSAGE_CLASS.REQUEST || messageClass === MESSAGE_CLASS.UNKNOWN;
}

function normalize(value) {
  return String(value || "").toLowerCase()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ").trim();
}

// Anything that names a property, a purpose, a place or a specification is treated as possible
// record material: such a message is never kept out of processing.
const PROPERTY = /(شقه|شقق|فيلا|فله|فلل|ارض|اراضي|عماره|عمائر|دور|ادوار|دبلكس|دوبلكس|استوديو|استديو|ستوديو|غرفه|غرف|محل|محلات|معرض|مكتب|مكاتب|مستودع|هنجر|ورشه|استراحه|مزرعه|شاليه|بيت|منزل|عقار|قصر|برج|مخطط|قطعه|روف|ملحق|بنايه|مبني|فندق|كراج|مجمع|سكن|صاله)/;
const WANTS = /( مطلوب| ابغي | ابغا | ابي | احتاج | محتاج| ودي | نبي | نبغي | يبي | يبغي | تبي | ابحث | يبحث | نبحث | ادور | ارغب | نرغب | للشراء | استئجار | مشتري | مستاجر )/;
const HAS = /( معروض| عندي | عندنا | لدينا | لدي | يوجد | اعرض | نعرض )/;
const AVAILABLE = /(متوفر|متاح|موجود)/;
const PURPOSE_WORD = /(للبيع|للايجار|للتاجير|للتقبيل|للتنازل|للاستثمار|ايجار|تمليك|بيع)/;
const DETAIL = /( حي | بحي | الحي |شارع|مخطط|شمال|جنوب|شرق|غرب|غرفتين|صاله|متر|مساحه|مفروش|عوائل|عزاب|واجهه|مؤثث|سنوي|شهري|نقدا|كاش|بنك|تمويل|الف|مليون|ريال)/;
const DEAL_CUE = /(المعاينه|معاينه|موعد|العربون|عربون|العقد|الصك|الافراغ|افراغ|الدفعه|التحويل|التوقيع|المفتاح|المفاتيح|الاستلام|التسليم|السعي|العموله)/;
const QUESTION_CUE = /(\?|؟|^هل |^كم |^وين |^اين |^متي |^كيف |^ممكن |^لو سمحت)/;
const SOCIAL_WORDS = [
  "السلام عليكم ورحمه الله وبركاته", "السلام عليكم ورحمه الله", "السلام عليكم", "وعليكم السلام", "سلام عليكم", "سلام",
  "صباح الخير", "صباح النور", "مساء الخير", "مساء النور", "مرحبا", "اهلا وسهلا", "اهلا", "هلا والله", "هلا", "حياك الله", "حياكم الله",
  "شكرا جزيلا", "شكرا لك", "شكرا", "مشكور", "يعطيك العافيه", "الله يعطيك العافيه", "جزاك الله خير", "بارك الله فيك", "الله يوفقك", "بالتوفيق",
  "تمام", "طيب", "اوكي", "ok", "okay", "ان شاء الله", "ابشر", "تسلم", "الله يسلمك", "كيف الحال", "كيف حالك", "اخبارك", "الحمد لله", "بخير",
  "جمعه مباركه", "عيد مبارك", "كل عام وانتم بخير", "رمضان كريم", "مع السلامه", "في امان الله", "hi", "hello", "thanks", "thank you"
].sort((a, b) => b.length - a.length);

/** A greeting/thanks, alone or followed only by a short address («يا أبو محمد»). */
function onlySocial(text) {
  let rest = ` ${text.replace(/[.,،!؛:()"'~\-_*]/g, " ").replace(/\p{Extended_Pictographic}/gu, " ").replace(/\s+/g, " ").trim()} `;
  if (!rest.trim()) return true;
  let found = false;
  for (const word of SOCIAL_WORDS) {
    const parts = rest.split(` ${word} `);
    if (parts.length > 1) { found = true; rest = parts.join("  "); }
  }
  const left = rest.trim().split(/\s+/).filter(Boolean);
  if (!found || /\d/.test(rest)) return false;
  return left.length === 0 || (left[0] === "يا" && left.length <= 4);
}

/**
 * Classify one inbound text. Returns { messageClass, label, reason, autoConvert }.
 * `reason` is a short Arabic explanation shown to the broker.
 */
export function classifyInboundMessage(input) {
  const text = normalize(input);
  const done = (messageClass, reason) => ({ messageClass, label: MESSAGE_CLASS_LABEL[messageClass], reason, autoConvert: autoConverts(messageClass) });
  if (!text) return done(MESSAGE_CLASS.UNKNOWN, "رسالة بلا نص");
  const padded = ` ${text.replace(/[.,،!؛:()"'~\-_*؟?]/g, " ").replace(/\s+/g, " ").trim()} `;
  const property = PROPERTY.test(text);
  const wants = WANTS.test(padded);
  const question = QUESTION_CUE.test(text);
  const has = HAS.test(padded) || (AVAILABLE.test(text) && !question);
  const purpose = PURPOSE_WORD.test(text);
  const detail = DETAIL.test(padded) || /\d{3,}/.test(text);
  const short = text.length <= 90;
  // «material» = anything a record could be built from. Such a message is always processed.
  const material = wants || has || purpose || detail;

  if (!property && !material && !DEAL_CUE.test(text) && !question && text.length <= 120 && onlySocial(text)) return done(MESSAGE_CLASS.SOCIAL, "تحية أو شكر بلا تفاصيل عقار");
  // A short question with nothing to build a record from («هل الشقة متوفرة؟» · «كم السعر؟»).
  if (question && short && !material) return done(MESSAGE_CLASS.INQUIRY, "سؤال قصير بلا تفاصيل كافية لإنشاء سجل");
  // A step in a running deal, with no property described at all.
  if (DEAL_CUE.test(text) && short && !property && !material) return done(MESSAGE_CLASS.DEAL, "تتحدث عن خطوة في صفقة قائمة");
  if (property && wants && !has) return done(MESSAGE_CLASS.REQUEST, "تذكر نوع عقار مع صيغة طلب");
  // «للبيع / للإيجار» alone reads as an offer unless the sender is asking a question.
  if (property && !wants && (has || (purpose && !question))) return done(MESSAGE_CLASS.OFFER, "تذكر نوع عقار مع صيغة عرض");
  return done(MESSAGE_CLASS.UNKNOWN, "لم يتضح نوعها — تُعالج بالمسار المعتاد");
}

/** Inbox state as the broker reads it. */
export const INBOX_STATE_LABEL = Object.freeze({
  received: "وصلت", processing: "قيد المعالجة", processed: "عولجت", kept: "محفوظة للمتابعة", ignored: "غير مدعومة",
  pending_review: "تحتاج مراجعة", needs_media_adapter: "وسائط تحتاج مراجعة", failed: "تعذرت المعالجة"
});

const CHANNEL_LABEL = Object.freeze({ whatsapp: "واتساب", telegram: "تيليجرام", web: "الموقع" });

function channelOf(item = {}) {
  const raw = String(item.channel || item.sourceChannel || item.source || "").toLowerCase();
  return raw.includes("telegram") ? "telegram" : raw.includes("whatsapp") || raw.includes("macrodroid") ? "whatsapp" : "web";
}

function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 7 ? `••••${digits.slice(-4)}` : "";
}

/** One inbox document → the card shown in «مركز التواصل». Classifies on the fly when the server did not. */
export function inboxItemView(item = {}) {
  const text = String(item.messageText || "").trim();
  const saved = String(item.messageClass || "").toUpperCase();
  const messageClass = MESSAGE_CLASS[saved] ? saved : classifyInboundMessage(text).messageClass;
  const stateRaw = String(item.processingState || item.status || "received").toLowerCase();
  const state = INBOX_STATE_LABEL[stateRaw] ? stateRaw : "received";
  const channel = channelOf(item);
  const recordId = String(item.opportunityId || "");
  return {
    id: String(item.id || ""),
    channel, channelLabel: CHANNEL_LABEL[channel],
    messageClass, classLabel: MESSAGE_CLASS_LABEL[messageClass],
    reason: String(item.messageClassReason || ""),
    state, stateLabel: INBOX_STATE_LABEL[state],
    text: text.slice(0, 600),
    hasText: Boolean(text),
    sender: String(item.senderName || "").slice(0, 60) || maskPhone(item.senderPhone) || "مرسل غير معروف",
    receivedAt: item.receivedAt || item.createdAt || null,
    recordId,
    // A kept message (or one whose processing failed) can be turned into a record by the broker.
    canConvert: Boolean(text) && !recordId && (state === "kept" || state === "failed" || state === "pending_review"),
    kept: state === "kept"
  };
}

export function countByClass(views = []) {
  const counts = Object.fromEntries(MESSAGE_CLASS_ORDER.map((key) => [key, 0]));
  for (const view of views) counts[view.messageClass] = (counts[view.messageClass] || 0) + 1;
  return counts;
}

export function filterInbox(views = [], messageClass = "ALL") {
  return messageClass === "ALL" ? views : views.filter((view) => view.messageClass === messageClass);
}
