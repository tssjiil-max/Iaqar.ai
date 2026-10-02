/**
 * جلسة التفاوض — one live session per deal (journey), shared by the owner, the
 * client and the broker. Pure: the Worker validates and applies every move with the
 * same rules the pages use to decide which buttons to show.
 *
 * - Owner and client answer only with fixed buttons; the only typed value is a price
 *   (digits). Free text is the broker's alone.
 * - Neither party ever sees the other's name, phone or any personal data: events are
 *   rendered as «المالك» / «العميل» / «الوسيط».
 * - A broker message addressed to one party is invisible to the other.
 */

import { formatDateTime, formatPrice, toDate, toNumber } from "./format-domain.js";
import { PHASE, journeyPhase, phaseInfo } from "./deal-flow-domain.js";

export const SESSION_ROLE = Object.freeze({ OWNER: "owner", CLIENT: "client" });
export const ROLE_LABEL = Object.freeze({ owner: "المالك", client: "العميل", broker: "الوسيط" });

/** The approved deal path — no other stages exist. */
export const SESSION_STAGES = Object.freeze([
  { id: "MATCH", label: "تطابق" },
  { id: "CONTACT", label: "تواصل" },
  { id: "NEGOTIATION", label: "تفاوض" },
  { id: "VIEWING", label: "معاينة" },
  { id: "DOCUMENTS", label: "مستندات" },
  { id: "CLOSING", label: "إغلاق" }
]);

export const MAX_SESSION_PRICE = 1_000_000_000;

function otherRole(role) {
  return role === SESSION_ROLE.OWNER ? SESSION_ROLE.CLIENT : SESSION_ROLE.OWNER;
}

function sessionOf(journey = {}) {
  return journey.session && typeof journey.session === "object" ? journey.session : {};
}

/** Round to a readable amount: nearest 1,000 from 100,000 up, else nearest 10. */
export function roundPrice(value) {
  const n = Number(value) || 0;
  if (n <= 0) return 0;
  return n >= 100000 ? Math.round(n / 1000) * 1000 : Math.round(n / 10) * 10;
}

export function isOpenJourney(journey = {}) {
  const status = String(journey.status || "").toUpperCase();
  return status === "ACTIVE" || status === "PAUSED";
}

/** The deal-path stage shown on the session card — from the single current phase. */
export function sessionStage(journey = {}, now = new Date()) {
  return SESSION_STAGES[phaseInfo(journeyPhase(journey, now)).step]?.id || "NEGOTIATION";
}

export function sessionStageLabel(journey = {}, now = new Date()) {
  return phaseInfo(journeyPhase(journey, now)).stage;
}

/**
 * Prices on the table. Before anyone moves, the owner's asking price and the client's
 * budget from the approved records are the starting points.
 */
export function sessionPrices(journey = {}) {
  const session = sessionOf(journey);
  const prices = session.prices || {};
  const owner = toNumber(prices.owner?.price) || toNumber(journey.offerSummary?.price);
  const client = toNumber(prices.client?.price) || toNumber(journey.requestSummary?.price);
  const lastMove = session.lastMove || null;
  const agreed = toNumber(session.agreedPrice);
  const current = agreed || toNumber(lastMove?.price) || owner || client;
  return { owner, client, current, agreed, lastMove };
}

/**
 * Price moves. `roles`: who may use the move. `price(prices)`: the server-computed
 * price (null when the move carries a typed price).
 */
