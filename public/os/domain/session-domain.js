/**
 * جلسة التفاوض — one live session per deal (journey), shared by the owner, client
 * and broker. The server validates the same pure action model used by the UI.
 */

import { formatPrice, toDate, toNumber } from "./format-domain.js";
import { FLOW_STAGE, normalizePriceStatus, PRICE_STATUS } from "./flow-domain.js";

export const SESSION_ROLE = Object.freeze({ OWNER: "owner", CLIENT: "client" });
export const ROLE_LABEL = Object.freeze({ owner: "المالك", client: "العميل", broker: "الوسيط" });

/** Kept for visual/backward compatibility; detailed journey state lives in flowStage. */
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

export function roundPrice(value) {
  const n = Number(value) || 0;
  if (n <= 0) return 0;
  return n >= 100000 ? Math.round(n / 1000) * 1000 : Math.round(n / 10) * 10;
}

export function isOpenJourney(journey = {}) {
  const status = String(journey.status || "").toUpperCase();
  return status === "ACTIVE" || status === "PAUSED";
}

export function sessionStage(journey = {}) {
  const flow = String(journey.flowStage || "").toUpperCase();
  if (flow === FLOW_STAGE.CLOSED) return "CLOSING";
  if (flow === FLOW_STAGE.FINAL_AGREEMENT) return "DOCUMENTS";
  if ([FLOW_STAGE.VIEWING_SCHEDULING, FLOW_STAGE.VIEWING, FLOW_STAGE.VIEWING_RESULT].includes(flow)) return "VIEWING";
  if ([FLOW_STAGE.PRICE_DECISION, FLOW_STAGE.PRICE_NEGOTIATION].includes(flow)) return "NEGOTIATION";
  if (flow === FLOW_STAGE.MATCHED) return "MATCH";

  const status = String(journey.status || "").toUpperCase();
  if (status === "CLOSED_WON" || status === "CLOSED_LOST" || journey.stage === "CLOSED") return "CLOSING";
  if (journey.stage === "AGREEMENT") return "DOCUMENTS";
  if (journey.stage === "VIEWING") return "VIEWING";
  if (journey.stage === "MATCH_REVIEW") return "MATCH";
  if (["PROPOSED", "ACCEPTED", "CONFIRMED"].includes(String(journey.viewing?.state || "")) && journey.viewing?.at) return "VIEWING";
  return sessionOf(journey).lastMove ? "NEGOTIATION" : "CONTACT";
}

export function sessionStageLabel(journey = {}) {
  return SESSION_STAGES.find((s) => s.id === sessionStage(journey))?.label || "";
}

export function sessionPrices(journey = {}) {
  const session = sessionOf(journey);
  const prices = session.prices || {};
  const owner = toNumber(prices.owner?.price) || toNumber(journey.offerSummary?.price);
  const client = toNumber(prices.client?.price) || toNumber(journey.requestSummary?.price);
  const lastMove = session.lastMove || null;
  const agreed = toNumber(session.agreedPrice || journey.agreedPrice);
  const current = agreed || toNumber(lastMove?.price) || owner || client;
  return { owner, client, current, agreed, lastMove };
}

export const PRICE_MOVES = Object.freeze({
  accept: { id: "accept", label: "قبول", icon: "check-circle", roles: ["owner", "client"], price: (p, role) => p[otherRole(role)] },
  minus2: { id: "minus2", label: "أقل 2%", icon: "chev-down", roles: ["client"], pct: -2, price: (p) => roundPrice(p.owner * 0.98) },
  minus5: { id: "minus5", label: "أقل 5%", icon: "chev-down", roles: ["client"], pct: -5, price: (p) => roundPrice(p.owner * 0.95) },
  plus2: { id: "plus2", label: "أعلى 2%", icon: "chev-up", roles: ["owner"], pct: 2, price: (p) => roundPrice(p.client * 1.02) },
  plus5: { id: "plus5", label: "أعلى 5%", icon: "chev-up", roles: ["owner"], pct: 5, price: (p) => roundPrice(p.client * 1.05) },
  compromise: { id: "compromise", label: "حل وسط", icon: "swap", roles: ["owner", "client"], price: (p) => roundPrice((p.owner + p.client) / 2) },
  manual: { id: "manual", label: "إدخال سعر", icon: "edit", roles: ["owner", "client"], typed: true, secondary: true, price: () => null },
  to_broker: { id: "to_broker", label: "إرسال السعر للوسيط", icon: "send", roles: ["owner", "client"], typed: true, secondary: true, private: true, price: () => null }
});

export const OTHER_ACTIONS = Object.freeze({
  reject: { id: "reject", label: "رفض", icon: "close" },
  intervention: { id: "intervention", label: "تدخل الوسيط", icon: "alert", secondary: true },
  viewing_ok: { id: "viewing_ok", label: "الموعد مناسب", icon: "check-circle" },
  viewing_other: { id: "viewing_other", label: "اختيار موعد آخر", icon: "calendar", typed: "datetime" }
});

const PRICE_ORDER = ["accept", "minus2", "minus5", "plus2", "plus5", "compromise", "manual", "to_broker"];

/**
 * The raw valid actions. The UI intentionally groups all adjustment moves under one
 * «تعديل العرض» control; keeping raw moves here preserves server-side validation and
 * backward compatibility with existing session links.
 */
