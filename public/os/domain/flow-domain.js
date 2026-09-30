const CLOSED_STATUSES = new Set(["COMPLETED", "DONE", "CLOSED", "CANCELLED", "REJECTED", "CLOSED_WON", "CLOSED_LOST"]);

export const FLOW_STAGE = Object.freeze({
  MATCHED: "MATCHED",
  PRICE_DECISION: "PRICE_DECISION",
  PRICE_NEGOTIATION: "PRICE_NEGOTIATION",
  VIEWING_SCHEDULING: "VIEWING_SCHEDULING",
  VIEWING: "VIEWING",
  VIEWING_RESULT: "VIEWING_RESULT",
  FINAL_AGREEMENT: "FINAL_AGREEMENT",
  CLOSED: "CLOSED"
});

export const PRICE_STATUS = Object.freeze({
  FIXED: "FIXED",
  NEGOTIABLE: "NEGOTIABLE",
  LEGACY: "LEGACY"
});

export const FLOW_STAGE_LABEL = Object.freeze({
  MATCHED: "المطابقة",
  PRICE_DECISION: "السعر",
  PRICE_NEGOTIATION: "التفاوض",
  VIEWING_SCHEDULING: "تحديد موعد المعاينة",
  VIEWING: "المعاينة",
  VIEWING_RESULT: "نتيجة المعاينة",
  FINAL_AGREEMENT: "إنهاء الصفقة",
  CLOSED: "مغلقة"
});

export function normalizePriceStatus(record = {}) {
  const raw = String(record.priceStatus || record.priceNegotiability || "").trim().toUpperCase();
  if (["LEGACY", "UNKNOWN"].includes(raw)) return PRICE_STATUS.LEGACY;
  if (["FIXED", "ثابت", "PRICE_FIXED"].includes(raw)) return PRICE_STATUS.FIXED;
  if (["NEGOTIABLE", "قابل للتفاوض", "FLEXIBLE", "PRICE_NEGOTIABLE"].includes(raw)) return PRICE_STATUS.NEGOTIABLE;
  if (record.priceNegotiable === false) return PRICE_STATUS.FIXED;
  if (record.priceNegotiable === true) return PRICE_STATUS.NEGOTIABLE;
  return PRICE_STATUS.LEGACY;
}

export function priceStatusLabel(record = {}) {
  const status = normalizePriceStatus(record);
  if (status === PRICE_STATUS.FIXED) return "السعر ثابت";
  if (status === PRICE_STATUS.NEGOTIABLE) return "قابل للتفاوض";
  return "حالة السعر غير محددة";
}

export function primaryActionForStage(stage) {
  const map = {
    [FLOW_STAGE.MATCHED]: { label: "مراجعة المطابقة", href: "review" },
    [FLOW_STAGE.PRICE_DECISION]: { label: "مراجعة السعر", href: "session" },
    [FLOW_STAGE.PRICE_NEGOTIATION]: { label: "فتح التفاوض", href: "session" },
    [FLOW_STAGE.VIEWING_SCHEDULING]: { label: "تحديد موعد", href: "session" },
    [FLOW_STAGE.VIEWING]: { label: "تفاصيل المعاينة", href: "journey" },
    [FLOW_STAGE.VIEWING_RESULT]: { label: "تسجيل النتيجة", href: "journey" },
    [FLOW_STAGE.FINAL_AGREEMENT]: { label: "إنهاء الصفقة", href: "journey" },
    [FLOW_STAGE.CLOSED]: { label: "", href: "" }
  };
  return map[stage] || { label: "فتح الرحلة", href: "journey" };
}

export function routeForStage(journeyId, stage, { matchId = "" } = {}) {
  const id = encodeURIComponent(String(journeyId || ""));
  if (!id) return "tasks";
  if (stage === FLOW_STAGE.MATCHED && matchId) return `review/${encodeURIComponent(matchId)}`;
  if ([FLOW_STAGE.PRICE_DECISION, FLOW_STAGE.PRICE_NEGOTIATION, FLOW_STAGE.VIEWING_SCHEDULING].includes(stage)) return `session/${id}`;
  if (stage === FLOW_STAGE.CLOSED) return "tasks";
  return `journey/${id}?focus=${encodeURIComponent(stage)}`;
}

