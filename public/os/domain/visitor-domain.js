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
    summary: (lines, kind) => `هذا ملخص ${kind === "OFFER" ? "عرضك" : "طلبك"}:\n${lines.join("\n")}\nأسجله؟`,
    pickPersona: "عشان أخدمك صح، اختر من الأزرار أو اكتب: مالك، وسيط، أو عميل.",
    confirmCity: (district, city) => `حي ${district} في ${city}؟ إذا كان في مدينة ثانية اكتب اسمها.`,
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
    summary: (lines, kind) => `Here is the summary of your ${kind === "OFFER" ? "listing" : "request"}:\n${lines.join("\n")}\nShall I register it?`,
    pickPersona: "To help you properly, choose a button or type: owner, broker, or client.",
    confirmCity: (district, city) => `Is ${district} in ${city}? If it's another city, type its name.`,
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

// ------------------------------------------------------------------ understanding plain words (no model needed)

const AR_DIGITS = (value) => String(value || "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[٫]/g, ".").replace(/[،]/g, "،");
const WORD_NUMBERS = [
  [/واحده?|وحده/, 1], [/اثنين|ثنتين|اثنتين/, 2], [/ثلاث(ه)?/, 3], [/اربع(ه)?/, 4], [/خمس(ه)?/, 5], [/ست(ه)?/, 6], [/سبع(ه)?/, 7], [/ثمان(ي|يه)?/, 8], [/تسع(ه)?/, 9], [/عشر(ه)?/, 10]
];
export const CITIES = Object.freeze([
  "المدينة المنورة", "الرياض", "جدة", "مكة المكرمة", "مكة", "الدمام", "الخبر", "الظهران", "الطائف", "أبها", "خميس مشيط", "تبوك", "بريدة", "عنيزة",
  "حائل", "ينبع", "الأحساء", "الهفوف", "الجبيل", "جازان", "نجران", "الباحة", "عرعر", "سكاكا", "القطيف", "العلا", "القريات", "الخرج", "حفر الباطن"
]);
const CITY_ALIASES = Object.freeze({ "المدينة": "المدينة المنورة", "المدينه": "المدينة المنورة", "المدينه المنوره": "المدينة المنورة", "مكه": "مكة المكرمة", "مكة": "مكة المكرمة", "جده": "جدة" });
const TYPES = [
  [/شقق|شقه|شقة/, "شقة"], [/فيلا|فله|فلة|فيلة/, "فيلا"], [/دوبلكس|دبلكس/, "دوبلكس"], [/(?:^|\s)دور(?:\s|$)/, "دور"], [/ارض|أرض/, "أرض"], [/عماره|عمارة/, "عمارة"],
  [/محل/, "محل تجاري"], [/مكتب(?!\s*عقار)/, "مكتب"], [/استراحه|استراحة/, "استراحة"], [/مستودع/, "مستودع"], [/(?:^|\s)غرفه(?:\s|$)|(?:^|\s)غرفة(?:\s|$)|ملحق/, "غرفة"]
];
const STOP = /^(في|ب|بـ|و|للبيع|للايجار|للإيجار|بسعر|السعر|سعر|مدينه|مدينة|المدينه|الي|إلى|الى|مع|من|عند|قريب|جنب|شارع|طريق)$/;

function countBefore(t, noun, dual) {
  if (new RegExp(dual).test(t)) return 2;
  const m = t.match(new RegExp(`(\\d+|واحده?|وحده|اثنين|ثنتين|ثلاث(?:ه)?|اربع(?:ه)?|خمس(?:ه)?|ست(?:ه)?|سبع(?:ه)?|ثمان(?:ي|يه)?|تسع(?:ه)?|عشر(?:ه)?)\\s*(?:${noun})`));
  if (m) {
    if (/^\d+$/.test(m[1])) return Number(m[1]);
    const hit = WORD_NUMBERS.find(([re]) => re.test(m[1]));
    return hit ? hit[1] : 0;
  }
  return new RegExp(`(?:^|\\s|و)(?:${noun})`).test(t) ? 1 : 0;
}

function priceIn(raw) {
  const t = AR_DIGITS(raw).replace(/,/g, "");
  const scaled = (num, unit) => {
    const n = Number(num);
    if (!(n > 0)) return 0;
    if (/مليون/.test(unit || "")) return Math.round(n * 1_000_000);
    if (/الف|ألف|آلاف|الاف|k/i.test(unit || "")) return Math.round(n * 1000);
    return Math.round(n);
  };
  const half = /مليون\s*(?:و\s*)?(?:نص|نصف)/.test(t) ? 500000 : 0;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(مليون|الف|ألف|آلاف|الاف|k)?/i);
  const keyword = /(سعر|بسعر|ب\s*\d|ميزاني|حدود|السوم|المطلوب|ريال|الف|ألف|مليون)/.test(t);
  if (m && keyword) return scaled(m[1], m[2]) + (m[2] && /مليون/.test(m[2]) ? half : 0);
  if (/^\s*مليون/.test(t)) return 1_000_000 + half;
  return 0;
}

