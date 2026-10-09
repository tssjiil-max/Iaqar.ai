/**
 * «مدير المكتب الذكي» on Telegram — talking to an owner, a broker or a client who opened the office's
 * own bot link (t.me/<bot>?start=of_<officeId>). Pure rules shared by the Worker and the tests.
 *
 *   • The person says who they are with a button (مالك / وسيط / عميل) — kept per transaction, asked again
 *     only for a new transaction. Choosing «مالك» proves nothing legally.
 *   • The office manager collects one transaction at a time (a draft), asking ONE missing thing per message,
 *     never repeating what was said; nothing is saved until the person presses «سجّل».
 *   • The mobile comes from Telegram's own «مشاركة رقمي» button (the person's own contact only).
 *   • «أبي أكلم الوسيط» hands the chat to the office; small talk never becomes a record.
 *   • Arabic replies default to a natural Saudi dialect; English messages get English replies. The model
 *     (when available) adapts to any language it supports; these texts are the fallback.
 */

export const PERSONA = Object.freeze({ OWNER: "OWNER", BROKER: "BROKER", CLIENT: "CLIENT" });
export const VISITOR_MODE = Object.freeze({ AGENT: "AGENT", HUMAN: "HUMAN" });
export const START_PREFIX = "of_";

/** «/start of_<officeId>» → the office id, else "". */
export function parseOfficeStart(text) {
  const m = String(text || "").trim().match(/^\/start(?:@[A-Za-z0-9_]+)?\s+of_([A-Za-z0-9_-]{3,60})$/);
  return m ? m[1] : "";
}

export function officeBotLink(botUsername, officeId) {
  const user = String(botUsername || "").replace(/^@/, "");
  const id = String(officeId || "");
  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(user) || !/^[A-Za-z0-9_-]{3,60}$/.test(id)) return "";
  return `https://t.me/${user}?start=${START_PREFIX}${id}`;
}

/** Latin-script messages get English fallback texts; anything else Arabic (Saudi by default). */
export function detectLang(text = "") {
  const s = String(text || "");
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  const arabic = (s.match(/[؀-ۿ]/g) || []).length;
  return latin > arabic && latin >= 3 ? "en" : "ar";
}

const norm = (value) => String(value || "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");

export function wantsHuman(text = "") {
  return /(اكلم|ابغى|ابي|ودي|ممكن).{0,12}(الوسيط|وسيط|موظف|شخص|انسان|المكتب|احد)|تواصل(وا)? معي|اتصلوا|\b(human|agent|person|broker|call me)\b/.test(norm(text));
}

export function isSmallTalk(text = "") {
  const t = norm(text).replace(/[!.؟?،,]/g, "").trim();
  return t.length <= 30 && /^(السلام عليكم|سلام|مرحبا|اهلا|هلا|هلا والله|شكرا|يعطيك العافيه|صباح الخير|مساء الخير|hi|hello|hey|thanks|thank you|ok|تمام|طيب)( .*)?$/.test(t);
}

