/**
 * «غرفة التفاوض» — one room per deal (one property, one owner, one client, one broker).
 *
 * The room has three parts: بيانات العقار · ما تم الاتفاق عليه · المالك مقابل العميل.
 * What is shown and what can be negotiated is decided by RULES, per property family and per
 * deal kind (بيع / إيجار) — never one fixed form for every property:
 *
 *   family   UNIT (شقة، دور، غرفة) · VILLA (فيلا، دوبلكس، استراحة) · LAND (أرض)
 *            BUILDING (عمارة) · COMMERCIAL (محل، مكتب، مستودع) · OTHER
 *   terms    «بنود» with fixed options. One side proposes an option, the other accepts,
 *            rejects or proposes another. A proposal is NOT an agreement: a term enters
 *            «ما تم الاتفاق عليه» only when the other side accepts it, with the time and who
 *            accepted. A later change needs a new agreement; the old one stays in the timeline.
 *
 * Adding a property type or a term is one entry in the tables below.
 * Pure: the Worker validates and applies every move with these same rules.
 */

import { cleanText, formatArea, formatDateTime, formatPrice, toDate, toNumber } from "./format-domain.js";
import { ROLE_LABEL, SESSION_ROLE, availableActions, isOpenJourney, roomMoveText } from "./session-domain.js";

export { roomMoveText };
import { PHASE, agreedItems, agreedPriceOf, journeyPhase } from "./deal-flow-domain.js";

export const FAMILY = Object.freeze({ UNIT: "UNIT", VILLA: "VILLA", LAND: "LAND", BUILDING: "BUILDING", COMMERCIAL: "COMMERCIAL", OTHER: "OTHER" });

export const FAMILY_LABEL = Object.freeze({
  UNIT: "وحدة سكنية", VILLA: "فيلا", LAND: "أرض", BUILDING: "عمارة", COMMERCIAL: "عقار تجاري", OTHER: "عقار"
});

function norm(value) {
  return String(value || "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ًٌٍَُِّْـ]/g, "").trim();
}

/**
 * Word → family. The FIRST word of the type that is recognised decides, so «شقة دور أرضي» is a
 * unit and «أرض تجارية» is a land. Land words must match a whole word («أرضي» is not a land).
 * A new type only needs a word here.
 */
const FAMILY_WORDS = Object.freeze([
  [FAMILY.LAND, ["ارض", "اراضي", "مخطط", "قطعه"], true],
  [FAMILY.BUILDING, ["عماره", "عمائر", "برج", "بنايه", "مجمع"], false],
  [FAMILY.COMMERCIAL, ["محل", "مكتب", "مستودع", "معرض", "ورشه", "هنجر"], false],
  [FAMILY.VILLA, ["فيلا", "فله", "دوبلكس", "دبلكس", "استراحه", "قصر", "بيت", "شاليه", "مزرعه"], false],
  [FAMILY.UNIT, ["شقه", "دور", "غرفه", "استوديو", "استديو", "روف", "ملحق"], false]
]);

export function propertyFamily(propertyType) {
  const tokens = norm(propertyType).split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const bare = token.replace(/^ال/, "");
    for (const [family, words, whole] of FAMILY_WORDS) {
      if (words.some((word) => (whole ? bare === word : bare.startsWith(word)))) return family;
    }
  }
  return FAMILY.OTHER;
}

/** "rent" for RENT / LEASE_REQUEST, otherwise "sale". */
export function dealKind(journey = {}) {
  const purpose = String(journey.offerSummary?.purpose || journey.requestSummary?.purpose || journey.purpose || "").toUpperCase();
  return purpose === "RENT" || purpose === "LEASE_REQUEST" ? "rent" : "sale";
}

export const DEAL_LABEL = Object.freeze({ sale: "بيع", rent: "إيجار" });

// ------------------------------------------------------------------ terms (البنود)

const opt = (id, label) => Object.freeze({ id, label });