export function availableActions(journey = {}, role = "") {
  if (role !== SESSION_ROLE.OWNER && role !== SESSION_ROLE.CLIENT) return { phase: "NONE", actions: [], note: "" };
  if (!isOpenJourney(journey)) return { phase: "CLOSED", actions: [], note: "أُغلقت هذه الصفقة، ويبقى سجل التفاوض للاطلاع." };
  const priceStatus = normalizePriceStatus(journey.offerSummary || journey.offer || {});
  const intervention = { ...OTHER_ACTIONS.intervention };
  if (String(journey.status || "").toUpperCase() === "PAUSED") {
    return { phase: "PAUSED", waiting: true, actions: [intervention], note: "الصفقة متوقفة مؤقتًا لدى الوسيط.", priceStatus };
  }

  const stage = sessionStage(journey);
  if (stage === "DOCUMENTS") {
    return { phase: "DOCUMENTS", waiting: true, actions: [], note: "الوسيط يتابع إنهاء الصفقة.", priceStatus };
  }

  if (stage === "VIEWING") {
    const viewing = journey.viewing || {};
    const at = toDate(viewing.at);
    const state = String(viewing.state || "NONE");
    if (!at || !["PROPOSED", "ACCEPTED"].includes(state)) {
      const note = state === "CONFIRMED" ? "موعد المعاينة مؤكد." : state === "DONE" ? "تمت المعاينة." : "بانتظار تحديد موعد المعاينة.";
      return { phase: "VIEWING_WAIT", waiting: true, actions: [], note, viewingAt: at ? at.toISOString() : null, priceStatus };
    }
    if (viewing.counterBy) {
      const note = viewing.counterBy === role ? "اخترت موعدًا آخر — بانتظار اعتماده." : `اقترح ${ROLE_LABEL[viewing.counterBy]} موعدًا آخر.`;
      return { phase: "VIEWING_WAIT", waiting: true, actions: [], note, viewingAt: at.toISOString(), priceStatus };
    }
    if (viewing.acceptedBy && viewing.acceptedBy[role]) {
      return { phase: "VIEWING_ACCEPTED", waiting: true, actions: [], note: "وافقت على الموعد — بانتظار الطرف الآخر.", viewingAt: at.toISOString(), priceStatus };
    }
    return {
      phase: "VIEWING", waiting: false, viewingAt: at.toISOString(), note: "",
      actions: [{ ...OTHER_ACTIONS.viewing_ok }, { ...OTHER_ACTIONS.viewing_other }], priceStatus
    };
  }

  const prices = sessionPrices(journey);
  if (prices.agreed) {
    return { phase: "AGREED", waiting: true, actions: [], note: `تم الاتفاق على ${formatPrice(prices.agreed)} — الخطوة التالية تحديد موعد المعاينة.`, priceStatus };
  }

  /** Fixed price: the owner already made the decision when the offer was created. */
  if (priceStatus === PRICE_STATUS.FIXED) {
    if (role === SESSION_ROLE.OWNER) {
      return { phase: "FIXED_WAIT", waiting: true, actions: [], note: `السعر ثابت: ${formatPrice(prices.owner)} — بانتظار قرار العميل.`, priceStatus };
    }
    return {
      phase: "FIXED_PRICE", waiting: false, note: `السعر ثابت: ${formatPrice(prices.owner)}.`, priceStatus,
      actions: [strip({ ...PRICE_MOVES.accept, price: prices.owner }), { ...OTHER_ACTIONS.reject }]
    };
  }

  const last = prices.lastMove;
  if (last && last.role === role) {
    return {
      phase: "WAITING", waiting: true, note: `بانتظار رد ${ROLE_LABEL[otherRole(role)]} على سعرك ${formatPrice(last.price)}.`,
      actions: [], priceStatus
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
  actions.push({ ...OTHER_ACTIONS.reject });
  return { phase: "PRICE", waiting: false, actions, note: "", priceStatus };
}

function strip(move) {
  return { id: move.id, label: move.label, icon: move.icon, price: move.price ?? null, typed: move.typed || false, secondary: move.secondary || false, pct: move.pct || 0 };
}

export function parseTypedPrice(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: false, message: "اكتب السعر" };
  const ascii = raw.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  if (!/^[\d,،\s]+$/.test(ascii)) return { ok: false, message: "اكتب رقم السعر فقط" };
  const n = toNumber(ascii);
  if (!(n > 0) || n > MAX_SESSION_PRICE) return { ok: false, message: "اكتب سعرًا صحيحًا" };
  return { ok: true, price: Math.round(n) };
}

export function moveText(move, { pct = 0 } = {}) {
  switch (move) {
    case "accept": return "وافق على السعر";
    case "reject": return "رفض العرض";
    case "minus2": case "minus5": return `اقترح سعرًا أقل بـ ${Math.abs(pct || (move === "minus2" ? 2 : 5))}%`;
    case "plus2": case "plus5": return `اقترح سعرًا أعلى بـ ${Math.abs(pct || (move === "plus2" ? 2 : 5))}%`;
    case "compromise": return "اقترح حلًا وسطًا";
    case "manual": return "اقترح سعرًا";
    case "to_broker": return "أرسل سعرًا للوسيط فقط";
    case "intervention": return "طلب تدخل الوسيط";
    case "viewing_ok": return "الموعد مناسب";
    case "viewing_other": return "اختار موعدًا آخر للمعاينة";
    case "opened": return "فتح رابط الجلسة";
    case "resolved": return "تابع الوسيط طلب التدخل";
    default: return "";
  }
}

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
