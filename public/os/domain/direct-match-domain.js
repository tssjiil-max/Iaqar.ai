/**
 * Direct matching journey — the rules shared by the Worker and the guest page.
 * Pure functions: no database, no network, no clock unless one is passed in.
 *
 * Principle: the AI runs the journey; a person approves every financial or contractual commitment.
 * Nothing here can reserve, accept a price, confirm a viewing or close a deal on its own.
 */

const DAY = 86400000;
const upper = (v) => String(v ?? "").trim().toUpperCase();
const when = (v) => {
  const d = v instanceof Date ? v : new Date(v?.toDate ? v.toDate() : v || 0);
  return Number.isFinite(d.getTime()) ? d : null;
};

// ------------------------------------------------------------------ listing status

export const LISTING_STATUS = Object.freeze({
  AVAILABLE: "AVAILABLE", NEGOTIATING: "NEGOTIATING", RESERVED: "RESERVED",
  SOLD: "SOLD", RENTED: "RENTED", UNAVAILABLE: "UNAVAILABLE"
});
export const LISTING_STATUS_LABEL = Object.freeze({
  AVAILABLE: "متاح", NEGOTIATING: "قيد التفاوض", RESERVED: "محجوز رسميًا",
  SOLD: "تم البيع", RENTED: "تم التأجير", UNAVAILABLE: "غير متاح"
});
/** Deal stages in which the offer is being worked on with a client (not merely reviewed). */
const WORKING_STAGES = new Set(["NEGOTIATION", "VIEWING", "AGREEMENT"]);

function journeyIsOpen(journey = {}) {
  const status = upper(journey.status || "ACTIVE");
  return status === "ACTIVE" || status === "PAUSED" ? upper(journey.stage) !== "CLOSED" : false;
}

/**
 * One status for an offer, from facts only: its confirmed availability, an official reservation
 * recorded by a person, and the office's own open deals on it. `recordId` is the offer's id.
 */
export function listingStatus(record = {}, { recordId = record.id, openJourneys = [] } = {}) {
  const availability = upper(record.availabilityStatus);
  if (availability === "SOLD") return LISTING_STATUS.SOLD;
  if (availability === "RENTED") return LISTING_STATUS.RENTED;
  if (availability === "FOUND" || availability === "UNAVAILABLE") return LISTING_STATUS.UNAVAILABLE;
  if (upper(record.reservation?.state) === "RESERVED") return LISTING_STATUS.RESERVED;
  const id = String(recordId || "");
  const working = id && openJourneys.some((j) => String(j?.offerId || "") === id && journeyIsOpen(j) && WORKING_STAGES.has(upper(j.stage)));
  return working ? LISTING_STATUS.NEGOTIATING : LISTING_STATUS.AVAILABLE;
}

/** Reserved / sold / rented / unavailable never reach new matches. «قيد التفاوض» follows the office policy (default: shown). */
export function isMatchable(status, { showNegotiating = true } = {}) {
  return status === LISTING_STATUS.AVAILABLE || (status === LISTING_STATUS.NEGOTIATING && showNegotiating !== false);
}

// ------------------------------------------------------------------ interest from several clients

export const INTEREST_WINDOW_DAYS = 14;
export const INTEREST_NOTICE = "يوجد اهتمام من عملاء آخرين بهذا العقار، ولا يزال متاحًا";

/**
 * True only when at least one OTHER client recorded real interest (a selection with consent) recently.
 * Never returns names, numbers, counts or conversations — and never true from nothing.
 */
export function othersInterested(interests = [], { viewerKey = "", now = new Date(), windowDays = INTEREST_WINDOW_DAYS } = {}) {
  const since = now.getTime() - windowDays * DAY;
  return (Array.isArray(interests) ? interests : []).some((row) => {
    if (!row || row.active === false) return false;
    const key = String(row.key || row.id || "");
    if (!key || (viewerKey && key === viewerKey)) return false;
    const at = when(row.lastAt || row.createdAt);
    return Boolean(at) && at.getTime() >= since && at.getTime() <= now.getTime() + 60000;
  });
}