/** Every negotiable term. `options(deal)` may depend on the deal kind. */
const TERM_CATALOG = Object.freeze({
  payment_method: { label: "طريقة الدفع", options: () => [opt("cash", "نقدًا"), opt("bank", "تمويل بنكي"), opt("mixed", "جزء نقدًا والباقي تمويل")] },
  transfer_time: { label: "موعد الإفراغ", options: () => [opt("immediate", "فور اكتمال المبلغ"), opt("two_weeks", "خلال أسبوعين"), opt("month", "خلال شهر"), opt("two_months", "خلال شهرين")] },
  handover: { label: "تاريخ الاستلام", options: () => [opt("immediate", "فوري"), opt("two_weeks", "خلال أسبوعين"), opt("month", "خلال شهر"), opt("two_months", "خلال شهرين")] },
  rent_payments: { label: "دفعات الإيجار", options: () => [opt("one", "دفعة واحدة"), opt("two", "دفعتان"), opt("four", "أربع دفعات"), opt("monthly", "شهريًا")] },
  lease_term: { label: "مدة العقد", options: () => [opt("six_months", "ستة أشهر"), opt("one_year", "سنة"), opt("two_years", "سنتان"), opt("three_years", "ثلاث سنوات")] },
  deposit: { label: "مبلغ التأمين", options: () => [opt("none", "بدون تأمين"), opt("five_percent", "5% من الإيجار"), opt("one_month", "إيجار شهر")] },
  furniture: { label: "الأثاث والمكيفات", options: () => [opt("included", "يشملها"), opt("kitchen_ac", "المطبخ والمكيفات فقط"), opt("excluded", "لا يشملها")] },
  land_pricing: { label: "أساس السعر", options: () => [opt("total", "سعر إجمالي للأرض"), opt("per_meter", "حسب سعر المتر")] },
  land_use: { label: "طبيعة الاستخدام", options: () => [opt("residential", "سكني"), opt("commercial", "تجاري"), opt("mixed", "سكني تجاري"), opt("investment", "استثماري")] },
  occupancy: { label: "حالة الإشغال عند التسليم", options: () => [opt("vacant", "خالية"), opt("with_tenants", "مع المستأجرين الحاليين")] },
  income_statement: { label: "بيان الدخل والعقود", options: () => [opt("before_viewing", "يُقدَّم قبل المعاينة"), opt("after_agreement", "يُقدَّم بعد الاتفاق المبدئي")] },
  activity_license: { label: "متطلبات رخصة النشاط", options: () => [opt("tenant", "على المستأجر"), opt("owner_supports", "المالك يوفّر المتطلبات")] },
  commission: {
    label: "السعي",
    options: (deal) => (deal === "rent"
      ? [opt("tenant", "على المستأجر"), opt("owner", "على المالك"), opt("split", "مناصفة")]
      : [opt("buyer", "على المشتري"), opt("owner", "على المالك"), opt("split", "مناصفة")])
  }
});

/** Which terms a room offers, in order, per family and deal kind. Rent terms never appear in a sale and vice versa. */
const TERM_SETS = Object.freeze({
  UNIT: { sale: ["payment_method", "transfer_time", "handover", "furniture", "commission"], rent: ["rent_payments", "lease_term", "handover", "deposit", "furniture", "commission"] },
  VILLA: { sale: ["payment_method", "transfer_time", "handover", "furniture", "commission"], rent: ["rent_payments", "lease_term", "handover", "deposit", "furniture", "commission"] },
  LAND: { sale: ["land_pricing", "payment_method", "transfer_time", "land_use", "commission"], rent: ["lease_term", "rent_payments", "land_use", "commission"] },
  BUILDING: { sale: ["payment_method", "transfer_time", "occupancy", "income_statement", "commission"], rent: ["lease_term", "rent_payments", "handover", "commission"] },
  COMMERCIAL: { sale: ["payment_method", "transfer_time", "occupancy", "commission"], rent: ["rent_payments", "lease_term", "handover", "deposit", "activity_license", "commission"] },
  OTHER: { sale: ["payment_method", "transfer_time", "handover", "commission"], rent: ["rent_payments", "lease_term", "handover", "commission"] }
});