export const PRICE_MOVES = Object.freeze({
  accept: { id: "accept", label: "موافق", icon: "check-circle", roles: ["owner", "client"], price: (p, role) => p[otherRole(role)] },
  minus2: { id: "minus2", label: "أقل 2%", icon: "chev-down", roles: ["client"], pct: -2, price: (p) => roundPrice(p.owner * 0.98) },
  minus5: { id: "minus5", label: "أقل 5%", icon: "chev-down", roles: ["client"], pct: -5, price: (p) => roundPrice(p.owner * 0.95) },
  plus2: { id: "plus2", label: "أعلى 2%", icon: "chev-up", roles: ["owner"], pct: 2, price: (p) => roundPrice(p.client * 1.02) },
  plus5: { id: "plus5", label: "أعلى 5%", icon: "chev-up", roles: ["owner"], pct: 5, price: (p) => roundPrice(p.client * 1.05) },
  compromise: { id: "compromise", label: "حل وسط", icon: "swap", roles: ["owner", "client"], price: (p) => roundPrice((p.owner + p.client) / 2) },
  manual: { id: "manual", label: "إدخال سعر", icon: "edit", roles: ["owner", "client"], typed: true, secondary: true, price: () => null },
  to_broker: { id: "to_broker", label: "إرسال السعر للوسيط", icon: "send", roles: ["owner", "client"], typed: true, secondary: true, private: true, price: () => null }
});

export const OTHER_ACTIONS = Object.freeze({
  intervention: { id: "intervention", label: "تدخل الوسيط", icon: "alert", secondary: true },
  reject: { id: "reject", label: "رفض", icon: "x-circle" },
  accept_fixed: { id: "accept_fixed", label: "موافق على السعر", icon: "check-circle" },
  decline_fixed: { id: "decline_fixed", label: "غير موافق", icon: "x-circle" },
  viewing_pick: { id: "viewing_pick", label: "اختر موعد المعاينة", icon: "calendar", typed: "slot" },
  viewing_ok: { id: "viewing_ok", label: "الموعد مناسب", icon: "check-circle" },
  viewing_other: { id: "viewing_other", label: "اقترح موعدًا آخر", icon: "calendar", typed: "slot" }
});

/** Quick moves behind «تعديل العرض» (the approved ±2/5%, compromise and typed prices). */
const ADJUST_ORDER = ["minus2", "minus5", "plus2", "plus5", "compromise", "manual", "to_broker"];

function roleOther(role) {
  return role === SESSION_ROLE.OWNER ? SESSION_ROLE.CLIENT : SESSION_ROLE.OWNER;
}

/**
 * What this party may do right now — only the step that is open for them.
 * Returns { phase, dealPhase, waiting, note, actions: [{ id, label, icon, price, typed, group, secondary }] }.
 *   group "main"   → the few visible buttons (قبول / تعديل العرض / رفض, or the viewing answers)
 *   group "adjust" → the quick price moves shown after «تعديل العرض»
 */