/**
 * The facts a person wrote, in their own words: «عندي شقة غرفتين وصالة ومطبخ صغير ودورة مياه للإيجار السنوي في الوبرة».
 * Only what is written — nothing is guessed. The district is never taken for a city (cities come from a list).
 */
export function extractFacts(raw = "", { expectNumber = "" } = {}) {
  const text0 = AR_DIGITS(raw);
  const t = norm(text0);
  const out = {};
  for (const [re, type] of TYPES) { if (re.test(t)) { out.propertyType = type; break; } }
  if (/للبيع|بيع|ابيع|نبيع|للشراء|شراء|اشتري|نشتري|تمليك/.test(t)) out.transactionType = "sale";
  if (/ايجار|للايجار|تاجير|اوجر|نوجر|استاجر|نستاجر|استئجار/.test(t)) out.transactionType = "rent";
  if (out.transactionType === "rent") {
    if (/سنوي|سنويا|بالسنه/.test(t)) out.rentPeriod = "YEARLY";
    else if (/شهري|شهريا|بالشهر/.test(t)) out.rentPeriod = "MONTHLY";
  }
  const rooms = countBefore(t, "غرف(?:ه)?(?:\\s*نوم)?|غرفه نوم", "غرفتين|غرفتان");
  if (rooms && !(out.propertyType === "غرفة" && rooms === 1 && !/غرفتين|\d\s*غرف/.test(t))) out.rooms = rooms;
  const halls = countBefore(t, "صالات|صاله|مجلس", "صالتين|مجلسين");
  if (halls) out.halls = halls;
  const baths = countBefore(t, "دورات مياه|دوره مياه|دورة مياه|حمامات|حمام", "دورتين مياه|دورتين|حمامين");
  if (baths) out.bathrooms = baths;
  const kitchen = t.match(/مطبخ(?:\s+(صغير|كبير|واسع|راكب|مجهز|امريكي|مفتوح))?/);
  if (kitchen) out.kitchen = kitchen[1] || "موجود";
  if (/مؤثث|مفروش|موثث/.test(t)) out.furnished = true;
  if (/مصعد|اسانسير/.test(t)) out.elevator = true;
  if (/موقف|مواقف|باركنج/.test(t)) out.parking = true;
  const area = text0.match(/(\d+(?:\.\d+)?)\s*(?:م2|م²|متر|مترمربع|م\b|مربع)/);
  if (area) out.area = Number(area[1]);
  const price = priceIn(text0);
  if (price) out.price = price;
  else if (expectNumber === "price") {
    const bare = AR_DIGITS(raw).replace(/,/g, "").match(/^\s*(\d+(?:\.\d+)?)\s*(مليون|الف|ألف|k)?\s*(ريال)?\s*$/i);
    if (bare) out.price = bare[2] ? (/مليون/.test(bare[2]) ? Number(bare[1]) * 1_000_000 : Number(bare[1]) * 1000) : Number(bare[1]);
  }
  // City: only a known city name. District: after «حي», or after «في/ب» when it is not a city.
  for (const city of CITIES) { if (t.includes(norm(city))) { out.city = city; break; } }
  if (!out.city) for (const [alias, city] of Object.entries(CITY_ALIASES)) { if (new RegExp(`(?:^|\\s|ب|في\\s)${norm(alias)}(?:\\s|$)`).test(t)) { out.city = city; break; } }
  const words = text0.replace(/[،,.!؟?]/g, " ").split(/\s+/).filter(Boolean);
  const take = (start) => {
    const picked = [];
    for (let i = start; i < words.length && picked.length < 2; i += 1) {
      const w = words[i];
      if (STOP.test(norm(w)) || CITIES.some((c) => norm(c).startsWith(norm(w)))) break;
      if (picked.length === 1 && !/^ال/.test(norm(w)) && !/^(ابو|أبو|ام|أم|بن)$/.test(norm(picked[0]))) break;
      picked.push(w);
    }
    return picked.join(" ");
  };
  const hay = words.findIndex((w) => /^(حي|بحي|الحي)$/.test(norm(w)));
  let district = hay >= 0 ? take(hay + 1) : "";
  if (!district) {
    for (let i = 0; i < words.length - 1; i += 1) {
      if (/^(في|فى)$/.test(norm(words[i])) && /^ال/.test(norm(words[i + 1]))) {
        const candidate = take(i + 1);
        const isCity = CITIES.some((c) => norm(c).startsWith(norm(candidate))) || CITY_ALIASES[norm(candidate)] || CITY_ALIASES[candidate];
        if (candidate && !isCity && !/^(الايجار|البيع|الشراء|حدود|السنه|الشهر)/.test(norm(candidate))) { district = candidate; break; }
      }
    }
  }
  if (!district && expectNumber === "district") {
    const one = text0.trim().replace(/^حي\s+/, "");
    if (one && one.split(/\s+/).length <= 3 && !/\d/.test(one) && !CITIES.some((c) => norm(c) === norm(one))) district = one;
  }
  if (district) out.district = district.replace(/^حي\s+/, "");
  if (!out.city && expectNumber === "city") {
    const one = text0.trim();
    const alias = CITY_ALIASES[norm(one)] || CITY_ALIASES[one];
    if (alias) out.city = alias;
    else if (one && one.split(/\s+/).length <= 3 && !/\d/.test(one)) out.city = one;
  }
  if (expectNumber === "propertyType" && !out.propertyType) {
    const one = text0.trim();
    if (one && one.split(/\s+/).length <= 2) out.propertyType = one.slice(0, 40);
  }
  return out;
}

