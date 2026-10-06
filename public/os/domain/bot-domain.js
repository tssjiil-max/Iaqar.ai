/**
 * «بوت المكتب» على تيليجرام — the bot that talks to the two sides of a match for the office.
 *
 *   مطابقة جديدة → يُسأل العميل «هل العقار مناسب؟» → إن وافق يُسأل المالك
 *   → إن وافق الطرفان تُفتح الصفقة ويستلم كل طرف رابط صفحة التفاوض الخاصة به.
 *   The broker hears about it only when a side needs him.
 *
 * Telegram's own rule shapes all of it: the bot can write only to a person who pressed Start,
 * so a side takes part only after opening the office's bot link once. A side that is not
 * linked changes nothing — its match stays a review task for the broker, as before.
 *
 * Pure rules shared by the Worker and the screens. Nothing here sends anything.
 */

import { formatArea, formatPrice, whatsappDigits } from "./format-domain.js";

export const BOT_ROLE = Object.freeze({ CLIENT: "client", OWNER: "owner" });
export const BOT_ROLE_LABEL = Object.freeze({ client: "العميل", owner: "المالك" });

/** Sent only when the match is at least this strong, and at most this many questions a day per person. */
export const BOT_LIMITS = Object.freeze({ minScore: 70, dailyAsks: 3, partyLinkDays: 14, brokerLinkMinutes: 15 });

export const ASK_STATE = Object.freeze({
  CLIENT_ASKED: "CLIENT_ASKED",       // waiting for the client's answer
  OWNER_ASKED: "OWNER_ASKED",         // the client said yes; waiting for the owner
  OWNER_NOT_LINKED: "OWNER_NOT_LINKED", // the client said yes; the owner is not on the bot → the broker continues
  HANDED_TO_BROKER: "HANDED_TO_BROKER", // an answer arrived after the office switched its bot off → the broker continues
  OPENED: "OPENED",                   // both said yes → the deal is open
  CLIENT_NO: "CLIENT_NO",
  OWNER_NO: "OWNER_NO",
  CANCELLED: "CANCELLED",             // the broker decided the match himself, or it is no longer valid
  FAILED: "FAILED"                    // the question could not be delivered
});

export const ASK_STATE_LABEL = Object.freeze({
  CLIENT_ASKED: "البوت سأل العميل — بانتظار رده",
  OWNER_ASKED: "العميل وافق — البوت سأل المالك",
  OWNER_NOT_LINKED: "العميل وافق — المالك غير مرتبط بالبوت، تواصل معه",
  HANDED_TO_BROKER: "وصل رد عبر البوت بعد إيقافه — أكمل أنت",
  OPENED: "وافق الطرفان عبر البوت — فُتحت الصفقة",
  CLIENT_NO: "العميل: غير مناسب (عبر البوت)",
  OWNER_NO: "المالك: غير مناسب (عبر البوت)",
  CANCELLED: "توقف سؤال البوت",
  FAILED: "تعذر إيصال سؤال البوت"
});

const WAITING = Object.freeze({ [ASK_STATE.CLIENT_ASKED]: BOT_ROLE.CLIENT, [ASK_STATE.OWNER_ASKED]: BOT_ROLE.OWNER });

/** Which side the bot is waiting for ("" when none). */
export function awaitedRole(ask = {}) {
  return WAITING[String(ask.state || "")] || "";
}

/** The person behind a record, as the bot knows him: his Saudi mobile in international digits ("" when unusable). */
export function partyPhone(record = {}) {
  return whatsappDigits(record.contactPhone || record.advertiserPhoneNormalized || record.phone);
}

// ------------------------------------------------------------------ buttons

const CALLBACK = /^ask:([A-Za-z0-9_-]{16,40}):(y|n)$/;

/** Telegram allows 64 bytes of callback data: the question's token and the answer. */
export function callbackData(token, answer) {
  return `ask:${token}:${answer === "yes" ? "y" : "n"}`;
}

export function parseCallback(data) {
  const match = String(data || "").match(CALLBACK);
  return match ? { token: match[1], answer: match[2] === "y" ? "yes" : "no" } : null;
}

export function askButtons(token) {
  return [[{ text: "مناسب", callback_data: callbackData(token, "yes") }, { text: "غير مناسب", callback_data: callbackData(token, "no") }]];
}

// ------------------------------------------------------------------ what the bot says

const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function place(summary = {}) {
  const district = clip(summary.district, 60);
  return [clip(summary.city, 40), district ? (district.startsWith("حي") ? district : `حي ${district}`) : ""].filter(Boolean).join("، ");
}

function isRent(summary = {}) {
  return /LEASE|RENT/i.test(String(summary.purpose || ""));
}

/**
 * The question each side receives. A side never sees the other's name, number or exact address:
 * the client sees the property, the owner sees what the client is looking for.
 */