/** «طلب معلومات»: fixed topics per family. The request goes to the broker, never to the other side. */
const INFO_TOPICS = Object.freeze({
  UNIT: [opt("age", "عمر العقار"), opt("floor", "الدور والمصعد"), opt("parking", "المواقف"), opt("services", "الخدمات والفواتير"), opt("photos", "صور إضافية")],
  VILLA: [opt("age", "عمر العقار"), opt("built_area", "مساحة البناء والأدوار"), opt("rooms", "تفاصيل الغرف"), opt("warranties", "الضمانات"), opt("photos", "صور إضافية")],
  LAND: [opt("plan", "رقم المخطط والقطعة"), opt("dimensions", "الأطوال والشوارع"), opt("deed", "الصك والرهن"), opt("utilities", "الخدمات الواصلة"), opt("location", "الموقع على الخريطة")],
  BUILDING: [opt("units", "عدد الوحدات"), opt("income", "الدخل السنوي"), opt("occupancy", "حالة الإشغال"), opt("age", "عمر العمارة"), opt("contracts", "العقود الحالية")],
  COMMERCIAL: [opt("frontage", "المساحة والواجهة"), opt("activity", "النشاط المسموح"), opt("parking", "المواقف"), opt("fees", "الرسوم والخدمات"), opt("photos", "صور إضافية")],
  OTHER: [opt("age", "عمر العقار"), opt("details", "تفاصيل إضافية"), opt("deed", "الصك"), opt("photos", "صور إضافية")]
});

/** The rules of one room: what is shown and what can be negotiated for this property and deal. */
export function roomSchema(journey = {}) {
  const family = propertyFamily(journey.offerSummary?.propertyType || journey.requestSummary?.propertyType);
  const deal = dealKind(journey);
  const terms = (TERM_SETS[family] || TERM_SETS.OTHER)[deal].map((id) => ({ id, label: TERM_CATALOG[id].label, options: TERM_CATALOG[id].options(deal) }));
  return {
    family, familyLabel: FAMILY_LABEL[family], deal, dealLabel: DEAL_LABEL[deal],
    priceLabel: deal === "rent" ? "الإيجار السنوي" : family === FAMILY.LAND ? "السعر الإجمالي" : "السعر",
    viewingLabel: family === FAMILY.LAND ? "زيارة الموقع" : "المعاينة",
    terms,
    infoTopics: INFO_TOPICS[family] || INFO_TOPICS.OTHER
  };
}

export function termDefinition(journey, termId) {
  return roomSchema(journey).terms.find((term) => term.id === String(termId || "")) || null;
}

// ------------------------------------------------------------------ بيانات العقار

/**
 * The facts shown at the top of the room — only what fits this kind of property and only
 * what is actually known. Returns [{ id, label, value, icon, strong }].
 */
export function propertyFacts(journey = {}) {
  const offer = journey.offerSummary || {};
  const schema = roomSchema(journey);
  const facts = [];
  const add = (id, icon, label, value, strong = false) => { if (value) facts.push({ id, icon, label, value: String(value), strong }); };
  add("type", "home", "نوع العقار", cleanText(offer.propertyType, 40) || "عقار");
  add("deal", "tag", "نوع المعاملة", schema.dealLabel);
  const district = cleanText(offer.district, 80);
  add("place", "pin", "الموقع", [cleanText(offer.city, 60), district ? (district.startsWith("حي") ? district : `حي ${district}`) : ""].filter(Boolean).join(" - "));
  const price = toNumber(offer.price);
  add("price", "coins", schema.deal === "rent" ? "الإيجار السنوي المطلوب" : "السعر المطلوب", price ? formatPrice(price) : "", true);
  const area = toNumber(offer.area);
  add("area", "area", schema.family === FAMILY.LAND ? "مساحة الأرض" : "المساحة", area ? formatArea(area) : "");
  // Per-metre price matters for land and commercial sales only.
  if (schema.deal === "sale" && (schema.family === FAMILY.LAND || schema.family === FAMILY.COMMERCIAL) && price && area) {
    add("per_meter", "coins", "سعر المتر", formatPrice(Math.round(price / area)));
  }
  // Rooms describe a home, not a land, a building or a shop.
  const rooms = toNumber(offer.rooms);
  if ((schema.family === FAMILY.UNIT || schema.family === FAMILY.VILLA) && rooms) add("rooms", "bed", "الغرف", `${rooms}`);
  return facts;
}

