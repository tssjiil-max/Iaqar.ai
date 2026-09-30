/**
 * Opportunity journey (مساحة الفرصة) domain.
 *
 * Stage = where the opportunity is (مراجعة المطابقة ← التفاوض ← المعاينة ← إتمام).
 * Action = what is required now. They are deliberately separate: a journey in
 * NEGOTIATION may require "مراجعة الرد" or "إرسال مقترح" or nothing (waiting).
 *
 * The path is not rigid: any open stage may move back to negotiation, skip viewing,
 * pause/resume, or close without a deal. Only an explicit close action completes a deal.
 */

export const STAGE = Object.freeze({
  MATCH_REVIEW: "MATCH_REVIEW",
  NEGOTIATION: "NEGOTIATION",
  VIEWING: "VIEWING",
  AGREEMENT: "AGREEMENT",
  CLOSED: "CLOSED"
});

export const STAGE_PATH = Object.freeze([
  { id: STAGE.MATCH_REVIEW, label: "مراجعة المطابقة", icon: "doc-check" },
  { id: STAGE.NEGOTIATION, label: "التفاوض", icon: "handshake" },
  { id: STAGE.VIEWING, label: "المعاينة", icon: "eye" },
  { id: STAGE.AGREEMENT, label: "إتمام الصفقة", icon: "home" }
]);

export const STAGE_LABEL = Object.freeze({
  MATCH_REVIEW: "مراجعة المطابقة",
  NEGOTIATION: "التفاوض",
  VIEWING: "المعاينة",
  AGREEMENT: "متابعة الاتفاق",
  CLOSED: "مغلقة"
});

export const JOURNEY_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  CLOSED_WON: "CLOSED_WON",
  CLOSED_LOST: "CLOSED_LOST"
});

export const JOURNEY_STATUS_LABEL = Object.freeze({
  ACTIVE: "نشطة",
  PAUSED: "متوقفة مؤقتًا",
  CLOSED_WON: "تمت الصفقة",
  CLOSED_LOST: "أغلقت دون صفقة"
});

export function isJourneyOpen(journey = {}) {
  const status = String(journey.status || "").toUpperCase();
  return status === JOURNEY_STATUS.ACTIVE || status === JOURNEY_STATUS.PAUSED;
}

/** Stage moves the broker may make by hand. */
export function allowedStageMoves(journey = {}) {
  if (!isJourneyOpen(journey)) return [];
  const current = String(journey.stage || STAGE.NEGOTIATION);
  return [STAGE.NEGOTIATION, STAGE.VIEWING, STAGE.AGREEMENT].filter((stage) => stage !== current);
}

export function canMoveStage(journey, to) {
  return allowedStageMoves(journey).includes(to);
}

/** Viewing lifecycle. Accepting a time never means the viewing happened. */
export const VIEWING_STATE = Object.freeze({
  NONE: "NONE",
  PROPOSED: "PROPOSED",
  ACCEPTED: "ACCEPTED",
  CONFIRMED: "CONFIRMED",
  DONE: "DONE",
  CANCELLED: "CANCELLED"
});

export const VIEWING_STATE_LABEL = Object.freeze({
  NONE: "لا يوجد موعد",
  PROPOSED: "موعد مقترح",
  ACCEPTED: "قُبل الموعد — بانتظار التأكيد",
  CONFIRMED: "موعد مؤكد",
  DONE: "تمت المعاينة",
  CANCELLED: "أُلغي الموعد"
});

export const VIEWING_RESULTS = Object.freeze([
  { id: "interested", label: "مهتم", icon: "heart", next: "AGREEMENT" },
  { id: "needs_negotiation", label: "يحتاج تفاوضًا", icon: "clock", next: "NEGOTIATION" },
  { id: "not_suitable", label: "غير مناسب", icon: "x-circle", next: "CLOSE_SUGGESTED" },
  { id: "follow_later", label: "متابعة لاحقة", icon: "calendar", next: "FOLLOW_UP" }
]);

export function viewingResultOf(id) {
  return VIEWING_RESULTS.find((item) => item.id === id) || null;
}

/**
 * Task/action registry used both for the journey's "المطلوب الآن" and for Daily
 * Tasks cards. `inline` = the card can finish it without opening the workspace.
 */
