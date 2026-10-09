/**
 * «مركز التواصل والدعم» — platform support through a Telegram Business account.
 * Pure rules shared by the office screen and the Worker. This is the PLATFORM's support line
 * (questions about using iAqar); it never touches an office's clients, owners, deals or the
 * central intake bot. The assistant answers only the topics written below; anything else, or
 * anything the customer asks a person for, goes to the support manager — and while he is in the
 * chat the assistant stays silent until he hands it back.
 */

export const SUPPORT_INTENT = Object.freeze({
  GREETING: "GREETING",
  HUMAN: "HUMAN",
  PROBLEM: "PROBLEM",
  FAQ: "FAQ",
  UNKNOWN: "UNKNOWN"
});

export const SUPPORT_MODE = Object.freeze({ BOT: "BOT", HUMAN: "HUMAN" });

export const TICKET_KIND = Object.freeze({ QUESTION: "QUESTION", REPORT: "REPORT" });
export const TICKET_KIND_LABEL = Object.freeze({ QUESTION: "استفسار", REPORT: "بلاغ" });

const normalize = (value) => String(value || "")
  .replace(/[ً-ْـ]/g, "")       // tashkeel + tatweel
  .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
  .toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The only questions the assistant answers by itself. Every answer describes a screen that
 * exists in the office app today; nothing about prices, contracts or law is answered here.
 */
export const SUPPORT_FAQ = Object.freeze([
  { id: "add_record", words: ["اضافه عرض", "اضافه طلب", "اضيف عرض", "اضيف طلب", "عرض جديد", "طلب جديد", "اضافه عقار", "اضيف عقار", "سجل جديد"],
    answer: "لإضافة عرض أو طلب: افتح «العروض والطلبات» ثم اضغط «إضافة سجل جديد» واختر «إضافة عرض» أو «إضافة طلب»." },
  { id: "whatsapp_link", words: ["ربط واتساب", "اربط واتساب", "واتساب الاعمال", "واتساب بزنس", "cloud api"],
    answer: "لربط واتساب للأعمال: الإعدادات ← قنوات المكتب ← «ربط واتساب للأعمال». الربط يكون بنظام التعايش، فيبقى رقمك يعمل على تطبيق واتساب للأعمال في جوالك. يحتاجه مدير المكتب فقط." },
  { id: "telegram_link", words: ["ربط تيليجرام", "ربط تليجرام", "اربط تيليجرام", "اربط تليجرام", "بوت المكتب"],
    answer: "لربط تيليجرام: الإعدادات ← قنوات المكتب ← تيليجرام، ثم افتح الرابط الذي يظهر لك واضغط «ابدأ» في تيليجرام." },
  { id: "matching", words: ["المطابقه", "مطابقه", "تطابق"],
    answer: "تظهر المطابقات بين العروض والطلبات في «المهام اليومية» لتراجعها وتقرر قبل أي تواصل مع الطرفين." },
  { id: "daily_tasks", words: ["المهام اليوميه", "المهام", "مهمه"],
    answer: "«المهام اليومية» فيها كل ما ينتظر قرارك: مراجعة مطابقة، متابعة صفقة، معاينة أو مستندات. اضغط أي بطاقة لفتح خطوتها." },
  { id: "office_link", words: ["رابط المكتب", "صفحه المكتب", "رابط مكتبي", "صفحه مكتبي"],
    answer: "رابط مكتبك العام من: الإعدادات ← رابط المكتب. يمكنك نسخه أو مشاركته، ومن خلاله يصلك العملاء بعروضهم وطلباتهم." }
]);

const HUMAN_WORDS = ["مسؤول", "مسوول", "موظف", "شخص", "انسان", "بشري", "خدمه العملاء", "اكلم احد", "ابي اكلم", "ابغى اكلم", "تواصل معي", "اتصل بي", "الدعم الفني"];
const PROBLEM_WORDS = ["مشكله", "خطا", "خلل", "عطل", "ما يشتغل", "لا يعمل", "ما يفتح", "لا يفتح", "تعذر", "ما زبط", "مو شغال", "معلق", "توقف", "نسيت", "ما اقدر ادخل", "لا استطيع الدخول", "بلاغ"];
const GREETING_WORDS = ["السلام عليكم", "السلام", "مرحبا", "اهلا", "هلا", "صباح الخير", "مساء الخير", "hi", "hello"];