export function availableActions(journey = {}, role = "", { now = new Date() } = {}) {
  if (role !== SESSION_ROLE.OWNER && role !== SESSION_ROLE.CLIENT) return { phase: "NONE", actions: [], note: "" };
  if (!isOpenJourney(journey)) return { phase: "CLOSED", dealPhase: PHASE.CLOSED, actions: [], note: "أُغلقت هذه الصفقة، ويبقى سجل التفاوض للاطلاع." };
  const intervention = { ...OTHER_ACTIONS.intervention };
  const dealPhase = journeyPhase(journey, now);
  if (String(journey.status || "").toUpperCase() === "PAUSED") {
    return { phase: "PAUSED", dealPhase, waiting: true, actions: [intervention], note: "الصفقة متوقفة مؤقتًا لدى الوسيط." };
  }
  const base = { dealPhase };
  const viewing = journey.viewing || {};
  const at = toDate(viewing.at);
  if (dealPhase === PHASE.FINAL_AGREEMENT) {
    return { ...base, phase: "DOCUMENTS", waiting: true, actions: [intervention], note: "تم الاتفاق — الوسيط يتابع إنهاء الصفقة والمستندات." };
  }
  if (dealPhase === PHASE.VIEWING || dealPhase === PHASE.VIEWING_RESULT) {
    const note = dealPhase === PHASE.VIEWING ? `موعد المعاينة: ${formatDateTime(at, now)}` : "تمت المعاينة — بانتظار الوسيط لتسجيل النتيجة.";
    return { ...base, phase: "VIEWING_WAIT", waiting: true, actions: [intervention], note, viewingAt: at ? at.toISOString() : null };
  }
  if (dealPhase === PHASE.VIEWING_SCHEDULING) {
    const state = String(viewing.state || "NONE").toUpperCase();
    if (state === "ACCEPTED") {
      return { ...base, phase: "VIEWING_WAIT", waiting: true, actions: [intervention], note: "قُبل الموعد — بانتظار تأكيد الوسيط.", viewingAt: at ? at.toISOString() : null };
    }
    if (state === "PROPOSED" && at) {
      const by = viewing.proposedBy || viewing.counterBy || "";
      if (by === role) {
        return { ...base, phase: "VIEWING_WAIT", waiting: true, actions: [intervention], note: `اقترحت موعد ${formatDateTime(at, now)} — بانتظار موافقة ${ROLE_LABEL[roleOther(role)]}.`, viewingAt: at.toISOString() };
      }
      return {
        ...base, phase: "VIEWING", waiting: false, viewingAt: at.toISOString(), note: "",
        actions: [{ ...OTHER_ACTIONS.viewing_ok, group: "main" }, { ...OTHER_ACTIONS.viewing_other, group: "main" }, intervention]
      };
    }
    return { ...base, phase: "VIEWING_PICK", waiting: false, note: "تم الاتفاق على السعر — اختر موعد المعاينة من الأوقات المتاحة.", actions: [{ ...OTHER_ACTIONS.viewing_pick, group: "main" }, intervention] };
  }
  const prices = sessionPrices(journey);
  if (dealPhase === PHASE.PRICE_DECISION) {
    const fixed = prices.owner;
    if (role === SESSION_ROLE.OWNER) {
      return { ...base, phase: "FIXED_WAIT", waiting: true, actions: [intervention], note: `السعر ثابت: ${formatPrice(fixed)} — بانتظار رد العميل.` };
    }
    return {
      ...base, phase: "FIXED", waiting: false, note: `السعر ثابت: ${formatPrice(fixed)}`,
      actions: [{ ...OTHER_ACTIONS.accept_fixed, price: fixed || null, group: "main" }, { ...OTHER_ACTIONS.decline_fixed, group: "main" }, intervention]
    };
  }
  const last = prices.lastMove;
  if (last && last.role === role) {
    const note = last.move === "reject" ? `رفضت العرض الحالي — بانتظار رد ${ROLE_LABEL[roleOther(role)]}.` : `بانتظار رد ${ROLE_LABEL[roleOther(role)]} على سعرك ${formatPrice(last.price)}.`;
    return { ...base, phase: "WAITING", waiting: true, note, actions: [intervention] };
  }
  const actions = [];
  const acceptPrice = PRICE_MOVES.accept.price(prices, role);
  if (acceptPrice > 0) actions.push({ ...strip({ ...PRICE_MOVES.accept, label: "قبول", price: acceptPrice }), group: "main" });
  const adjust = [];
  for (const id of ADJUST_ORDER) {
    const move = PRICE_MOVES[id];
    if (!move.roles.includes(role)) continue;
    const price = move.typed ? null : move.price(prices, role);
    if (!move.typed && !(price > 0)) continue;
    if (id === "compromise" && (!prices.owner || !prices.client || prices.owner === prices.client)) continue;
    adjust.push({ ...strip({ ...move, price }), group: "adjust" });
  }
  if (adjust.length) actions.push({ id: "adjust", label: "تعديل العرض", icon: "edit", group: "main", toggle: true, price: null, typed: false, secondary: false, pct: 0 });
  if (last && last.role !== role) actions.push({ ...OTHER_ACTIONS.reject, group: "main", price: null, typed: false, secondary: false, pct: 0 });
  actions.push(...adjust, intervention);
  return { ...base, phase: "PRICE", waiting: false, actions, note: "" };
}

function strip(move) {
  return { id: move.id, label: move.label, icon: move.icon, price: move.price ?? null, typed: move.typed || false, secondary: move.secondary || false, pct: move.pct || 0 };
}