export const ACTION = Object.freeze({
  SEND_PROPOSAL: { code: "SEND_PROPOSAL", taskType: "SEND_PROPOSAL", label: "إرسال مقترح", button: "تجهيز المقترح", inline: false },
  AWAIT_REPLY: { code: "AWAIT_REPLY", taskType: "AWAITING_REPLY", label: "بانتظار رد", button: "متابعة الرد", inline: false, waiting: true },
  REVIEW_REPLY: { code: "REVIEW_REPLY", taskType: "PROPOSAL_REPLY", label: "مراجعة الرد", button: "مراجعة الرد", inline: false },
  CONFIRM_VIEWING: { code: "CONFIRM_VIEWING", taskType: "VIEWING_CONFIRM", label: "تأكيد موعد المعاينة", button: "تأكيد الموعد", inline: true },
  RECORD_VIEWING_RESULT: { code: "RECORD_VIEWING_RESULT", taskType: "VIEWING_RESULT", label: "نتيجة المعاينة", button: "نتيجة المعاينة", inline: false },
  FOLLOW_UP: { code: "FOLLOW_UP", taskType: "JOURNEY_FOLLOW_UP", label: "متابعة الفرصة", button: "متابعة الآن", inline: false },
  AGREEMENT_FOLLOW_UP: { code: "AGREEMENT_FOLLOW_UP", taskType: "DEAL_ACTION", label: "متابعة إجراءات الاتفاق", button: "متابعة الاتفاق", inline: false }
});

export function actionOf(code) {
  return ACTION[String(code || "")] || null;
}

/**
 * Workflow meaning of a party reply (proposal-domain effect codes) → journey patch
 * intent + the broker's next action. Pure: the Worker applies it.
 */
export function effectOfReply(effect, { proposalKind, fields = {}, role } = {}) {
  switch (effect) {
    case "VIEWING_ACCEPTED":
      return { viewing: { state: VIEWING_STATE.ACCEPTED, at: fields.viewingAt || null, acceptedBy: role }, stage: STAGE.VIEWING, next: "CONFIRM_VIEWING" };
    case "VIEWING_DECLINED":
      return { viewing: { state: VIEWING_STATE.PROPOSED, declinedBy: role }, next: "REVIEW_REPLY" };
    case "VIEWING_COUNTER":
      return { viewing: { state: VIEWING_STATE.PROPOSED, counterBy: role }, next: "REVIEW_REPLY" };
    case "PRICE_ACCEPTED":
      return { priceAcceptedBy: role, price: fields.price || null, next: "REVIEW_REPLY" };
    case "PRICE_COUNTER":
    case "PRICE_REJECTED":
    case "INFO_PROVIDED":
    case "ACTION_CHANGE":
    case "ACTION_DECLINED":
    case "STEP_HELP":
    case "NOT_INTERESTED":
      return { next: "REVIEW_REPLY" };
    case "INFO_LATER":
    case "NEEDS_TIME":
    case "STEP_IN_PROGRESS":
      return { next: "FOLLOW_UP", followUpInDays: 2 };
    case "INTERESTED":
    case "ACTION_CONFIRMED":
    case "STEP_DONE":
      return { next: "REVIEW_REPLY" };
    default:
      return { next: "REVIEW_REPLY", proposalKind };
  }
}

/** Next action after a viewing result. */
export function effectOfViewingResult(resultId) {
  const result = viewingResultOf(resultId);
  if (!result) return null;
  if (result.next === "AGREEMENT") return { stage: STAGE.AGREEMENT, next: "AGREEMENT_FOLLOW_UP" };
  if (result.next === "NEGOTIATION") return { stage: STAGE.NEGOTIATION, next: "SEND_PROPOSAL" };
  if (result.next === "FOLLOW_UP") return { next: "FOLLOW_UP", followUpInDays: 3 };
  return { next: "FOLLOW_UP", followUpInDays: 0, suggestClose: true };
}