// ------------------------------------------------------------------ term state

export const TERM_STATE = Object.freeze({ NONE: "NONE", PENDING: "PENDING", AGREED: "AGREED" });
/** How many times a side may change its own proposal on a term before the other side answers. */
export const MAX_PROPOSAL_REVISIONS = 2;
export const ROOM_ACTIONS = Object.freeze({
  term_propose: "term_propose", term_accept: "term_accept", term_reject: "term_reject",
  info_request: "info_request", ready: "ready"
});

function otherRole(role) {
  return role === SESSION_ROLE.OWNER ? SESSION_ROLE.CLIENT : SESSION_ROLE.OWNER;
}

function termsOf(journey = {}) {
  const terms = journey.session?.terms;
  return terms && typeof terms === "object" ? terms : {};
}

function isParty(role) {
  return role === SESSION_ROLE.OWNER || role === SESSION_ROLE.CLIENT;
}

/** Terms and info requests can move while the deal is open and not paused. */
export function roomIsLive(journey = {}) {
  return isOpenJourney(journey) && String(journey.status || "").toUpperCase() !== "PAUSED";
}

function labelOf(term, optionId) {
  return term.options.find((option) => option.id === optionId)?.label || "";
}

/**
 * One row per term for a viewer ("owner" | "client" | "broker").
 * { id, label, options, state, agreed, pending, rejected, mine, actions }
 *   actions ⊆ accept | reject | propose   (empty for the broker and when the room is not live)
 *   proposeLabel: «اقتراح» · «اقتراح آخر» · «تعديل الاقتراح» · «طلب تعديل»
 */
export function termRows(journey = {}, viewer = "broker") {
  const saved = termsOf(journey);
  const live = roomIsLive(journey);
  return roomSchema(journey).terms.map((term) => {
    const entry = saved[term.id] || {};
    const agreed = entry.agreed?.option && labelOf(term, entry.agreed.option)
      ? { option: entry.agreed.option, label: labelOf(term, entry.agreed.option), at: entry.agreed.at || null, acceptedBy: entry.agreed.acceptedBy || "", proposedBy: entry.agreed.proposedBy || "" } : null;
    const pending = entry.pending?.option && labelOf(term, entry.pending.option) && isParty(entry.pending.by)
      ? { option: entry.pending.option, label: labelOf(term, entry.pending.option), by: entry.pending.by, at: entry.pending.at || null, revisions: Number(entry.pending.revisions || 0) } : null;
    const rejected = !pending && entry.rejected?.option && labelOf(term, entry.rejected.option)
      ? { option: entry.rejected.option, label: labelOf(term, entry.rejected.option), by: entry.rejected.by || "", proposedBy: entry.rejected.proposedBy || "", at: entry.rejected.at || null } : null;
    const state = pending ? TERM_STATE.PENDING : agreed ? TERM_STATE.AGREED : TERM_STATE.NONE;
    const mine = Boolean(pending && pending.by === viewer);
    let actions = [];
    let proposeLabel = "اقتراح";
    if (live && isParty(viewer)) {
      if (pending && !mine) { actions = ["accept", "reject", "propose"]; proposeLabel = "اقتراح آخر"; }
      else if (pending && mine) { actions = pending.revisions >= MAX_PROPOSAL_REVISIONS ? [] : ["propose"]; proposeLabel = "تعديل الاقتراح"; }
      else { actions = ["propose"]; proposeLabel = agreed ? "طلب تعديل" : "اقتراح"; }
    }
    // Options that would change nothing are not offered.
    const skip = pending ? pending.option : agreed ? agreed.option : "";
    const options = term.options.filter((option) => option.id !== skip);
    return { id: term.id, label: term.label, options, allOptions: term.options, state, agreed, pending, rejected, mine, actions, proposeLabel };
  });
}