function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1_000_000);
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : 0;
}

export function inferStageFromTasks(tasks = [], now = new Date()) {
  const types = new Set(tasks.map((t) => String(t?.type || "").toUpperCase()));
  if (types.has("DEAL_ACTION") || types.has("AGREEMENT_FOLLOW_UP")) return FLOW_STAGE.FINAL_AGREEMENT;
  if (types.has("VIEWING_RESULT")) {
    const resultTask = tasks.find((t) => String(t?.type || "").toUpperCase() === "VIEWING_RESULT");
    const due = millis(resultTask?.dueAt);
    const current = now instanceof Date ? now.getTime() : millis(now);
    if (due > 0 && current > 0 && due > current) return FLOW_STAGE.VIEWING;
    return FLOW_STAGE.VIEWING_RESULT;
  }
  if (types.has("VIEWING_CONFIRM") || types.has("VIEWING_SCHEDULE") || types.has("VIEWING_PROPOSAL")) return FLOW_STAGE.VIEWING_SCHEDULING;
  if (types.has("VIEWING_REMINDER") || types.has("VIEWING")) return FLOW_STAGE.VIEWING;
  if (types.has("PROPOSAL_REPLY") || types.has("SESSION_INTERVENTION") || types.has("SEND_PROPOSAL") || types.has("AWAITING_REPLY")) return FLOW_STAGE.PRICE_NEGOTIATION;
  if (types.has("PRICE_DECISION")) return FLOW_STAGE.PRICE_DECISION;
  if (types.has("MATCH_REVIEW")) return FLOW_STAGE.MATCHED;
  return FLOW_STAGE.PRICE_DECISION;
}

function taskTime(task = {}) {
  return millis(task.updatedAt || task.createdAt || task.dueAt || 0);
}

export function groupTasksByJourney(tasks = [], now = new Date()) {
  const active = tasks.filter((task) => !CLOSED_STATUSES.has(String(task?.status || "OPEN").toUpperCase()));
  const grouped = new Map();
  for (const task of active) {
    const journeyId = String(task?.journeyId || "").trim();
    if (!journeyId) continue;
    if (!grouped.has(journeyId)) grouped.set(journeyId, []);
    grouped.get(journeyId).push(task);
  }
  return [...grouped.entries()].map(([journeyId, list]) => {
    list.sort((a, b) => taskTime(b) - taskTime(a));
    const stage = inferStageFromTasks(list, now);
    const action = primaryActionForStage(stage);
    return {
      journeyId,
      stage,
      stageLabel: FLOW_STAGE_LABEL[stage] || stage,
      actionLabel: action.label,
      route: routeForStage(journeyId, stage, { matchId: list.find((t) => t.matchId)?.matchId || "" }),
      task: list[0],
      tasks: list
    };
  }).sort((a, b) => taskTime(b.task) - taskTime(a.task));
}

export function nextAfterPriceDecision({ priceStatus, accepted } = {}) {
  const status = String(priceStatus || PRICE_STATUS.LEGACY).toUpperCase();
  if (status === PRICE_STATUS.FIXED) {
    if (accepted) return { stage: FLOW_STAGE.VIEWING_SCHEDULING, activeTopics: [] };
    return { stage: FLOW_STAGE.CLOSED, closeScope: "JOURNEY_ONLY", activeTopics: [] };
  }
  if (status === PRICE_STATUS.NEGOTIABLE || status === PRICE_STATUS.LEGACY) {
    return { stage: FLOW_STAGE.PRICE_NEGOTIATION, activeTopics: ["price"] };
  }
  return { stage: FLOW_STAGE.PRICE_DECISION, activeTopics: [] };
}

function replaceAgreedItem(items = [], item) {
  return [...items.filter((x) => x?.key !== item.key), item];
}