export function askMessage(role, { officeName = "", offer = {}, request = {} } = {}) {
  const office = clip(officeName, 60) || "المكتب";
  const rent = isRent(offer) || isRent(request);
  if (role === BOT_ROLE.OWNER) {
    const lines = [
      `${office}`,
      `لدينا عميل مهتم بعقارك (${[clip(offer.propertyType, 30) || "عقار", place(offer)].filter(Boolean).join(" — ")}).`,
      "",
      `• يبحث عن: ${rent ? "استئجار" : "شراء"} ${clip(request.propertyType, 30) || clip(offer.propertyType, 30) || "عقار"}`
    ];
    // The client's budget is his own card in the negotiation: the owner is never told it.
    lines.push("", "هل تودّ بدء التفاوض معه؟");
    return lines.join("\n");
  }
  const lines = [
    `${office}`,
    "وجدنا عقارًا قد يناسب طلبك:",
    "",
    `• ${[clip(offer.propertyType, 30) || "عقار", rent ? "للإيجار" : "للبيع"].join(" ")}${place(offer) ? ` — ${place(offer)}` : ""}`
  ];
  if (offer.price) lines.push(`• السعر: ${formatPrice(offer.price)}`);
  if (offer.area) lines.push(`• المساحة: ${formatArea(offer.area)}`);
  if (offer.rooms) lines.push(`• الغرف: ${Number(offer.rooms)}`);
  lines.push("", "هل هذا العقار مناسب لك؟");
  return lines.join("\n");
}

export const BOT_TEXT = Object.freeze({
  answeredYes: "إجابتك: مناسب",
  answeredNo: "إجابتك: غير مناسب",
  clientYesWaitOwner: "شكرًا لك. نتأكد الآن من المالك ونعود إليك هنا.",
  clientYesBrokerFollows: "شكرًا لك. سيتواصل معك الوسيط لإكمال الخطوة التالية.",
  thanksNo: "شكرًا لك. سنبحث لك عن خيار أنسب.",
  ownerDeclined: "اعتذر المالك عن هذا العقار. سنبحث لك عن خيار آخر.",
  stale: "هذا السؤال لم يعد قائمًا.",
  notYours: "هذا الزر ليس لهذه المحادثة.",
  roomReady: "وافق الطرفان. افتح صفحة التفاوض لمتابعة السعر والشروط وموعد المعاينة — كل ما تختاره هناك يصل للطرف الآخر مباشرة.",
  roomReadyByBroker: "اعتمد المكتب هذه المطابقة. افتح صفحة التفاوض لمتابعة السعر والشروط وموعد المعاينة — كل ما تختاره هناك يصل للطرف الآخر مباشرة.",
  answerWithBroker: "شكرًا لك. وصل ردك إلى الوسيط وسيتواصل معك.",
  shareContact: "خطوة واحدة للتأكد أن الرابط وصل لصاحبه: اضغط الزر «مشاركة رقمي» بالأسفل.",
  shareContactButton: "مشاركة رقمي",
  contactNotYours: "شارك رقمك أنت من الزر «مشاركة رقمي».",
  contactMismatch: "هذا الرقم لا يطابق الرقم المسجل لدى المكتب. تواصل مع المكتب لتحديث رقمك ثم اطلب رابطًا جديدًا.",
  roomButton: "فتح صفحة التفاوض",
  messageForwarded: "وصلت رسالتك إلى الوسيط، وسيتواصل معك.",
  stopped: "تم إيقاف رسائل البوت. للعودة أرسل: تشغيل",
  resumed: "تم تشغيل رسائل البوت من جديد.",
  privateOnly: "افتح رابط الربط في محادثة خاصة مع البوت.",
  linkUnknown: "رابط الربط غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا من المكتب.",
  brokerLinked: "تم ربط تنبيهاتك. يصلك هنا فقط ما يحتاج تدخلك، مع زر يفتح الصفقة."
});

export function partyWelcome({ officeName = "", name = "" } = {}) {
  const who = clip(name, 40);
  return `${who ? `أهلًا ${who}. ` : "أهلًا بك. "}تم ربطك بـ${clip(officeName, 60) || "المكتب"}.\nتصلك هنا العقارات والعملاء المناسبون لك، وتجيب بضغطة زر. لإيقاف الرسائل أرسل: إيقاف`;
}

/** What the other side reads when one side moves in the room (the same words the room shows). */
export function relayMessage({ fromRole, text = "" } = {}) {
  return `${BOT_ROLE_LABEL[fromRole] || "الطرف الآخر"}: ${clip(text, 300)}\nافتح صفحة التفاوض للرد.`;
}

const STOP_WORDS = new Set(["إيقاف", "ايقاف", "أوقف", "اوقف", "stop", "/stop"]);
const RESUME_WORDS = new Set(["تشغيل", "start", "/start", "/resume", "resume"]);