export function pendingTerms(journey = {}) {
  return termRows(journey, "broker").filter((row) => row.pending);
}

/**
 * Validate one term move and build the new terms map.
 * Returns { ok:false, code, message } or
 *         { ok:true, terms, applied: { move, termId, termLabel, option, optionLabel, prevState, nextState, agreed } }.
 */
export function planTermAction(journey = {}, { role, action, termId, optionId = "", now = new Date() } = {}) {
  const fail = (code, message) => ({ ok: false, code, message });
  if (!isParty(role)) return fail("role_invalid", "هذا الإجراء للمالك أو العميل فقط");
  if (!roomIsLive(journey)) return fail("room_not_live", "غرفة التفاوض متوقفة حاليًا");
  const term = termDefinition(journey, termId);
  if (!term) return fail("term_unknown", "هذا البند غير متاح لهذا العقار");
  const row = termRows(journey, role).find((item) => item.id === term.id);
  const at = now.toISOString();
  const saved = termsOf(journey);
  const entry = { ...(saved[term.id] || {}) };
  const prevState = row.state;
  let applied;
  if (action === ROOM_ACTIONS.term_propose) {
    const label = labelOf(term, String(optionId || ""));
    if (!label) return fail("option_unknown", "اختر أحد الخيارات المتاحة");
    if (row.pending && row.pending.option === optionId) return fail("term_unchanged", row.mine ? "هذا هو اقتراحك الحالي" : "هذا هو الاقتراح المطروح — اقبله أو اقترح غيره");
    if (!row.pending && row.agreed && row.agreed.option === optionId) return fail("term_unchanged", "هذا هو المتفق عليه حاليًا");
    // A side may change its own unanswered proposal a few times only; then it waits for the answer.
    const revisions = row.mine ? Number(entry.pending?.revisions || 0) + 1 : 0;
    if (revisions > MAX_PROPOSAL_REVISIONS) return fail("term_wait_for_answer", "عدّلت اقتراحك أكثر من مرة — انتظر رد الطرف الآخر عليه أولًا");
    // The agreed value (if any) stays in force until the other side accepts the new one.
    entry.pending = { option: optionId, by: role, at, revisions };
    entry.rejected = null;
    applied = { move: action, option: optionId, optionLabel: label, nextState: TERM_STATE.PENDING, agreed: false, replaces: row.agreed ? row.agreed.label : "", revision: revisions > 0 };
  } else if (action === ROOM_ACTIONS.term_accept || action === ROOM_ACTIONS.term_reject) {
    if (!row.pending || row.mine) return fail(action === ROOM_ACTIONS.term_accept ? "term_nothing_to_accept" : "term_nothing_to_reject", "لا يوجد اقتراح من الطرف الآخر على هذا البند");
    // The answer names the option the side actually saw: if the proposal changed meanwhile, nothing is accepted or rejected.
    if (String(optionId || "") !== row.pending.option) return fail("term_changed", "تغيّر الاقتراح على هذا البند — راجع الاقتراح الحالي ثم أجب");
  }
  if (action === ROOM_ACTIONS.term_propose) {
    // built above
  } else if (action === ROOM_ACTIONS.term_accept) {
    // An agreement needs both: one proposed, the other accepted.
    entry.agreed = { option: row.pending.option, at, proposedBy: row.pending.by, acceptedBy: role, proposedAt: row.pending.at };
    entry.pending = null;
    entry.rejected = null;
    applied = { move: action, option: row.pending.option, optionLabel: row.pending.label, nextState: TERM_STATE.AGREED, agreed: true, replaces: row.agreed && row.agreed.option !== row.pending.option ? row.agreed.label : "" };
  } else if (action === ROOM_ACTIONS.term_reject) {
    entry.rejected = { option: row.pending.option, proposedBy: row.pending.by, by: role, at };
    entry.pending = null;
    applied = { move: action, option: row.pending.option, optionLabel: row.pending.label, nextState: row.agreed ? TERM_STATE.AGREED : TERM_STATE.NONE, agreed: false, replaces: "" };
  } else {
    return fail("action_unknown", "إجراء غير معروف");
  }
  return { ok: true, terms: { ...saved, [term.id]: entry }, applied: { ...applied, termId: term.id, termLabel: term.label, prevState } };
}