/** Validate a typed price: digits only, positive, bounded. */
export function parseTypedPrice(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: false, message: "اكتب السعر" };
  const ascii = raw.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  if (!/^[\d,،\s]+$/.test(ascii)) return { ok: false, message: "اكتب رقم السعر فقط" };
  const n = toNumber(ascii);
  if (!(n > 0) || n > MAX_SESSION_PRICE) return { ok: false, message: "اكتب سعرًا صحيحًا" };
  return { ok: true, price: Math.round(n) };
}

/** Sentence for a move, from the point of view of anyone reading the log. */
export function moveText(move, { pct = 0 } = {}) {
  switch (move) {
    case "accept": return "وافق على السعر";
    case "minus2": case "minus5": return `اقترح سعرًا أقل بـ ${Math.abs(pct || (move === "minus2" ? 2 : 5))}%`;
    case "plus2": case "plus5": return `اقترح سعرًا أعلى بـ ${Math.abs(pct || (move === "plus2" ? 2 : 5))}%`;
    case "compromise": return "اقترح حلًا وسطًا";
    case "manual": return "اقترح سعرًا";
    case "to_broker": return "أرسل سعرًا للوسيط فقط";
    case "intervention": return "طلب تدخل الوسيط";
    case "viewing_ok": return "وافق على موعد المعاينة — تم حجز الموعد";
    case "viewing_other": return "اقترح موعدًا آخر للمعاينة";
    case "viewing_pick": return "اقترح موعد المعاينة";
    case "accept_fixed": return "وافق على السعر الثابت";
    case "decline_fixed": return "لم يوافق على السعر الثابت — أُغلقت هذه المطابقة";
    case "reject": return "رفض العرض الحالي";
    case "opened": return "فتح رابط الجلسة";
    case "resolved": return "تابع الوسيط طلب التدخل";
    default: return "";
  }
}

/**
 * Who may see an event: "all" | "broker" | "owner" | "client" | "owner,client".
 * Office events that are not part of the session are broker-only.
 */
export function eventVisibleTo(event = {}, viewer = "broker") {
  if (viewer === "broker") return true;
  const payload = parsePayload(event);
  if (!String(event.type || "").startsWith("SESSION_")) return false;
  const audience = String(payload.audience || "broker");
  if (audience === "all") return true;
  return audience.split(",").includes(viewer);
}

export function parsePayload(event = {}) {
  if (event.payload && typeof event.payload === "object") return event.payload;
  try {
    const parsed = JSON.parse(event.payloadJson || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Party-safe card for one session event. Never includes names, phones or ids.
 * `viewer` decides «أنت» for the viewer's own moves.
 */
export function sessionEventCard(event = {}, viewer = "broker") {
  const payload = parsePayload(event);
  const type = String(event.type || "");
  const actor = String(payload.role || (type === "SESSION_BROKER_MESSAGE" || type === "SESSION_RESOLVED" ? "broker" : ""));
  const who = actor && actor === viewer && viewer !== "broker" ? "أنت" : ROLE_LABEL[actor] || "الوسيط";
  let text = "";
  let detail = "";
  if (type === "SESSION_MOVE") {
    text = moveText(payload.move, { pct: payload.pct });
    if (payload.price) detail = formatPrice(payload.price);
    if (payload.move === "viewing_other" && payload.viewingAt) detail = String(payload.viewingAtLabel || "");
  } else if (type === "SESSION_BROKER_MESSAGE") {
    text = String(payload.text || "");
    detail = viewer === "broker" ? `إلى ${payload.audience === "all" ? "الطرفين" : ROLE_LABEL[payload.audience] || ""}` : "";
  } else if (type === "SESSION_RESOLVED") {
    text = moveText("resolved");
  } else if (type === "SESSION_OPENED") {
    text = moveText("opened");
  } else if (type === "SESSION_STAGE") {
    text = String(payload.text || event.text || "");
  }
  return {
    id: String(event.eventId || event.id || ""),
    type,
    actor,
    who,
    text,
    detail,
    at: event.at || event.createdAt || null,
    mine: Boolean(actor && actor === viewer),
    private: payload.audience === "broker"
  };
}