/** Where each stage stands for the path widget: done | current | skipped | todo. */
export function stageProgress(journey = {}) {
  const current = String(journey.stage || STAGE.NEGOTIATION);
  const order = STAGE_PATH.map((s) => s.id);
  const currentIndex = current === STAGE.CLOSED ? order.length : order.indexOf(current);
  const viewingState = String(journey.viewing?.state || VIEWING_STATE.NONE);
  return STAGE_PATH.map((stage, index) => {
    let state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
    if (stage.id === STAGE.VIEWING && index < currentIndex && viewingState !== VIEWING_STATE.DONE) state = "skipped";
    if (stage.id === STAGE.AGREEMENT && journey.status === JOURNEY_STATUS.CLOSED_WON) state = "done";
    return { ...stage, state };
  });
}

/**
 * Deterministic next-step suggestion (always available; the AI suggestion, when
 * present, is shown in addition and labelled as such).
 */
export function suggestNextStep(journey = {}, { now = new Date() } = {}) {
  if (!isJourneyOpen(journey)) return "";
  if (journey.status === JOURNEY_STATUS.PAUSED) return "الفرصة متوقفة مؤقتًا — استأنفها عند جاهزية الأطراف.";
  const replies = journey.lastReplies || {};
  const viewing = journey.viewing || {};
  if (viewing.state === VIEWING_STATE.ACCEPTED) return "الطرف قبل الموعد — أكّد المعاينة مع الطرف الآخر ثم ثبّتها.";
  if (viewing.state === VIEWING_STATE.CONFIRMED) {
    const at = viewing.at ? new Date(viewing.at) : null;
    if (at && at.getTime() < now.getTime()) return "موعد المعاينة مضى — سجّل نتيجتها.";
    return "المعاينة مؤكدة — ذكّر الطرفين قبل الموعد.";
  }
  const client = replies.client;
  const owner = replies.owner;
  if (client?.effect === "PRICE_COUNTER" || owner?.effect === "PRICE_COUNTER") return "وصل سعر مقابل — راجعه واقترح سعرًا وسطًا على الطرف الآخر.";
  if (client?.effect === "PRICE_ACCEPTED" && owner?.effect === "PRICE_ACCEPTED") return "الطرفان موافقان مبدئيًا على السعر — اقترح موعد معاينة أو انتقل لمتابعة الاتفاق.";
  if (journey.stage === STAGE.AGREEMENT) return "تابع خطوات الاتفاق (العربون، العقد، الإفراغ) ثم أتمم الصفقة عند اكتمالها.";
  if (!journey.lastProposalAt) return "ابدأ بإرسال مقترح سعر أو موعد معاينة للطرفين.";
  return "تابع الردود وأرسل المقترح التالي عند الحاجة.";
}

/** Event types for the journey timeline, with their display text. */
export const EVENT_TEXT = Object.freeze({
  MATCH_APPROVED: "تم اعتماد المطابقة وبدء التفاوض",
  PROPOSAL_CREATED: "تم تجهيز مقترح",
  WHATSAPP_OPENED: "تم فتح واتساب",
  MESSAGE_SHARED: "تم فتح المشاركة",
  PARTY_REPLY: "وصل رد",
  BROKER_NOTE: "ملاحظة الوسيط",
  CALL_OUTCOME: "رد مسجّل بعد اتصال",
  VIEWING_CONFIRMED: "تم تأكيد موعد المعاينة",
  VIEWING_RESULT: "تم تسجيل نتيجة المعاينة",
  STAGE_CHANGED: "تغيّرت المرحلة",
  PAUSED: "تم إيقاف الفرصة مؤقتًا",
  RESUMED: "تم استئناف الفرصة",
  CLOSED_WON: "تم إتمام الصفقة",
  CLOSED_LOST: "أغلقت الفرصة دون صفقة",
  PROPOSAL_SUPERSEDED: "تم استبدال مقترح سابق",
  FOLLOW_UP_DONE: "تمت المتابعة"
});

export const EVENT_SOURCE = Object.freeze({
  BROKER: "BROKER",
  REPLY_LINK: "REPLY_LINK",
  BROKER_NOTE: "BROKER_NOTE",
  SYSTEM: "SYSTEM"
});

export const CLOSE_REASONS_LOST = Object.freeze([
  "العميل لم يعد مهتمًا",
  "المالك سحب العرض",
  "لم يتم الاتفاق على السعر",
  "العقار غير مناسب",
  "سبب آخر"
]);