/** The person said who they are in words («أنا مالك»، «عندي شقة للإيجار»، «أدور شقة») — or "" when it is not clear. */
export function personaFromText(raw = "") {
  const t = norm(raw);
  if (/(^|\s)(وسيط|مسوق|مسوقه|مكتب عقار|وسيطه)(\s|$)/.test(t)) return PERSONA.BROKER;
  if (/(^|\s)(مالك|المالك|صاحب العقار|صاحب الملك)(\s|$)|(^|\s)(عندي|املك|ابيع|ابي ابيع|ابغى ابيع|ابي اجر|ابغى اجر|اوجر|ابي اوجر)(\s|$)/.test(t)) return PERSONA.OWNER;
  if (/(^|\s)(عميل|مستاجر|مشتري)(\s|$)|(ابحث|ادور|دور لي|ابي اشتري|ابغى اشتري|ابي استاجر|ابغى استاجر|محتاج|احتاج|ابي|ابغى|ابغا)\s/.test(t)) return PERSONA.CLIENT;
  return "";
}

export function isYes(raw = "") {
  return /^(نعم|ايوه|ايه|اي|ايوا|ايوة|صح|صحيح|تمام|اكيد|بالضبط|هي|هو|yes|yeah|yep|correct)(?=[\s!.،,]|$)/.test(norm(raw).trim());
}

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
  if (out.kind) {
    // An offer stays an offer and a request a request: a purpose of the other kind is read as its meaning
    // (rent / sale) for THIS kind, never taken as is.
    const allowed = out.kind === "OFFER" ? ["SALE", "RENT"] : ["PURCHASE", "LEASE_REQUEST"];
    const given = String(found.purpose || "").toUpperCase();
    const meaning = /RENT|LEASE/.test(given) ? "rent" : /SALE|PURCHASE/.test(given) ? "sale" : "";
    const purpose = allowed.includes(given) ? given : purposeFrom(out.kind, found.transactionType || meaning);
    if (allowed.includes(purpose)) set("purpose", purpose);
  }
  set("halls", Number(found.halls) || 0);
  set("bathrooms", Number(found.bathrooms) || 0);
  set("kitchen", String(found.kitchen || "").trim().slice(0, 30));
  if (/^(YEARLY|MONTHLY)$/.test(String(found.rentPeriod || ""))) out.rentPeriod = found.rentPeriod;
  for (const flag of ["furnished", "elevator", "parking"]) if (found[flag] === true) out[flag] = true;
  // A district is never also the city (the model or a reply may mix them up).
  if (out.city && out.district && norm(out.city) === norm(out.district)) delete out.city;
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

