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

import { formatPrice, toDate, toNumber } from "./format-domain.js";

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

/** The deal-path stage shown on the session card. */
export function sessionStage(journey = {}) {
  const status = String(journey.status || "").toUpperCase();
  if (status === "CLOSED_WON" || status === "CLOSED_LOST" || journey.stage === "CLOSED") return "CLOSING";
  if (journey.stage === "AGREEMENT") return "DOCUMENTS";
  if (journey.stage === "VIEWING") return "VIEWING";
  if (journey.stage === "MATCH_REVIEW") return "MATCH";
  if (["PROPOSED", "ACCEPTED", "CONFIRMED"].includes(String(journey.viewing?.state || "")) && journey.viewing?.at) return "VIEWING";
  const session = sessionOf(journey);
  return session.lastMove ? "NEGOTIATION" : "CONTACT";
}

export function sessionStageLabel(journey = {}) {
  return SESSION_STAGES.find((s) => s.id === sessionStage(journey))?.label || "";
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
  intervention: { id: "intervention", label: "تدخل الوسيط", icon: "alert" },
  viewing_ok: { id: "viewing_ok", label: "الموعد مناسب", icon: "check-circle" },
  viewing_other: { id: "viewing_other", label: "اقترح موعدًا آخر", icon: "calendar", typed: "datetime" }
});

const PRICE_ORDER = ["accept", "minus2", "minus5", "plus2", "plus5", "compromise", "manual", "to_broker"];

/**
 * What this party may do right now — only the buttons that fit the current state.
 * Returns { phase, waiting, note, actions: [{ id, label, icon, price, typed }] }.
 */
export function availableActions(journey = {}, role = "") {
  if (role !== SESSION_ROLE.OWNER && role !== SESSION_ROLE.CLIENT) return { phase: "NONE", actions: [], note: "" };
  if (!isOpenJourney(journey)) return { phase: "CLOSED", actions: [], note: "أُغلقت هذه الصفقة، ويبقى سجل التفاوض للاطلاع." };
  const session = sessionOf(journey);
  const intervention = { ...OTHER_ACTIONS.intervention };
  if (String(journey.status || "").toUpperCase() === "PAUSED") {
    return { phase: "PAUSED", waiting: true, actions: [intervention], note: "الصفقة متوقفة مؤقتًا لدى الوسيط." };
  }
  const stage = sessionStage(journey);
  if (stage === "DOCUMENTS") {
    return { phase: "DOCUMENTS", waiting: true, actions: [intervention], note: "الوسيط يتابع المستندات وإجراءات الاتفاق." };
  }
  if (stage === "VIEWING") {
    const viewing = journey.viewing || {};
    const at = toDate(viewing.at);
    const state = String(viewing.state || "NONE");
    if (!at || !["PROPOSED", "ACCEPTED"].includes(state)) {
      const note = state === "CONFIRMED" ? "موعد المعاينة مؤكد." : state === "DONE" ? "تمت المعاينة." : "بانتظار الوسيط لتحديد موعد المعاينة.";
      return { phase: "VIEWING_WAIT", waiting: true, actions: [intervention], note, viewingAt: at ? at.toISOString() : null };
    }
    if (viewing.counterBy) {
      const note = viewing.counterBy === role ? "اقترحت موعدًا آخر — بانتظار الوسيط لتحديد الموعد." : `اقترح ${ROLE_LABEL[viewing.counterBy]} موعدًا آخر — بانتظار الوسيط لتحديد الموعد.`;
      return { phase: "VIEWING_WAIT", waiting: true, actions: [intervention], note, viewingAt: at.toISOString() };
    }
    if (viewing.acceptedBy && viewing.acceptedBy[role]) {
      return { phase: "VIEWING_ACCEPTED", waiting: true, actions: [intervention], note: "وافقت على الموعد — بانتظار تأكيد الوسيط.", viewingAt: at.toISOString() };
    }
    return {
      phase: "VIEWING", waiting: false, viewingAt: at.toISOString(), note: "",
      actions: [{ ...OTHER_ACTIONS.viewing_ok }, { ...OTHER_ACTIONS.viewing_other }, intervention]
    };
  }
  const prices = sessionPrices(journey);
  if (prices.agreed) {
    return { phase: "AGREED", waiting: true, actions: [intervention], note: `اتفق الطرفان على ${formatPrice(prices.agreed)} — بانتظار الوسيط لتحديد موعد المعاينة.` };
  }
  const last = prices.lastMove;
  if (last && last.role === role) {
    return {
      phase: "WAITING", waiting: true, note: `بانتظار رد ${ROLE_LABEL[otherRole(role)]} على سعرك ${formatPrice(last.price)}.`,
      actions: [intervention]
    };
  }
  const actions = [];
  for (const id of PRICE_ORDER) {
    const move = PRICE_MOVES[id];
    if (!move.roles.includes(role)) continue;
    const price = move.typed ? null : move.price(prices, role);
    if (!move.typed && !(price > 0)) continue;
    if (id === "compromise" && (!prices.owner || !prices.client || prices.owner === prices.client)) continue;
    if (id === "accept" && !prices[otherRole(role)]) continue;
    actions.push(strip({ ...move, price }));
  }
  actions.push(intervention);
  return { phase: "PRICE", waiting: false, actions, note: "" };
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
    case "viewing_ok": return "الموعد مناسب";
    case "viewing_other": return "اقترح موعدًا آخر للمعاينة";
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
