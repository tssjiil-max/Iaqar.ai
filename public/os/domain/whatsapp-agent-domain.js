/**
 * WhatsApp real-estate agent — pure rules (no database, no network, no clock unless passed in).
 *
 * The agent runs the client's journey inside WhatsApp; a person approves every commitment:
 *   • results come only from the office's verified, published inventory (never from chat memory);
 *   • a price offer is recorded and forwarded — never accepted, countered or promised here;
 *   • a viewing is «requested» until the office confirms it — the text never says «تم الحجز» before that;
 *   • closing, contracts, deposits and commissions stay with the authorised people and official channels.
 *
 * Everything the client sees is deterministic text built from stored facts. No paid model is needed.
 */

import { normalizeArabic, resolveListingReference } from "./direct-match-domain.js";

// ------------------------------------------------------------------ WhatsApp Cloud API limits

/** Official limits of interactive messages (reply buttons and list messages). */
export const WA_LIMITS = Object.freeze({
  BODY: 1024, BUTTONS: 3, BUTTON_TITLE: 20, BUTTON_ID: 256,
  LIST_BUTTON: 20, LIST_ROWS: 10, ROW_TITLE: 24, ROW_DESCRIPTION: 72, SECTION_TITLE: 24, TEXT: 4096, CAPTION: 1024
});