// ------------------------------------------------------------------ ما تم الاتفاق عليه

function metaOf(acceptedBy, at, now) {
  const who = ROLE_LABEL[acceptedBy] ? `وافق ${ROLE_LABEL[acceptedBy]}` : "";
  const when = toDate(at) ? formatDateTime(at, now) : "";
  return [who, when].filter(Boolean).join(" · ");
}

/**
 * «ما تم الاتفاق عليه» — the live summary: only what both sides actually agreed, each with
 * who accepted and when. A proposal waiting for an answer is never listed here.
 * [{ id, label, value, meta, changing }] — `changing` = a change was proposed and is waiting.
 */
export function roomAgreedItems(journey = {}, now = new Date()) {
  const session = journey.session || {};
  const schema = roomSchema(journey);
  const items = [];
  for (const item of agreedItems(journey, now)) {
    if (item.id === "price") {
      const acceptedBy = session.lastMove?.move === "accept" || session.lastMove?.move === "accept_fixed" ? session.lastMove.role : "";
      items.push({ id: "price", label: schema.deal === "rent" ? "الإيجار السنوي المتفق عليه" : item.label, value: item.value, meta: metaOf(acceptedBy, session.agreedAt, now), changing: "" });
    } else if (item.id === "viewing") {
      items.push({ id: "viewing", label: item.label.replace("المعاينة", schema.viewingLabel), value: item.value, meta: journey.viewing?.confirmedBy === "parties" ? "باتفاق الطرفين" : journey.viewing?.confirmedBy ? "أكّده الوسيط" : "", changing: "" });
    } else items.push({ ...item, meta: "", changing: "" });
  }
  for (const row of termRows(journey, "broker")) {
    if (!row.agreed) continue;
    items.push({ id: `term:${row.id}`, label: row.label, value: row.agreed.label, meta: metaOf(row.agreed.acceptedBy, row.agreed.at, now), changing: row.pending ? `طلب ${ROLE_LABEL[row.pending.by]} تعديله إلى «${row.pending.label}» — لم يُقبل بعد` : "" });
  }
  const ready = readiness(journey);
  if (ready.both) items.push({ id: "ready", label: "جاهزية الطرفين", value: "المالك والعميل جاهزان للاتفاق النهائي", meta: toDate(ready.at) ? formatDateTime(ready.at, now) : "", changing: "" });
  return items;
}

// ------------------------------------------------------------------ جاهز للاتفاق

export function readiness(journey = {}) {
  const session = journey.session || {};
  const ready = session.ready || {};
  // «جاهز» is about the price agreed NOW: a readiness given before the current agreement does not count.
  const since = agreedPriceOf(journey) ? toDate(session.agreedAt)?.getTime() || 0 : Infinity;
  const valid = (value) => (toDate(value) && toDate(value).getTime() >= since ? value : null);
  const owner = valid(ready.owner);
  const client = valid(ready.client);
  const both = Boolean(owner && client);
  return { owner, client, both, at: both ? [owner, client].sort().at(-1) : null };
}