/** Interest gives no priority: it never reserves and never changes the listing status. */
export function interestRecord({ key, reference, now = new Date(), previous = null }) {
  return {
    key: String(key), reference: String(reference || ""), active: true,
    createdAt: previous?.createdAt || now.toISOString(), lastAt: now.toISOString(),
    selections: Math.min(99, Number(previous?.selections || 0) + 1)
  };
}

// ------------------------------------------------------------------ official reservation (people only)

export const RESERVATION_ERRORS = Object.freeze({
  human_approval_required: "الحجز الرسمي يعتمده شخص مخوّل من المكتب، ولا يُنفَّذ آليًا.",
  not_authorized: "الحجز الرسمي لمدير المكتب فقط.",
  not_available: "العقار غير متاح للحجز.",
  already_reserved: "العقار محجوز رسميًا لصفقة أخرى.",
  not_reserved: "العقار غير محجوز."
});

function personCheck(actor) {
  if (!actor || actor.kind !== "human" || !actor.uid) return "human_approval_required";
  if (!actor.isManager) return "not_authorized";
  return "";
}

/**
 * Decide an official reservation against the CURRENT stored record. Callers run this inside the
 * store's compare-and-set update, so two concurrent reservations cannot both succeed.
 */
export function reservationDecision(current = {}, { actor, journeyId = "", note = "", now = new Date() } = {}) {
  const refused = personCheck(actor);
  if (refused) return { ok: false, code: refused };
  const status = listingStatus(current, { openJourneys: [] });
  if ([LISTING_STATUS.SOLD, LISTING_STATUS.RENTED, LISTING_STATUS.UNAVAILABLE].includes(status)) return { ok: false, code: "not_available" };
  const held = current.reservation;
  const deal = String(journeyId || "").slice(0, 120);
  if (upper(held?.state) === "RESERVED") {
    return String(held.journeyId || "") === deal ? { ok: true, unchanged: true } : { ok: false, code: "already_reserved" };
  }
  return { ok: true, patch: { reservation: { state: "RESERVED", journeyId: deal, by: actor.uid, at: now.toISOString(), note: String(note || "").slice(0, 300) } } };
}

export function releaseDecision(current = {}, { actor, now = new Date() } = {}) {
  const refused = personCheck(actor);
  if (refused) return { ok: false, code: refused };
  if (upper(current.reservation?.state) !== "RESERVED") return { ok: false, code: "not_reserved" };
  return { ok: true, patch: { reservation: { ...current.reservation, state: "RELEASED", releasedBy: actor.uid, releasedAt: now.toISOString() } } };
}

// ------------------------------------------------------------------ «أبغى العرض الثاني»

const ORDINALS = [
  ["اول", 1], ["اولي", 1], ["الاول", 1], ["الاولي", 1],
  ["ثاني", 2], ["الثاني", 2], ["ثانيه", 2], ["الثانيه", 2],
  ["ثالث", 3], ["الثالث", 3], ["ثالثه", 3], ["الثالثه", 3],
  ["رابع", 4], ["الرابع", 4], ["رابعه", 4], ["الرابعه", 4],
  ["خامس", 5], ["الخامس", 5], ["خامسه", 5], ["الخامسه", 5],
  ["سادس", 6], ["السادس", 6], ["سادسه", 6], ["السادسه", 6],
  ["سابع", 7], ["السابع", 7], ["سابعه", 7], ["السابعه", 7],
  ["ثامن", 8], ["الثامن", 8], ["ثامنه", 8], ["الثامنه", 8],
  ["تاسع", 9], ["التاسع", 9], ["تاسعه", 9], ["التاسعه", 9],
  ["عاشر", 10], ["العاشر", 10], ["عاشره", 10], ["العاشره", 10]
];
const ORDINAL_MAP = new Map(ORDINALS);