const TEXT = {
  ar: {
    welcome: (office) => `السلام عليكم ورحمة الله وبركاته 🌷\nحياك الله في ${office}.\nمعك مدير المكتب الذكي (مساعد ذكاء اصطناعي)، ويسعدني أخدمك وأتابع معاملتك من البداية للنهاية.\nعشان أخدمك بالشكل الصحيح، هل أنت مالك عقار، أو وسيط عقاري، أو عميل يبحث عن عقار؟`,
    personas: { OWNER: "مالك عقار", BROKER: "وسيط عقاري", CLIENT: "عميل يبحث عن عقار" },
    brokerKind: "تسجل عرض عقار أو طلب عميل؟",
    kinds: { OFFER: "عرض عقار", REQUEST: "طلب عميل" },
    firstOwner: "حياك الله. وش العقار اللي تبي تعرضه؟ اكتب نوعه والحي والسعر، وإذا للبيع أو الإيجار — بأي طريقة تناسبك.",
    firstClient: "حياك الله. وش تدور عليه؟ اكتب نوع العقار والحي والميزانية، وإذا شراء أو إيجار.",
    ask: {
      purpose: { OFFER: "العقار للبيع ولا للإيجار؟", REQUEST: "تبي شراء ولا إيجار؟" },
      propertyType: "وش نوع العقار؟ (شقة، فيلا، أرض…)",
      district: "في أي حي؟",
      city: "في أي مدينة؟",
      price: { OFFER: "كم السعر المطلوب؟", REQUEST: "كم ميزانيتك تقريبًا؟" }
    },
    phone: "تمام. عشان يتواصل معك المكتب، اضغط «مشاركة رقمي» تحت 👇",
    phoneButton: "مشاركة رقمي",
    phoneMismatch: "شارك رقمك أنت من الزر، مو رقم شخص ثاني.",
    phoneSaudiOnly: "المكتب يسجل حاليًا أرقام الجوال السعودية فقط. إذا عندك رقم سعودي شاركه، أو اكتب «أبي أكلم الوسيط» ويتواصل معك المكتب.",
    summary: (lines) => `هذا ملخص طلبك:\n${lines.join("\n")}\nأسجله؟`,
    save: "سجّل", edit: "تعديل",
    saved: (ref, duration) => `تم التسجيل ✅ رقمك المرجعي: ${ref}\nمدة ${duration}، ونذكرك قبل انتهائها. لو عندك معاملة ثانية اضغط «معاملة جديدة».`,
    newTx: "معاملة جديدة",
    handedOver: "أبشر، بلّغت الوسيط في المكتب وبيرد عليك هنا.",
    smallTalk: "حياك الله 🌷 متى ما كنت جاهز، اكتب لي تفاصيل العقار أو طلبك.",
    unclear: "ما فهمت قصدك تمامًا، ممكن توضح بكلمات أخرى؟",
    off: "خدمة مدير المكتب الذكي متوقفة حاليًا في هذا المكتب. تقدر تتواصل مع المكتب مباشرة.",
    unknownOffice: "الرابط غير صحيح أو المكتب غير متاح.",
    editHint: "اكتب التعديل اللي تبيه، مثل: «السعر 850 ألف»."
  },
  en: {
    welcome: (office) => `Welcome to ${office} 🌷\nI'm the office's AI manager (an AI assistant). I'll take care of your request from start to finish.\nAre you a property owner, a real-estate broker, or a client looking for a property?`,
    personas: { OWNER: "Property owner", BROKER: "Broker", CLIENT: "Looking for a property" },
    brokerKind: "Are you listing a property or registering a client's request?",
    kinds: { OFFER: "A property", REQUEST: "A client request" },
    firstOwner: "Great. Tell me about the property: type, district, price, and whether it's for sale or rent.",
    firstClient: "Great. What are you looking for? Property type, district, budget, and buy or rent.",
    ask: {
      purpose: { OFFER: "Is it for sale or for rent?", REQUEST: "Do you want to buy or rent?" },
      propertyType: "What type of property is it? (apartment, villa, land…)",
      district: "Which district?",
      city: "Which city?",
      price: { OFFER: "What is the asking price?", REQUEST: "What is your approximate budget?" }
    },
    phone: "So the office can reach you, tap «Share my number» below 👇",
    phoneButton: "Share my number",
    phoneMismatch: "Please share your own number with the button.",
    phoneSaudiOnly: "The office currently registers Saudi mobile numbers only. Share a Saudi number, or type «talk to the broker» and the office will contact you.",
    summary: (lines) => `Here is the summary:\n${lines.join("\n")}\nShall I register it?`,
    save: "Register", edit: "Edit",
    saved: (ref, duration) => `Registered ✅ Your reference: ${ref}\nIt stays active for ${duration}; we'll remind you before it ends. For another one, tap «New request».`,
    newTx: "New request",
    handedOver: "Sure — I've told the broker at the office; they'll reply here.",
    smallTalk: "You're welcome 🌷 Whenever you're ready, send me the property details or what you're looking for.",
    unclear: "I didn't quite get that — could you rephrase?",
    off: "The office's AI manager is not active right now. Please contact the office directly.",
    unknownOffice: "This link is not valid or the office is not available.",
    editHint: "Type the change, e.g. «price 850,000»."
  }
};

export function visitorText(lang = "ar") {
  return TEXT[lang === "en" ? "en" : "ar"];
}