/** A side may declare «جاهز للاتفاق» once the price is agreed and no proposal is waiting. */
export function canMarkReady(journey = {}, role = "") {
  if (!isParty(role) || !roomIsLive(journey)) return false;
  if (!agreedPriceOf(journey)) return false;
  if (pendingTerms(journey).length) return false;
  return !readiness(journey)[role];
}

// ------------------------------------------------------------------ طلبات للوسيط

export const REQUEST_KIND = Object.freeze({ INTERVENTION: "intervention", INFO: "info" });
export const REQUEST_KIND_LABEL = Object.freeze({ intervention: "طلب تدخل الوسيط", info: "طلب معلومة" });
export const MAX_OPEN_REQUESTS = 3;
export const MAX_REQUEST_TEXT = 500;

/** What the broker did with a request. The label is what the broker's log shows. */
export const REQUEST_DECISIONS = Object.freeze({
  forward: { id: "forward", label: "مُرِّرت للطرف الآخر كما هي", button: "تمرير للطرف الآخر", needsText: false, to: "other" },
  rephrase: { id: "rephrase", label: "أرسل الوسيط صياغته للطرف الآخر", button: "إعادة صياغتها", needsText: true, to: "other" },
  reply: { id: "reply", label: "ردّ الوسيط على المرسل", button: "الرد على المرسل", needsText: true, to: "sender" },
  dismiss: { id: "dismiss", label: "لم تُمرَّر", button: "عدم التمرير", needsText: false, to: "" },
  handled: { id: "handled", label: "عالجها الوسيط داخل الصفقة", button: "تمت المعالجة", needsText: false, to: "" }
});

export function requestsOf(journey = {}) {
  const list = journey.session?.requests;
  return Array.isArray(list) ? list.filter((item) => item && item.id && isParty(item.role)) : [];
}

export function infoTopicLabel(journey, topicId) {
  return roomSchema(journey).infoTopics.find((topic) => topic.id === String(topicId || ""))?.label || "";
}

/** A request as the broker sees it. */
export function requestView(journey, request = {}) {
  const kind = request.kind === REQUEST_KIND.INFO ? REQUEST_KIND.INFO : REQUEST_KIND.INTERVENTION;
  const decision = REQUEST_DECISIONS[request.decision] || null;
  return {
    id: String(request.id), role: request.role, roleLabel: ROLE_LABEL[request.role], otherLabel: ROLE_LABEL[otherRole(request.role)],
    kind, kindLabel: REQUEST_KIND_LABEL[kind],
    topic: kind === REQUEST_KIND.INFO ? infoTopicLabel(journey, request.topic) || cleanText(request.topicLabel, 60) : "",
    text: cleanText(request.text, MAX_REQUEST_TEXT),
    at: request.at || null,
    open: String(request.status || "OPEN") === "OPEN",
    decision: decision ? decision.id : "", decisionLabel: decision ? decision.label : "",
    handledAt: request.handledAt || null
  };
}

export function openRequests(journey = {}) {
  return requestsOf(journey).filter((item) => String(item.status || "OPEN") === "OPEN").map((item) => requestView(journey, item));
}

/** A side may send a new request while fewer than MAX_OPEN_REQUESTS of its own are waiting. */
export function canSendRequest(journey = {}, role = "") {
  if (!isParty(role) || !isOpenJourney(journey)) return false;
  return requestsOf(journey).filter((item) => item.role === role && String(item.status || "OPEN") === "OPEN").length < MAX_OPEN_REQUESTS;
}

/**
 * Text passed from one side to the other never carries a way to reach the sender directly:
 * phone numbers (any digits script, any separators, split by spaces), links with or without a
 * scheme, e-mail addresses and @handles are removed. Short numbers and prices written with
 * their unit stay readable where possible; when in doubt the number is removed.
 */