const includesAny = (text, words) => words.some((word) => text.includes(normalize(word)));

/** What a customer's message asks for. Asking for a person always wins. */
export function classifySupportMessage(raw) {
  const text = normalize(raw);
  if (!text) return { intent: SUPPORT_INTENT.UNKNOWN };
  if (includesAny(text, HUMAN_WORDS)) return { intent: SUPPORT_INTENT.HUMAN };
  if (includesAny(text, PROBLEM_WORDS)) return { intent: SUPPORT_INTENT.PROBLEM, detailed: text.length >= 40 };
  const faq = SUPPORT_FAQ.find((item) => includesAny(text, item.words));
  if (faq) return { intent: SUPPORT_INTENT.FAQ, faqId: faq.id };
  if (includesAny(text, GREETING_WORDS) && text.length <= 40) return { intent: SUPPORT_INTENT.GREETING };
  return { intent: SUPPORT_INTENT.UNKNOWN };
}

export const SUPPORT_TEXT = Object.freeze({
  welcome: "أهلًا بك في دعم iAqar. أستطيع مساعدتك في: إضافة عرض أو طلب، ربط واتساب أو تيليجرام، المطابقة، المهام اليومية، ورابط المكتب.\nاكتب سؤالك، أو اكتب «مسؤول» للتحدث مع شخص.",
  askDetails: "نأسف لذلك. صف المشكلة باختصار: ماذا كنت تفعل، وما الرسالة التي ظهرت لك؟ سنسجلها بلاغًا ويتابعها المسؤول.",
  ticketSaved: (ref) => `سجّلنا بلاغك (رقم ${ref}) وسيتابعه المسؤول قريبًا.`,
  handedOver: "تم تحويل محادثتك إلى المسؤول، وسيرد عليك قريبًا في هذه المحادثة.",
  unknownOnce: "لم أفهم طلبك تمامًا. اكتب سؤالك بكلمات أخرى، أو اكتب «مسؤول» للتحدث مع شخص.",
  ownerAlertTitle: "تحويل للمسؤول — دعم iAqar",
  ownerResumeButton: "إعادة الرد الآلي",
  ownerResumed: "عاد الرد الآلي لهذه المحادثة.",
  connected: "تم ربط مساعد الدعم بحساب الأعمال. سيرد على الأسئلة المدعومة ويحوّل لك ما يحتاجك. عند ردّك بنفسك يتوقف المساعد في تلك المحادثة حتى تعيده.",
  disconnected: "تم فصل مساعد الدعم عن حساب الأعمال؛ لن يرد على أي محادثة."
});

/**
 * One step of the assistant for one incoming customer message.
 *   chat = { mode, unknownCount, awaitingDetails }
 * Returns { reply, mode, unknownCount, awaitingDetails, ticket: null | { kind, needsAdmin }, alertOwner }
 * A chat in HUMAN mode gets nothing: the support manager is answering it.
 */