export function personaButtons(lang = "ar") {
  const t = visitorText(lang);
  return [PERSONA.OWNER, PERSONA.BROKER, PERSONA.CLIENT].map((id) => [{ text: t.personas[id], callback_data: `vp:${id}` }]);
}

/** Owner → an offer; client → a request; a broker says which. */
export function kindForPersona(persona) {
  return persona === PERSONA.OWNER ? "OFFER" : persona === PERSONA.CLIENT ? "REQUEST" : "";
}

const purposeFrom = (kind, transaction) => {
  const tx = String(transaction || "").toLowerCase();
  if (!tx) return "";
  const rent = /rent|lease|ايجار|إيجار/.test(tx);
  return kind === "OFFER" ? (rent ? "RENT" : "SALE") : (rent ? "LEASE_REQUEST" : "PURCHASE");
};

/** Merge newly understood facts into the draft (a later, explicit value replaces an earlier one). */
export function mergeDraft(draft = {}, found = {}) {
  const out = { ...draft };
  const set = (key, value) => { if (value !== undefined && value !== null && String(value).trim() !== "" && !(typeof value === "number" && !(value > 0))) out[key] = value; };
  set("propertyType", String(found.propertyType || "").trim().slice(0, 40));
  set("city", String(found.city || "").trim().slice(0, 60));
  set("district", String(found.district || "").trim().replace(/^حي\s+/, "").slice(0, 80));
  set("price", Number(found.price) || 0);
  set("area", Number(found.area) || 0);
  set("rooms", Number(found.rooms) || 0);
  if (out.kind) set("purpose", found.purpose && /^(SALE|RENT|PURCHASE|LEASE_REQUEST)$/.test(found.purpose) ? found.purpose : purposeFrom(out.kind, found.transactionType));
  set("notes", String(found.notes || "").trim().slice(0, 600));
  return out;
}

/** The ONE thing to ask next, or "" when the draft is complete (the phone is asked separately). */
export function nextMissing(draft = {}) {
  if (!draft.kind) return "kind";
  if (!draft.purpose) return "purpose";
  if (!draft.propertyType) return "propertyType";
  if (!draft.district) return "district";
  if (!draft.city) return "city";
  if (!(draft.price > 0)) return "price";
  return "";
}

export function questionFor(missing, draft = {}, lang = "ar") {
  const t = visitorText(lang);
  if (missing === "purpose") return t.ask.purpose[draft.kind === "REQUEST" ? "REQUEST" : "OFFER"];
  if (missing === "price") return t.ask.price[draft.kind === "REQUEST" ? "REQUEST" : "OFFER"];
  return t.ask[missing] || t.unclear;
}

export function summaryLines(draft = {}, lang = "ar") {
  const ar = lang !== "en";
  const purpose = { SALE: ar ? "للبيع" : "for sale", RENT: ar ? "للإيجار" : "for rent", PURCHASE: ar ? "شراء" : "to buy", LEASE_REQUEST: ar ? "إيجار" : "to rent" }[draft.purpose] || "";
  const price = draft.price ? Number(draft.price).toLocaleString("en-US") : "";
  return [
    `${draft.propertyType || ""} ${purpose}`.trim(),
    [draft.district, draft.city].filter(Boolean).join(ar ? "، " : ", "),
    price ? `${draft.kind === "REQUEST" ? (ar ? "الميزانية" : "Budget") : (ar ? "السعر" : "Price")}: ${price}` : "",
    draft.area ? `${ar ? "المساحة" : "Area"}: ${draft.area}` : "",
    draft.rooms ? `${ar ? "الغرف" : "Rooms"}: ${draft.rooms}` : ""
  ].filter(Boolean).map((line) => `• ${line}`);
}

/** The record input the office's own save path validates (same rules as the app). */
export function toRecordInput(draft = {}, { phone = "", name = "" } = {}) {
  return {
    kind: draft.kind, purpose: draft.purpose, propertyType: draft.propertyType, city: draft.city, district: draft.district,
    price: draft.price, area: draft.area || "", rooms: draft.rooms || "", contactName: String(name || "").slice(0, 80), contactPhone: phone,
    notes: draft.notes || ""
  };
}