/** The details beyond the main fields, in words (also kept in the record's description). */
export function detailLines(draft = {}, lang = "ar") {
  const ar = lang !== "en";
  const count = (n, one, two, many) => (n === 1 ? one : n === 2 ? two : `${n} ${many}`);
  return [
    draft.halls ? (ar ? count(draft.halls, "صالة", "صالتان", "صالات") : `${draft.halls} living room(s)`) : "",
    draft.kitchen ? (ar ? (draft.kitchen === "موجود" ? "مطبخ" : `مطبخ ${draft.kitchen}`) : `kitchen${draft.kitchen === "موجود" ? "" : ` (${draft.kitchen})`}`) : "",
    draft.bathrooms ? (ar ? count(draft.bathrooms, "دورة مياه واحدة", "دورتا مياه", "دورات مياه") : `${draft.bathrooms} bathroom(s)`) : "",
    draft.furnished ? (ar ? "مؤثث" : "furnished") : "",
    draft.elevator ? (ar ? "مصعد" : "elevator") : "",
    draft.parking ? (ar ? "موقف" : "parking") : ""
  ].filter(Boolean);
}

export function summaryLines(draft = {}, lang = "ar") {
  const ar = lang !== "en";
  const rentWord = draft.rentPeriod === "YEARLY" ? (ar ? " سنوي" : " (yearly)") : draft.rentPeriod === "MONTHLY" ? (ar ? " شهري" : " (monthly)") : "";
  const purpose = { SALE: ar ? "للبيع" : "for sale", RENT: (ar ? "للإيجار" : "for rent") + rentWord, PURCHASE: ar ? "للشراء" : "to buy", LEASE_REQUEST: (ar ? "للاستئجار" : "to rent") + rentWord }[draft.purpose] || "";
  const price = draft.price ? Number(draft.price).toLocaleString("en-US") : "";
  const details = detailLines(draft, lang);
  return [
    draft.kind ? (ar ? `النوع: ${draft.kind === "OFFER" ? "عرض عقار" : "طلب عقار"}` : `Type: ${draft.kind === "OFFER" ? "property listing" : "property request"}`) : "",
    `${draft.propertyType || ""} ${purpose}`.trim(),
    [draft.district, draft.city].filter(Boolean).join(ar ? "، " : ", "),
    price ? `${draft.kind === "REQUEST" ? (ar ? "الميزانية" : "Budget") : (ar ? "السعر" : "Price")}: ${price}` : "",
    draft.area ? `${ar ? "المساحة" : "Area"}: ${draft.area}` : "",
    draft.rooms ? `${ar ? "الغرف" : "Rooms"}: ${draft.rooms}` : "",
    details.length ? `${ar ? "التفاصيل" : "Details"}: ${details.join(ar ? "، " : ", ")}` : ""
  ].filter(Boolean).map((line) => `• ${line}`);
}

/** The record input the office's own save path validates (same rules as the app). */
export function toRecordInput(draft = {}, { phone = "", name = "" } = {}) {
  return {
    kind: draft.kind, purpose: draft.purpose, propertyType: draft.propertyType, city: draft.city, district: draft.district,
    price: draft.price, area: draft.area || "", rooms: draft.rooms || "", contactName: String(name || "").slice(0, 80), contactPhone: phone,
    // Every detail the person gave stays in the record's description (nothing is lost, nothing added).
    notes: [detailLines(draft).join("، "), draft.rentPeriod === "YEARLY" ? "إيجار سنوي" : draft.rentPeriod === "MONTHLY" ? "إيجار شهري" : "", draft.notes || ""].filter(Boolean).join(" — ").slice(0, 1000)
  };
}