export function planSupportReply(text, chat = {}) {
  const base = { mode: chat.mode === SUPPORT_MODE.HUMAN ? SUPPORT_MODE.HUMAN : SUPPORT_MODE.BOT, unknownCount: Number(chat.unknownCount || 0), awaitingDetails: chat.awaitingDetails === true };
  if (base.mode === SUPPORT_MODE.HUMAN) return { ...base, reply: "", ticket: null, alertOwner: false, silent: true };
  const { intent, faqId, detailed } = classifySupportMessage(text);
  const handOver = (ticketKind = TICKET_KIND.QUESTION) => ({ mode: SUPPORT_MODE.HUMAN, unknownCount: 0, awaitingDetails: false, reply: SUPPORT_TEXT.handedOver, ticket: { kind: ticketKind, needsAdmin: true }, alertOwner: true });
  if (intent === SUPPORT_INTENT.HUMAN) return handOver(base.awaitingDetails ? TICKET_KIND.REPORT : TICKET_KIND.QUESTION);
  if (base.awaitingDetails) {
    // While waiting for details: a listed question is still answered, a greeting or an empty message asks again.
    // A short listed question (not a description that merely mentions a topic).
    if (intent === SUPPORT_INTENT.FAQ && String(text || "").trim().length < 40) {
      const faq = SUPPORT_FAQ.find((item) => item.id === faqId);
      return { ...base, awaitingDetails: false, unknownCount: 0, reply: faq.answer, ticket: null, alertOwner: false };
    }
    if (intent === SUPPORT_INTENT.GREETING || String(text || "").trim().length < 5) return { ...base, reply: SUPPORT_TEXT.askDetails, ticket: null, alertOwner: false };
  }
  // A description after we asked for one — or a detailed problem straight away — becomes a ticket.
  if (base.awaitingDetails || (intent === SUPPORT_INTENT.PROBLEM && detailed)) {
    return { mode: SUPPORT_MODE.HUMAN, unknownCount: 0, awaitingDetails: false, reply: "", ticket: { kind: TICKET_KIND.REPORT, needsAdmin: true }, alertOwner: true, replyIsTicket: true };
  }
  if (intent === SUPPORT_INTENT.PROBLEM) return { ...base, awaitingDetails: true, reply: SUPPORT_TEXT.askDetails, ticket: null, alertOwner: false };
  if (intent === SUPPORT_INTENT.FAQ) {
    const faq = SUPPORT_FAQ.find((item) => item.id === faqId);
    return { ...base, unknownCount: 0, reply: faq.answer, ticket: null, alertOwner: false };
  }
  if (intent === SUPPORT_INTENT.GREETING) return { ...base, reply: SUPPORT_TEXT.welcome, ticket: null, alertOwner: false };
  // Not understood twice in a row → a person takes over instead of looping.
  if (base.unknownCount >= 1) return handOver(TICKET_KIND.QUESTION);
  return { ...base, unknownCount: base.unknownCount + 1, reply: SUPPORT_TEXT.unknownOnce, ticket: null, alertOwner: false };
}

/** A ticket typed in the office app: kind, text 5–1000 characters, and whether the manager is needed. */
export function validateOfficeTicket(input = {}) {
  const kind = String(input.kind || "").toUpperCase() === TICKET_KIND.REPORT ? TICKET_KIND.REPORT : TICKET_KIND.QUESTION;
  const text = String(input.text || "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (text.length < 5) return { ok: false, error: "اكتب تفاصيل أوضح (5 أحرف على الأقل)." };
  return { ok: true, kind, text, needsAdmin: input.needsAdmin === true };
}

/** Telegram public username of the support business account (changeable later from the environment). */
export function supportUsername(value) {
  const name = String(value || "").trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "");
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name) ? name : "";
}

/**
 * What the office card may show — only what is real:
 *   channels: the office's own linked channels (from «قنوات المكتب»), connected ones only;
 *   telegramBusiness: the platform support account when one is configured;
 *   assistant: «دعم ذكي مع تحويل للمسؤول» only while the assistant is connected to that account.
 */
export function supportCardView({ channels = [], support = {} } = {}) {
  const connected = (Array.isArray(channels) ? channels : []).filter((channel) => String(channel?.state || "").toUpperCase() === "CONNECTED")
    .map((channel) => ({ id: channel.id === "telegram" ? "telegram" : "whatsapp", label: channel.id === "telegram" ? "Telegram" : "WhatsApp" }));
  const username = supportUsername(support?.telegramBusiness?.username);
  return {
    channels: connected,
    telegramBusiness: username ? { label: "Telegram Business", url: `https://t.me/${username}` } : null,
    assistantActive: Boolean(username) && support?.assistant?.active === true,
    canReport: support?.ticketsEnabled !== false
  };
}