/** "stop" | "resume" | "" for a plain text a side wrote to the bot. */
export function partyCommand(text) {
  const word = String(text || "").trim().toLowerCase();
  if (STOP_WORDS.has(word)) return "stop";
  if (RESUME_WORDS.has(word)) return "resume";
  return "";
}

// ------------------------------------------------------------------ the decision table

/**
 * One side pressed a button. Returns what happens next; the Worker applies it.
 *   effect: ask_owner | open | reject | broker_follows | none
 */
export function planAnswer(ask = {}, role, answer, { ownerLinked = false, botOn = true } = {}) {
  const waiting = awaitedRole(ask);
  if (!waiting || waiting !== role) return { ok: false, reason: "stale" };
  if (answer !== "yes" && answer !== "no") return { ok: false, reason: "answer_invalid" };
  // The office switched its bot off after the question went out: the answer is kept and the
  // broker takes it from here — the bot neither asks further nor decides anything.
  if (!botOn) return { ok: true, next: ASK_STATE.HANDED_TO_BROKER, effect: "hand_to_broker" };
  if (role === BOT_ROLE.CLIENT) {
    if (answer === "no") return { ok: true, next: ASK_STATE.CLIENT_NO, effect: "reject" };
    return ownerLinked
      ? { ok: true, next: ASK_STATE.OWNER_ASKED, effect: "ask_owner" }
      : { ok: true, next: ASK_STATE.OWNER_NOT_LINKED, effect: "broker_follows" };
  }
  return answer === "yes"
    ? { ok: true, next: ASK_STATE.OPENED, effect: "open" }
    : { ok: true, next: ASK_STATE.OWNER_NO, effect: "reject" };
}

/** May the bot start asking about this match at all? Returns "" or the reason it stays with the broker. */
export function askBlocker({ match = {}, settings = {}, clientLinked = false, clientStopped = false, asksToday = 0, limits = BOT_LIMITS } = {}) {
  if (settings.enabled !== true) return "office_switch_off";
  if (match.brokerDecision) return "already_decided";
  if (match.isCurrent === false || (match.status && String(match.status) !== "active")) return "match_not_current";
  if (match.integrityStatus && String(match.integrityStatus).toLowerCase() !== "valid") return "match_not_valid";
  if (Number(match.score || 0) < Number(settings.minScore || limits.minScore)) return "score_below_minimum";
  if (!clientLinked) return "client_not_linked";
  if (clientStopped) return "client_stopped";
  if (asksToday >= limits.dailyAsks) return "daily_limit";
  return "";
}

const NO_STATES = new Set([ASK_STATE.CLIENT_NO, ASK_STATE.OWNER_NO]);

/**
 * The same pair matched again (a record was edited). Is it asked about again?
 *   waiting  → no, the question already out now points to the new version
 *   «غير مناسب» → only when the offer's price changed since it was asked
 *   a failed delivery → yes; anything else (opened, with the broker…) → no
 */
export function reaskDecision(ask = {}, { offerPrice = 0 } = {}) {
  if (awaitedRole(ask)) return "follow";
  if (ask.state === ASK_STATE.FAILED) return "ask";
  if (NO_STATES.has(ask.state)) return Number(offerPrice || 0) !== Number(ask.offerPrice || 0) ? "ask" : "keep";
  return "keep";
}

/** Night in Riyadh (10pm–8am): the message still arrives, without a sound. */
export function isQuietHour(now = new Date()) {
  const hour = new Date(now.getTime() + 3 * 3600 * 1000).getUTCHours();
  return hour >= 22 || hour < 8;
}

export function riyadhDayId(now = new Date()) {
  return new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
}

// ------------------------------------------------------------------ what the office sees

/**
 * The bot as «قنوات المكتب» shows it.
 *   available  the platform bot can write on this environment
 *   enabled    this office switched it on
 */
export function botView({ available = false, botUsername = "", settings = {}, linkedParties = 0, broker = {} } = {}) {
  const enabled = available && settings.enabled === true;
  return {
    available,
    enabled,
    botUsername: available ? String(botUsername || "") : "",
    minScore: Number(settings.minScore || BOT_LIMITS.minScore),
    dailyAsks: BOT_LIMITS.dailyAsks,
    linkedParties: Number(linkedParties || 0),
    brokerLinked: broker.status === "ACTIVE" && Boolean(broker.chatId),
    stateLabel: !available ? "غير متاح على هذه البيئة" : enabled ? "يعمل" : "متوقف",
    note: !available
      ? "يتفعّل بعد إعداد بوت المنصة والسماح له بالإرسال من إدارة المنصة."
      : enabled
        ? "البوت يسأل العميل ثم المالك عن كل مطابقة قوية، ويفتح الصفقة عند موافقتهما. يصلك تنبيه فقط عند الحاجة."
        : "متوقف: كل مطابقة تبقى مهمة مراجعة عندك كما هي الآن."
  };
}