export function relaySafeText(text) {
  let out = String(text || "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  out = out
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/(^|\s)@[\w.]+/g, " ")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/gi, " ");
  // Any run of digits and separators holding 7 digits or more is treated as a phone number.
  out = out.replace(/\+?\d(?:[\s().\-–—_/\\,،]*\d){6,}/g, " ");
  // Digits split across words («055123 ثم 4567»): when the message holds 9 digits or more in all, every digit group of 3+ goes.
  if ((out.match(/\d/g) || []).length >= 9) out = out.replace(/\d{3,}/g, " ");
  // Brackets and separators left alone after a number was removed.
  out = out.replace(/(^|\s)[()\[\]{}.,،\-–—_/\\+]+(?=\s|$)/g, " ");
  return cleanText(out.replace(/\s{2,}/g, " "), MAX_REQUEST_TEXT);
}

// ------------------------------------------------------------------ حالة كل طرف

/**
 * What is expected from one side right now.
 * { turn: "ACT" | "WAIT" | "NONE", items: [بنود تنتظر رده], text }
 */
export function partyStatus(journey = {}, role = "", { now = new Date() } = {}) {
  if (!isParty(role)) return { turn: "NONE", items: [], text: "" };
  if (!isOpenJourney(journey)) return { turn: "NONE", items: [], text: "أُغلقت الصفقة" };
  const schema = roomSchema(journey);
  const available = availableActions(journey, role, { now });
  const items = [];
  const main = (available.actions || []).filter((action) => action.group === "main");
  if (!available.waiting && main.length) {
    if (available.phase === "VIEWING" || available.phase === "VIEWING_PICK") items.push(schema.viewingLabel);
    else items.push(schema.priceLabel);
  }
  for (const row of termRows(journey, role)) if (row.pending && !row.mine) items.push(row.label);
  if (items.length) return { turn: "ACT", items, text: `مطلوب رده على: ${items.join("، ")}` };
  const waitingOnOther = partyNeedsAction(journey, otherRole(role), now);
  if (waitingOnOther) return { turn: "WAIT", items: [], text: `بانتظار ${ROLE_LABEL[otherRole(role)]}` };
  const phase = journeyPhase(journey, now);
  if (phase === PHASE.FINAL_AGREEMENT || phase === PHASE.VIEWING || phase === PHASE.VIEWING_RESULT) return { turn: "NONE", items: [], text: "لا شيء مطلوب منه الآن — المتابعة لدى الوسيط" };
  return { turn: "NONE", items: [], text: "لا شيء مطلوب منه الآن" };
}

function partyNeedsAction(journey, role, now) {
  const available = availableActions(journey, role, { now });
  if (!available.waiting && (available.actions || []).some((action) => action.group === "main")) return true;
  return termRows(journey, role).some((row) => row.pending && !row.mine);
}

/** The sides whose answer the deal is waiting for (used for reminders — in the app now, WhatsApp later). */
export function awaitingParties(journey = {}, now = new Date()) {
  if (!roomIsLive(journey)) return [];
  return [SESSION_ROLE.OWNER, SESSION_ROLE.CLIENT].filter((role) => partyNeedsAction(journey, role, now));
}

/** Reminder text for one side, with its private room link. The same text feeds WhatsApp when the API is linked. */
export function reminderText(journey = {}, role = "", url = "", { now = new Date() } = {}) {
  const status = partyStatus(journey, role, { now });
  const offer = journey.offerSummary || {};
  const district = cleanText(offer.district, 80);
  const property = [cleanText(offer.propertyType, 40) || "العقار", district ? `في ${district.startsWith("حي") ? district : `حي ${district}`}` : ""].filter(Boolean).join(" ");
  return [
    "مرحبًا،",
    status.turn === "ACT" ? `بانتظار ردك في غرفة التفاوض على ${property}: ${status.items.join("، ")}.` : `هذا رابط غرفة التفاوض الخاصة بـ ${property}.`,
    url
  ].filter(Boolean).join("\n");
}