const fit = (value, max) => {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trim()}…`;
};
const money = (n) => (Number(n) > 0 ? Math.round(Number(n)).toLocaleString("en-US") : "");

// ------------------------------------------------------------------ actions

export const ACTION = Object.freeze({
  DETAILS: "DETAILS", PHOTOS: "PHOTOS", INTEREST: "INTEREST", MORE: "MORE",
  NEGOTIATE: "NEGOTIATE", OFFER_PRICE: "OFFER_PRICE", VIEWING: "VIEWING", VIEWING_TIME: "VIEWING_TIME",
  RESCHEDULE: "RESCHEDULE", CANCEL_VIEWING: "CANCEL_VIEWING", HUMAN: "HUMAN",
  FOLLOWUP_GOOD: "FOLLOWUP_GOOD", FOLLOWUP_NOTES: "FOLLOWUP_NOTES", NEW_SEARCH: "NEW_SEARCH", NONE: "NONE"
});

/** Button / list-row ids. `i` is the 0-based position in the client's own results. */
export const actionId = (type, i = null) => (i === null || i === undefined ? `wa:${type}` : `wa:${type}:${Number(i)}`);

/** An id we produced earlier → the action. Anything else (forged or stale) → null. */
export function parseActionId(id) {
  const m = /^wa:([A-Z_]{2,20})(?::(\d{1,2}))?$/.exec(String(id || ""));
  if (!m || !(m[1] in ACTION) || m[1] === ACTION.NONE) return null;
  return { type: m[1], index: m[2] === undefined ? null : Number(m[2]) };
}

/** A Cloud API inbound message → the text we read and, for buttons/lists, the id we sent. */
export function readInbound(message = {}) {
  const type = String(message.type || "");
  if (type === "text") return { kind: "text", text: String(message.text?.body || "").slice(0, 4000), actionId: "" };
  if (type === "interactive") {
    const reply = message.interactive?.button_reply || message.interactive?.list_reply || {};
    return { kind: "interactive", text: String(reply.title || "").slice(0, 200), actionId: String(reply.id || "").slice(0, 256) };
  }
  if (type === "button") return { kind: "interactive", text: String(message.button?.text || "").slice(0, 200), actionId: String(message.button?.payload || "").slice(0, 256) };
  return { kind: "media", text: "", actionId: "" };
}

const has = (t, re) => re.test(t);

/**
 * What the client wants now, from a button id first, then from the words, read against the
 * conversation's current question. Words never unlock more than the buttons do.
 */
export function detectAction({ text = "", actionId: id = "" } = {}, conversation = {}) {
  const fromId = parseActionId(id);
  if (fromId) return fromId;
  const raw = String(text || "");
  const t = normalizeArabic(raw);
  const results = Array.isArray(conversation.results) ? conversation.results : [];
  // «بالثاني»، «للأول»، «والثالث» → the ordinal words the shared resolver knows.
  const pick = resolveListingReference(raw.replace(/(^|\s)[بولف](?=ال)/g, "$1"), results);
  const index = pick ? pick.index : (Number.isInteger(conversation.selectedIndex) ? conversation.selectedIndex : null);
  const price = parseOfferPrice(raw);

  if (conversation.awaiting === "offer_price" && price) return { type: ACTION.OFFER_PRICE, index, price };
  if (conversation.awaiting === "viewing_time" && t && !has(t, /(الغ|كنسل|بدائل|غيره)/)) return { type: ACTION.VIEWING_TIME, index, timeText: raw.slice(0, 200) };
  if (conversation.awaiting === "followup") {
    if (has(t, /(مناسب|عجبني|اعجبني|ابي اكمل|ابغى اكمل|نكمل|ممتاز|حلو)/) && !has(t, /(مو مناسب|غير مناسب|ما ناسب|ماناسب|ما عجب)/)) return { type: ACTION.FOLLOWUP_GOOD, index };
    if (has(t, /(بدائل|غيره|عقار ثاني|خيارات ثانيه)/)) return { type: ACTION.MORE, index };
    if (t) return { type: ACTION.FOLLOWUP_NOTES, index, note: raw.slice(0, 500) };
  }
  if (has(t, /(بحث جديد|طلب جديد|ابحث عن شي ثاني|ابدا من جديد)/)) return { type: ACTION.NEW_SEARCH, index: null };
  if (has(t, /(الغ|الغي|كنسل).*(موعد|معاينه)|(موعد|معاينه).*(الغ|الغي|كنسل)/)) return { type: ACTION.CANCEL_VIEWING, index };
  if (has(t, /(غير|اغير|تغيير|اجل|تاجيل|اقدم|تقديم).*(موعد|معاينه)|(موعد|معاينه).*(غير|تغيير|اجل|تاجيل)/)) return { type: ACTION.RESCHEDULE, index, timeText: raw.slice(0, 200) };
  if (has(t, /(معاينه|اعاين|اشوف العقار|اشوفه|ازوره|زياره|موعد)/)) return { type: ACTION.VIEWING, index, timeText: raw.slice(0, 200) };
  if (has(t, /(تفاوض|افاوض|اخر سعر|آخر سعر|ينزل|تنزيل|خصم|اعرض عليه|اعرض|ادفع|عرضي)/)) return { type: price ? ACTION.OFFER_PRICE : ACTION.NEGOTIATE, index, price };
  if (has(t, /(صور|صوره|الصور)/)) return { type: ACTION.PHOTOS, index };
  if (has(t, /(تفاصيل|معلومات|وصف|مواصفات)/)) return { type: ACTION.DETAILS, index };
  if (has(t, /(مهتم|يعجبني|ابغاه|ابيه|اريده|ابي هذا|ابغى هذا|اخذه)/)) return { type: ACTION.INTEREST, index };
  if (has(t, /(بدائل|غيرها|غيره|المزيد|ثانيه|خيارات|عروض اكثر)/)) return { type: ACTION.MORE, index };
  if (pick) return { type: ACTION.DETAILS, index: pick.index };
  return { type: ACTION.NONE, index };
}

// ------------------------------------------------------------------ numbers and times

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toLatin = (s) => String(s ?? "").replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[٫]/g, ".").replace(/[٬,]/g, "");

/**
 * A price the client wrote («450 ألف»، «مليون ونص»، «1.2 مليون»، «مليون و200»، «1,850,000»).
 * Conservative: anything it cannot read with confidence is null and the client is asked again.
 */
export function parseOfferPrice(raw = "") {
  const t = toLatin(normalizeArabic(raw));
  if (!t) return null;
  let m = /(\d+(?:\.\d+)?)\s*(مليون|ملايين)/.exec(t);
  if (m) {
    const base = Number(m[1]) * 1_000_000;
    const rest = t.slice(m.index + m[0].length);
    const half = /^\s*و\s*(نص|نصف)/.test(rest);
    const extra = /^\s*و\s*(\d{1,3})(?:\s*(الف|ألف))?(?!\d)/.exec(rest);
    return Math.round(base + (half ? 500_000 : extra ? Number(extra[1]) * 1000 : 0));
  }
  m = /(?:^|\s)(مليونين|مليون)(?:\s*و\s*(نص|نصف|\d{1,3})(?:\s*(?:الف|ألف))?)?/.exec(t);
  if (m) {
    const base = m[1] === "مليونين" ? 2_000_000 : 1_000_000;
    const extra = !m[2] ? 0 : /^(نص|نصف)$/.test(m[2]) ? 500_000 : Number(m[2]) * 1000;
    return base + extra;
  }
  m = /(\d+(?:\.\d+)?)\s*(الف|ألف|آلاف|الاف)/.exec(t);
  if (m) return Math.round(Number(m[1]) * 1000);
  const plain = [...t.matchAll(/\d{4,10}/g)].map((x) => Number(x[0])).filter((n) => n >= 1000);
  return plain.length === 1 ? plain[0] : null;
}

const WEEKDAYS = [["الاحد", 0], ["الاثنين", 1], ["الثلاثاء", 2], ["الاربعاء", 3], ["الخميس", 4], ["الجمعه", 5], ["السبت", 6]];
const PERIOD_HOUR = [["الفجر", 5], ["الصبح", 9], ["الصباح", 9], ["الظهر", 13], ["العصر", 16], ["المغرب", 18], ["العشاء", 20], ["الليل", 21], ["المساء", 19]];

/**
 * The client's preferred viewing time. `at` is filled only when both the day and the hour are clear
 * (Riyadh time, UTC+3); otherwise the words are kept for the office. This is a preference, not a booking.
 */
export function parseViewingTime(raw = "", now = new Date(), { offsetMinutes = 180 } = {}) {
  const t = toLatin(normalizeArabic(raw));
  const label = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const local = new Date(now.getTime() + offsetMinutes * 60000);
  let dayOffset = null;
  if (/بعد (بكره|بكرا|غد|غدا)/.test(t)) dayOffset = 2;
  else if (/(بكره|بكرا|غدا|الغد|باكر)/.test(t)) dayOffset = 1;
  else if (/(اليوم|الحين)/.test(t)) dayOffset = 0;
  else {
    // «الخميس»، «للخميس»، «يوم الخميس»، «بالخميس» — never a bare stem inside another word («واحد»).
    const day = WEEKDAYS.find(([w]) => new RegExp(`(^|\\s)(?:يوم\\s+)?(?:ال|لل|بال|وال|ل)?${w.replace(/^ال/, "")}(?=$|\\s|[،,.!؟?])`).test(t));
    if (day) { const diff = (day[1] - local.getUTCDay() + 7) % 7; dayOffset = diff === 0 ? 7 : diff; }
  }
  let hour = null, minute = 0;
  const clock = /(?:الساعه\s*)?(\d{1,2})(?::(\d{2}))?\s*(ص|م|صباحا|مساء|العصر|المغرب|الظهر|الليل)?/.exec(t.replace(/(بعد|قبل)\s*(بكره|بكرا|غدا)/, ""));
  const period = PERIOD_HOUR.find(([w]) => t.includes(w));
  if (clock && /الساعه|ص|م|العصر|المغرب|الظهر|الليل|:/.test(clock[0])) {
    hour = Number(clock[1]); minute = Number(clock[2] || 0);
    const pm = /(م|مساء|العصر|المغرب|الليل)$/.test(clock[3] || "") || (period && period[1] >= 13);
    if (pm && hour < 12) hour += 12;
    if (!clock[3] && !period && hour >= 1 && hour <= 7) hour += 12; // «الساعة 5» for a viewing means the afternoon
  } else if (period) hour = period[1];
  if (hour === null || dayOffset === null || hour > 23 || minute > 59) return { label, at: null, confident: false };
  const y = local.getUTCFullYear(), mo = local.getUTCMonth(), d = local.getUTCDate() + dayOffset;
  const at = new Date(Date.UTC(y, mo, d, hour, minute) - offsetMinutes * 60000);
  if (at.getTime() <= now.getTime()) return { label, at: null, confident: false };
  return { label, at: at.toISOString(), confident: true };
}

/** «الأحد 18 أكتوبر، 4:00 م» in Riyadh time, for messages. */
export function formatRiyadh(at) {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
}

// ------------------------------------------------------------------ messages (Cloud API payload shapes)

export const textMessage = (body) => ({ type: "text", text: { preview_url: false, body: fit(body, WA_LIMITS.TEXT) } });

export function buttonsMessage(body, buttons = [], { header = "", footer = "" } = {}) {
  const list = buttons.filter(Boolean).slice(0, WA_LIMITS.BUTTONS).map((b) => ({ type: "reply", reply: { id: String(b.id).slice(0, WA_LIMITS.BUTTON_ID), title: fit(b.title, WA_LIMITS.BUTTON_TITLE) } }));
  if (!list.length) return textMessage(body);
  return {
    type: "interactive",
    interactive: {
      type: "button",
      ...(header ? { header: { type: "text", text: fit(header, 60) } } : {}),
      body: { text: fit(body, WA_LIMITS.BODY) },
      ...(footer ? { footer: { text: fit(footer, 60) } } : {}),
      action: { buttons: list }
    }
  };
}

export function listMessage(body, { button = "اختر", sections = [], header = "", footer = "" } = {}) {
  let left = WA_LIMITS.LIST_ROWS;
  const built = sections.map((s) => {
    const rows = (s.rows || []).slice(0, left).map((r) => ({ id: String(r.id).slice(0, 200), title: fit(r.title, WA_LIMITS.ROW_TITLE), ...(r.description ? { description: fit(r.description, WA_LIMITS.ROW_DESCRIPTION) } : {}) }));
    left -= rows.length;
    return { title: fit(s.title, WA_LIMITS.SECTION_TITLE), rows };
  }).filter((s) => s.rows.length);
  if (!built.length) return textMessage(body);
  return {
    type: "interactive",
    interactive: {
      type: "list",
      ...(header ? { header: { type: "text", text: fit(header, 60) } } : {}),
      body: { text: fit(body, WA_LIMITS.BODY) },
      ...(footer ? { footer: { text: fit(footer, 60) } } : {}),
      action: { button: fit(button, WA_LIMITS.LIST_BUTTON), sections: built }
    }
  };
}

export const imageMessage = (link, caption = "") => ({ type: "image", image: { link: String(link), ...(caption ? { caption: fit(caption, WA_LIMITS.CAPTION) } : {}) } });

/** One result line, from the verified snapshot only. */
export function resultLine(item, i) {
  const specs = [item.rooms ? `${item.rooms} غرف` : "", item.area ? `${money(item.area)} م²` : ""].filter(Boolean).join("، ");
  const purpose = item.purpose === 'SALE' ? 'للبيع' : item.purpose === 'RENT' ? 'للإيجار' : '';
  return `${i + 1}) ${item.propertyType} — ${item.district}، ${item.city}\n${purpose ? `الغرض: ${purpose}\n` : ''}السعر: ${money(item.price)} ريال${item.priceStatus === 'NEGOTIABLE' ? ' · قابل للتفاوض' : ''}${specs ? ` · ${specs}` : ""}\nالحالة: ${item.statusLabel || "متاح"} · المرجع: ${item.reference}`;
}

/** Why it matches, and how it differs from what the client asked for. */
export function matchExplanation(item, criteria = {}) {
  const reasons = (Array.isArray(item.reasons) ? item.reasons : []).slice(0, 3);
  const diffs = [];
  if (item.nearby && item.distanceKm !== null && item.distanceKm !== undefined) diffs.push(`في حي قريب (${item.district}) على بعد نحو ${item.distanceKm} كم بخط مستقيم`);
  else if (item.nearby) diffs.push(`في حي قريب (${item.district})`);
  const budget = Number(criteria.price) || 0;
  if (budget && Number(item.price) < budget) diffs.push(`أقل من ميزانيتك بـ ${money(budget - Number(item.price))} ريال`);
  if (criteria.rooms && item.rooms && Number(item.rooms) !== Number(criteria.rooms)) diffs.push(`عدد الغرف ${item.rooms} (طلبت ${criteria.rooms})`);
  return { reasons, diffs };
}

/** The first page of results: the top three as text, then a list to act on them. */
export function resultsMessages(results = [], { criteria = {}, from = 0, count = 3, more: remaining = null, continuation = false } = {}) {
  const page = results.slice(from, from + count);
  if (!page.length) return [];
  const head = from === 0 && !continuation ? `وجدت ${results.length === 1 ? "عقارًا واحدًا" : `${results.length} عقارات`} منشورة ومطابقة لطلبك. هذه ${from === 0 && page.length > 1 ? `أفضل ${page.length}` : "النتيجة"}:` : "هذه بدائل إضافية:";
  const lines = page.map((item, k) => {
    const { reasons, diffs } = matchExplanation(item, criteria);
    return [resultLine(item, Number.isInteger(item.position) ? item.position : from + k), reasons.length ? `ليش يناسبك: ${reasons.join("، ")}` : "", diffs.length ? `ملاحظة: ${diffs.join("، ")}` : ""].filter(Boolean).join("\n");
  });
  const rows = page.flatMap((item, k) => {
    // `position` is the item's place in the client's original list, so a button always means the same property.
    const i = Number.isInteger(item.position) ? item.position : from + k;
    return [
      { id: actionId(ACTION.DETAILS, i), title: `تفاصيل العرض ${i + 1}`, description: `${item.propertyType} — ${item.district} — ${money(item.price)} ريال` },
      { id: actionId(ACTION.INTEREST, i), title: `مهتم بالعرض ${i + 1}`, description: "يوصل اهتمامك للمكتب ليتابع معك" }
    ];
  });
  const left = remaining === null ? results.length - from - count : remaining;
  const more = left > 0 ? [{ id: actionId(ACTION.MORE), title: "عرض بدائل", description: `${left} عروض إضافية مطابقة` }] : [];
  return [
    textMessage([head, ...lines, "الأسعار والحالة من بيانات المكتب المعتمدة الآن. التوفر النهائي يؤكده المكتب قبل المعاينة أو الاتفاق."].join("\n\n")),
    listMessage("اختر الإجراء المناسب:", {
      button: "الإجراءات",
      sections: [{ title: "العروض", rows: rows.slice(0, WA_LIMITS.LIST_ROWS - more.length - 1) }, { title: "خيارات", rows: [...more, { id: actionId(ACTION.HUMAN), title: "التواصل مع المسؤول", description: "يحول المحادثة لموظف المكتب" }] }]
    })
  ];
}

export function detailsMessages(item, i, { criteria = {}, officeLink = "" } = {}) {
  const { reasons, diffs } = matchExplanation(item, criteria);
  const lines = [
    `تفاصيل العرض ${i + 1} (المرجع: ${item.reference})`,
    `• النوع: ${item.propertyType}${item.purpose === "RENT" ? " للإيجار" : item.purpose === "SALE" ? " للبيع" : ""}`,
    `• الموقع: ${item.district}، ${item.city}`,
    `• السعر المعتمد: ${money(item.price)} ريال`,
    item.rooms ? `• الغرف: ${item.rooms}` : "",
    item.area ? `• المساحة: ${money(item.area)} م²` : "",
    `• الحالة: ${item.statusLabel || "متاح"}`,
    item.officeName ? `• المكتب: ${item.officeName}` : "",
    reasons.length ? `• أسباب المطابقة: ${reasons.join("، ")}` : "",
    diffs.length ? `• الاختلاف عن طلبك: ${diffs.join("، ")}` : "",
    item.interestNotice ? `• ${item.interestNotice}` : "",
    officeLink ? `• صفحة المكتب: ${officeLink}` : ""
  ].filter(Boolean).join("\n");
  return [buttonsMessage(lines, [
    { id: actionId(ACTION.PHOTOS, i), title: "مشاهدة الصور" },
    { id: actionId(ACTION.INTEREST, i), title: "مهتم بالعقار" },
    { id: actionId(ACTION.MORE), title: "عرض بدائل" }
  ])];
}

export function afterInterestMessages(item, i, { leadCreated = true } = {}) {
  return [buttonsMessage([
    `تم تسجيل اهتمامك بالعرض ${i + 1}: ${item.propertyType} — ${item.district} (المرجع ${item.reference}).`,
    leadCreated ? "وصل اهتمامك للمكتب وسيتابع معك." : "اهتمامك مسجل مسبقًا لدى المكتب.",
    "الاهتمام لا يحجز العقار. تقدر الآن تطلب معاينة أو تقدّم عرض سعر:"
  ].join("\n"), [
    { id: actionId(ACTION.VIEWING, i), title: "حجز معاينة" },
    { id: actionId(ACTION.NEGOTIATE, i), title: "طلب تفاوض" },
    { id: actionId(ACTION.HUMAN), title: "التواصل مع المسؤول" }
  ])];
}

export const askOfferMessage = (item) => textMessage(`كم السعر اللي تبي تعرضه على ${item.propertyType} في ${item.district}؟ السعر المعلن ${money(item.price)} ريال.\nاكتب المبلغ، مثل: «1,850,000» أو «مليون و850 ألف».`);

export function offerRecordedMessages(item, price) {
  return [textMessage([
    `سجلت عرضك: ${money(price)} ريال على ${item.propertyType} في ${item.district} (المرجع ${item.reference}).`,
    "أرسلته للمكتب ليعرضه على المالك أو المفوض.",
    "تنبيه: العرض غير ملزم لأي طرف، ولا يعتبر مقبولًا إلا بتأكيد مكتوب يصلك من المكتب بعد موافقة المالك."
  ].join("\n"))];
}

/** A new number while the previous offer is still with the office: kept as it was, nothing new recorded. */
export function offerPendingMessage(item, price) {
  return textMessage([
    `عرضك السابق ${money(price)} ريال على ${item.propertyType} في ${item.district} (المرجع ${item.reference}) ما زال لدى المكتب.`,
    "بنبلغك برد المالك أولًا، وبعدها تقدر تعدّل عرضك."
  ].join("\n"));
}

export const askViewingTimeMessage = (item) => textMessage(`متى يناسبك تعاين ${item.propertyType} في ${item.district}؟\nاكتب اليوم والوقت، مثل: «بكرة العصر الساعة 5» أو «الخميس 7 م».`);

export function viewingRequestedMessages(item, preference, { reschedule = false } = {}) {
  const when = preference.at ? formatRiyadh(preference.at) : preference.label;
  return [buttonsMessage([
    `${reschedule ? "استلمت طلب تغيير موعد المعاينة" : "استلمت طلب المعاينة"} لـ ${item.propertyType} في ${item.district} (المرجع ${item.reference}).`,
    `الوقت المفضل لك: ${when}`,
    "الموعد غير مؤكد حتى ينسقه المكتب مع المالك ويؤكده، وبيوصلك التأكيد هنا."
  ].join("\n"), [
    { id: actionId(ACTION.RESCHEDULE, null), title: "تغيير الوقت" },
    { id: actionId(ACTION.CANCEL_VIEWING, null), title: "إلغاء الطلب" },
    { id: actionId(ACTION.HUMAN), title: "التواصل مع المسؤول" }
  ])];
}

export function followUpQuestion(item) {
  return buttonsMessage(`كيف كانت معاينة ${item?.propertyType || "العقار"} في ${item?.district || ""}؟ هل العقار مناسب لك؟`, [
    { id: actionId(ACTION.FOLLOWUP_GOOD), title: "مناسب، أبغى أكمل" },
    { id: actionId(ACTION.FOLLOWUP_NOTES), title: "عندي ملاحظات" },
    { id: actionId(ACTION.MORE), title: "أبغى بدائل" }
  ]);
}

export const HUMAN_TEXT = "تم تحويل محادثتك لموظف المكتب، وبيرد عليك في أقرب وقت. (الرد الآلي متوقف لهذه المحادثة)";
export const STOP_TEXT = "تم إيقاف الرسائل الآلية. لن نرسل لك رسائل آلية أخرى. لو احتجت المكتب اكتب له مباشرة.";
export const NO_RESULTS_TEXT = "تم حفظ طلبك لدى المكتب. ما وجدت الآن عروضًا منشورة ومتاحة تطابق شروطك، ولن أقترح عروضًا غير موثقة. بيتابع المكتب طلبك ويبلغك عند توفر عقار مناسب.";
export const UNAVAILABLE_TEXT = "تعذر الوصول لبيانات العروض الآن. ما راح أرسل معلومات غير مؤكدة؛ حاول بعد قليل أو اكتب «موظف» للتواصل مع المكتب.";

// ------------------------------------------------------------------ office decisions → client wording

export const CASE_STAGE = Object.freeze({
  INTERESTED: "INTERESTED", NEGOTIATING: "NEGOTIATING", VIEWING_REQUESTED: "VIEWING_REQUESTED",
  VIEWING_CONFIRMED: "VIEWING_CONFIRMED", VIEWED: "VIEWED", AGREEMENT: "AGREEMENT",
  CLOSED_WON: "CLOSED_WON", CLOSED_LOST: "CLOSED_LOST"
});

export const OFFICE_ACTION = Object.freeze({
  NEGOTIATION_ANSWER: "negotiation_answer", VIEWING_CONFIRM: "viewing_confirm", VIEWING_CANCEL: "viewing_cancel",
  VIEWING_RESULT: "viewing_result", AGREEMENT: "agreement", CLOSE_WON: "close_won", CLOSE_LOST: "close_lost", RESUME_AGENT: "resume_agent"
});

/** Which office actions are allowed from which case state — a closed case accepts nothing. */
export function officeActionAllowed(caseDoc = {}, action) {
  const stage = String(caseDoc.stage || "");
  if (stage === CASE_STAGE.CLOSED_WON || stage === CASE_STAGE.CLOSED_LOST) return false;
  if (action === OFFICE_ACTION.NEGOTIATION_ANSWER) return Boolean(caseDoc.negotiation?.offers?.length);
  if (action === OFFICE_ACTION.VIEWING_CONFIRM) return ["REQUESTED", "RESCHEDULE_REQUESTED", "CONFIRMED"].includes(caseDoc.viewing?.state || "");
  if (action === OFFICE_ACTION.VIEWING_CANCEL) return ["REQUESTED", "RESCHEDULE_REQUESTED", "CONFIRMED"].includes(caseDoc.viewing?.state || "");
  if (action === OFFICE_ACTION.VIEWING_RESULT) return caseDoc.viewing?.state === "CONFIRMED";
  if (action === OFFICE_ACTION.AGREEMENT) return caseDoc.negotiation?.status === "ACCEPTED_BY_OWNER";
  if (action === OFFICE_ACTION.CLOSE_WON) return stage === CASE_STAGE.AGREEMENT;
  if (action === OFFICE_ACTION.CLOSE_LOST) return true;
  return false;
}

/** Two confirmed viewings closer than this, for the same property or the same broker, conflict. */
export const VIEWING_SLOT_MINUTES = 60;
export function viewingConflict(cases = [], { caseId = "", reference = "", brokerId = "", at }) {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return null;
  return cases.find((c) => c.id !== caseId && c.viewing?.state === "CONFIRMED" && c.viewing?.at
    && Math.abs(new Date(c.viewing.at).getTime() - t) < VIEWING_SLOT_MINUTES * 60000
    && (c.reference === reference || (brokerId && c.assignedBrokerId === brokerId))) || null;
}

export function officeUpdateText(action, caseDoc = {}, input = {}) {
  const item = caseDoc.listing || {};
  const what = `${item.propertyType || "العقار"} في ${item.district || ""} (المرجع ${caseDoc.reference || ""})`;
  switch (action) {
    case OFFICE_ACTION.NEGOTIATION_ANSWER:
      if (input.decision === "accepted") return `رد المالك على عرضك ${money(input.price)} ريال لـ ${what}: موافقة مبدئية ✅\nالخطوات النظامية (العقد، الدفعات، التوثيق) يتولاها المكتب معك مباشرة، ولا يتم أي التزام قبل توقيعها.`;
      if (input.decision === "counter") return `رد المالك على عرضك لـ ${what}: يقترح ${money(input.price)} ريال.\nتقدر ترد بعرض جديد بكتابة المبلغ، أو تطلب معاينة.`;
      return `رد المالك على عرضك لـ ${what}: الاعتذار عن السعر المعروض.\nتقدر تقدم عرضًا آخر أو تطلب بدائل.`;
    case OFFICE_ACTION.VIEWING_CONFIRM:
      return `تم تأكيد موعد المعاينة من المكتب ✅\n${what}\nالموعد: ${formatRiyadh(input.at)}${input.note ? `\nملاحظة: ${String(input.note).slice(0, 200)}` : ""}\nلو احتجت تغيير الموعد اكتب «غير الموعد».`;
    case OFFICE_ACTION.VIEWING_CANCEL:
      return `تعذر إتمام موعد المعاينة لـ ${what}${input.reason ? `: ${String(input.reason).slice(0, 200)}` : ""}.\nاكتب «معاينة» مع وقت آخر يناسبك.`;
    case OFFICE_ACTION.AGREEMENT:
      return `تم تسجيل الاتفاق المبدئي على ${what}.\nالمستندات والإجراءات الرسمية ينسقها معك المكتب عبر القنوات المعتمدة، ولا يتم أي تحويل أو توقيع عبر هذه المحادثة.`;
    case OFFICE_ACTION.CLOSE_WON:
      return `تم إتمام الصفقة على ${what} 🎉\nشكرًا لثقتك. أي استفسار بعد الإتمام اكتبه هنا.`;
    case OFFICE_ACTION.CLOSE_LOST:
      return `تم إغلاق متابعة ${what}${input.reason ? `: ${String(input.reason).slice(0, 200)}` : ""}.\nتقدر تكتب «بحث جديد» لو تبي خيارات أخرى.`;
    default:
      return "";
  }
}

export const reminderText = (caseDoc) => `تذكير: موعد معاينة ${caseDoc.listing?.propertyType || "العقار"} في ${caseDoc.listing?.district || ""} ${formatRiyadh(caseDoc.viewing?.at)}.\nلو تبي تغير الموعد اكتب «غير الموعد».`;