export function normalizeArabic(value) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Which of the client's results a message points to: an exact reference, an ordinal
 * («العرض الثاني»، «الثالثة»), or a number («رقم 2»، «العرض ٢»، «2»). Ambiguous → null.
 */
export function resolveListingReference(message, results = []) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return null;
  const raw = String(message ?? "");
  const byRef = list.map((item, i) => ({ item, i })).filter(({ item }) => item?.reference && raw.includes(String(item.reference)));
  if (byRef.length === 1) return { index: byRef[0].i, item: byRef[0].item, reference: byRef[0].item.reference, by: "reference" };
  if (byRef.length > 1) return null;
  const t = normalizeArabic(raw);
  const picks = new Set();
  for (const word of t.split(/[\s،,.!؟?:]+/)) if (ORDINAL_MAP.has(word)) picks.add(ORDINAL_MAP.get(word));
  for (const m of t.matchAll(/(?:^|\s)(?:رقم|العرض|عرض|العقار|عقار|الخيار|خيار|#)?\s*(\d{1,2})(?=$|\s|[،,.!؟?])/g)) picks.add(Number(m[1]));
  if (picks.size !== 1) return null;
  const n = [...picks][0];
  if (!Number.isInteger(n) || n < 1 || n > list.length) return null;
  return { index: n - 1, item: list[n - 1], reference: list[n - 1]?.reference || "", by: "position" };
}

// ------------------------------------------------------------------ readiness (guidance, never approval)

export const READINESS_EVENT = Object.freeze({
  SELECTED: "SELECTED", BUDGET_FIT: "BUDGET_FIT", CONTACT_CONSENT: "CONTACT_CONSENT",
  DETAILS_REQUESTED: "DETAILS_REQUESTED", VIEWING_REQUESTED: "VIEWING_REQUESTED",
  TERMS_ACCEPTED: "TERMS_ACCEPTED", EXPLICIT_INTENT: "EXPLICIT_INTENT"
});
const READINESS_WEIGHT = Object.freeze({
  SELECTED: 20, BUDGET_FIT: 15, CONTACT_CONSENT: 10, DETAILS_REQUESTED: 10,
  VIEWING_REQUESTED: 20, TERMS_ACCEPTED: 15, EXPLICIT_INTENT: 10
});
export const READINESS_ADVANCED = 90;

/**
 * Score from recorded events only (each counts once). ≥90 moves the client to closer follow-up;
 * it is never consent, never price acceptance and never permission to close.
 */
export function readiness(events = []) {
  const seen = [...new Set((Array.isArray(events) ? events : []).map(upper).filter((e) => e in READINESS_WEIGHT))];
  const score = Math.min(100, seen.reduce((sum, e) => sum + READINESS_WEIGHT[e], 0));
  return { score, events: seen, advanced: score >= READINESS_ADVANCED, approval: false, autoClose: false };
}

// ------------------------------------------------------------------ negotiation mandate

export const MANDATE = Object.freeze({ WITHIN: "WITHIN_MANDATE", OWNER_APPROVAL: "OWNER_APPROVAL_REQUIRED", INVALID: "INVALID_OFFER" });

/**
 * A client's price against the mandate the owner recorded for this offer. «WITHIN» only means the
 * office may present it as acceptable in principle — the commitment is still confirmed by a person.
 * No recorded floor ⇒ the owner must answer. Silence is never acceptance (there is no ACCEPTED here).
 */
export function mandateDecision({ floor = null } = {}, proposedPrice) {
  const price = Number(proposedPrice);
  if (!Number.isFinite(price) || price <= 0) return MANDATE.INVALID;
  const min = Number(floor);
  if (!Number.isFinite(min) || min <= 0) return MANDATE.OWNER_APPROVAL;
  return price >= min ? MANDATE.WITHIN : MANDATE.OWNER_APPROVAL;
}