export function applyPriceAgreement(journey = {}, price) {
  const amount = Number(price);
  if (!(amount > 0)) throw new Error("invalid_agreed_price");
  return {
    ...journey,
    stage: FLOW_STAGE.VIEWING_SCHEDULING,
    agreedPrice: amount,
    activeTopics: [],
    agreedItems: replaceAgreedItem(journey.agreedItems || [], { key: "price", label: "السعر المتفق عليه", value: amount })
  };
}

export function applyViewingResult(journey = {}, result) {
  const value = String(result || "").toLowerCase();
  if (["suitable", "interested", "مناسب"].includes(value)) {
    return { ...journey, stage: FLOW_STAGE.FINAL_AGREEMENT, activeTopics: [] };
  }
  if (["needs_negotiation", "needs-negotiation", "يحتاج تفاوض"].includes(value)) {
    return { ...journey, stage: FLOW_STAGE.PRICE_NEGOTIATION, activeTopics: ["price"], agreedItems: [...(journey.agreedItems || [])] };
  }
  if (["not_suitable", "not-suitable", "غير مناسب"].includes(value)) {
    return { ...journey, stage: FLOW_STAGE.CLOSED, closeScope: "JOURNEY_ONLY", activeTopics: [] };
  }
  throw new Error("invalid_viewing_result");
}

function instant(value) {
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : NaN;
}

export function slotsOverlap(aStart, aEnd, bStart, bEnd) {
  const as = instant(aStart), ae = instant(aEnd), bs = instant(bStart), be = instant(bEnd);
  if (![as, ae, bs, be].every(Number.isFinite)) return false;
  return as < be && bs < ae;
}

export function brokerHasConflict(existing = [], proposal = {}) {
  const brokerId = String(proposal.brokerId || "");
  if (!brokerId) return false;
  const start = proposal.start || proposal.at;
  const end = proposal.end || new Date(instant(start) + 60 * 60 * 1000).toISOString();
  return existing.some((item) => {
    if (String(item.brokerId || "") !== brokerId) return false;
    if (["CANCELLED", "CLOSED", "REJECTED"].includes(String(item.state || "").toUpperCase())) return false;
    const itemStart = item.start || item.at;
    const itemEnd = item.end || new Date(instant(itemStart) + 60 * 60 * 1000).toISOString();
    return slotsOverlap(start, end, itemStart, itemEnd);
  });
}

export function availableViewingSlots(slots = [], existing = [], brokerId = "") {
  return slots.filter((slot) => !brokerHasConflict(existing, { ...slot, brokerId }));
}

export function confirmViewingSlot(journey = {}, { at, end, brokerId = "", existing = [] } = {}) {
  const start = at;
  const finish = end || (Number.isFinite(instant(start)) ? new Date(instant(start) + 60 * 60 * 1000).toISOString() : "");
  if (!start || !Number.isFinite(instant(start))) throw new Error("invalid_viewing_slot");
  if (brokerId && brokerHasConflict(existing, { brokerId, start, end: finish })) throw new Error("viewing_slot_conflict");
  return {
    ...journey,
    stage: FLOW_STAGE.VIEWING_SCHEDULING,
    viewing: { ...(journey.viewing || {}), state: "CONFIRMED", at: start, end: finish, brokerId },
    agreedItems: replaceAgreedItem(journey.agreedItems || [], { key: "viewing", label: "موعد المعاينة", value: start })
  };
}

export function stageAtTime(journey = {}, now = new Date()) {
  const stage = String(journey.stage || "").toUpperCase();
  if (stage === FLOW_STAGE.CLOSED) return FLOW_STAGE.CLOSED;
  const viewing = journey.viewing || {};
  if (viewing.state === "CONFIRMED" && viewing.at) {
    const at = instant(viewing.at);
    const current = now instanceof Date ? now.getTime() : instant(now);
    if (Number.isFinite(at) && Number.isFinite(current) && current >= at) return FLOW_STAGE.VIEWING;
  }
  return Object.values(FLOW_STAGE).includes(stage) ? stage : FLOW_STAGE.PRICE_DECISION;
}
