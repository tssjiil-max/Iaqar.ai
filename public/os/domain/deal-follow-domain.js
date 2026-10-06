/**
 * «متابعة الصفقة» — one entry point for a deal: where each part of it lives today and what state
 * it is in. It gathers links to the existing pages (nothing is moved or replaced):
 *
 *   التفاوض   → غرفة التفاوض            #/session/<id>
 *   المعاينة  → صفحة الفرصة (المطلوب الآن) #/journey/<id>?focus=viewing
 *   المستندات → صفحة الفرصة             #/journey/<id>?focus=documents
 *   السجل     → صفحة الفرصة             #/journey/<id>?focus=timeline
 *   الإغلاق   → إجراءات الفرصة           #/journey/<id>?focus=close
 *
 * Opening any of them changes nothing in the deal. Pure rules for the hub and the section bar.
 */

import { formatDateTime, formatPrice, relativeAgo, toDate } from "./format-domain.js";
import { PHASE, VIEWING_MINUTES, agreedPriceOf, journeyPhase, phaseInfo } from "./deal-flow-domain.js";
import { documentChecklist, documentSummary, documentSummaryText } from "./deal-documents-domain.js";
import { ROLE_LABEL, isOpenJourney, parsePayload } from "./session-domain.js";
import { awaitingParties, openRequests, pendingTerms } from "./negotiation-room-domain.js";

export const FOLLOW_SECTIONS = Object.freeze([
  { id: "negotiation", label: "التفاوض", icon: "handshake" },
  { id: "viewing", label: "المعاينة", icon: "calendar" },
  { id: "documents", label: "المستندات", icon: "doc-check" },
  { id: "timeline", label: "السجل", icon: "clock" },
  { id: "close", label: "الإغلاق", icon: "flag" }
]);

export function followRoute(journeyId, sectionId) {
  const id = String(journeyId || "");
  if (sectionId === "negotiation") return `session/${id}`;
  if (sectionId === "hub") return `deal/${id}`;
  return `journey/${id}?focus=${sectionId}`;
}

/** Which section a page shows: the room is «التفاوض»; the deal page by its focus. */
export function activeSection(page, focus = "") {
  if (page === "session") return "negotiation";
  if (page === "hub") return "";
  return FOLLOW_SECTIONS.some((section) => section.id === focus) ? focus : "";
}

const CLOSED_LABEL = Object.freeze({ CLOSED_WON: "تمت الصفقة", CLOSED_LOST: "أُغلقت دون صفقة" });

function viewingStatus(journey, now) {
  const viewing = journey.viewing || {};
  const state = String(viewing.state || "NONE").toUpperCase();
  const at = toDate(viewing.at);
  const when = at ? formatDateTime(at, now) : "";
  if (state === "DONE") return `تمت${viewing.resultLabel ? ` — ${viewing.resultLabel}` : ""}`;
  if (state === "CONFIRMED" && at) return now.getTime() >= at.getTime() + VIEWING_MINUTES * 60000 ? `انتهى الموعد (${when}) — سجّل النتيجة` : `مؤكدة ${when}`;
  if (state === "ACCEPTED") return `قُبل الموعد ${when} — بانتظار تأكيدك`;
  if (state === "PROPOSED") return `موعد مقترح ${when} — بانتظار الطرف الآخر`;
  if (viewing.rescheduleRequested) return "تحتاج موعدًا جديدًا";
  return "لم يُحدَّد موعد بعد";
}

function negotiationStatus(journey, now) {
  const parts = [];
  const agreed = agreedPriceOf(journey);
  if (agreed) parts.push(`السعر المتفق عليه ${formatPrice(agreed)}`);
  else if (isOpenJourney(journey)) {
    const waiting = awaitingParties(journey, now).map((role) => ROLE_LABEL[role]);
    parts.push(waiting.length ? `بانتظار رد ${waiting.join(" و")}` : "السعر لم يُتفق عليه بعد");
  }
  const pending = pendingTerms(journey).length;
  if (pending) parts.push(pending === 1 ? "بند واحد بانتظار الرد" : `${pending} بنود بانتظار الرد`);
  const requests = openRequests(journey).length;
  if (requests) parts.push(requests === 1 ? "طلب واحد للوسيط" : `${requests} طلبات للوسيط`);
  return parts.join(" · ") || "—";
}

/**
 * The five sections of a deal with a one-line state each.
 * [{ id, label, icon, route, status, attention }] — `attention` marks a section that waits for the broker.
 */
export function followSections(journey = {}, { events = [], now = new Date() } = {}) {
  const id = journey.journeyId || journey.id || "";
  const open = isOpenJourney(journey);
  const phase = journeyPhase(journey, now);
  const docs = documentSummary(documentChecklist(journey));
  const last = [...events].sort((a, b) => (toDate(b.at || b.createdAt)?.getTime() || 0) - (toDate(a.at || a.createdAt)?.getTime() || 0))[0];
  const status = {
    negotiation: negotiationStatus(journey, now),
    viewing: viewingStatus(journey, now),
    documents: documentSummaryText(docs),
    timeline: events.length ? `${events.length} حركة · آخرها ${relativeAgo(last.at || last.createdAt, now) || ""}`.trim() : "لا حركات بعد",
    close: open ? "الصفقة مفتوحة — الإتمام أو الإغلاق بقرارك" : [CLOSED_LABEL[journey.status] || "مغلقة", journey.outcome?.finalPrice ? formatPrice(journey.outcome.finalPrice) : "", journey.outcome?.reason || ""].filter(Boolean).join(" · ")
  };
  const attention = {
    negotiation: open && (openRequests(journey).length > 0 || Boolean(journey.session?.intervention?.required)),
    viewing: open && (phase === PHASE.VIEWING_RESULT || String(journey.viewing?.state || "").toUpperCase() === "ACCEPTED"),
    documents: open && phase === PHASE.FINAL_AGREEMENT && docs.missing > 0,
    timeline: false,
    close: open && phase === PHASE.FINAL_AGREEMENT
  };
  return FOLLOW_SECTIONS.map((section) => ({ ...section, route: followRoute(id, section.id), status: status[section.id], attention: attention[section.id] }));
}

/** The stage of the deal and the one thing to do next (from the deal's own current action). */
export function followSummary(journey = {}, now = new Date()) {
  const open = isOpenJourney(journey);
  const phase = journeyPhase(journey, now);
  const info = phaseInfo(phase);
  const action = journey.currentAction || null;
  return {
    open,
    stage: open ? info.stage : CLOSED_LABEL[journey.status] || "إغلاق",
    step: info.step,
    paused: String(journey.status || "").toUpperCase() === "PAUSED",
    nextLabel: !open ? "" : String(action?.label || info.action || ""),
    nextReason: !open ? "أُغلقت الصفقة ويبقى سجلها للاطلاع." : String(action?.reason || journey.lastEvent?.text || "")
  };
}

// ------------------------------------------------------------------ التواصل

/**
 * The two existing ways to reach the sides, named and explained. Both stay as they are;
 * nothing is sent from here — each button only opens the page where the broker sends it himself.
 */
export function communicationOptions(journey = {}) {
  const id = journey.journeyId || journey.id || "";
  const links = journey.sessionLinks || {};
  const opened = journey.session?.opened || {};
  const side = (role) => (opened[role] ? `${ROLE_LABEL[role]}: فتح رابطه` : links[role]?.hash ? `${ROLE_LABEL[role]}: الرابط جاهز ولم يُفتح` : `${ROLE_LABEL[role]}: لم يُجهَّز رابطه`);
  return [
    {
      id: "room", label: "غرفة التفاوض", icon: "handshake", button: "فتح غرفة التفاوض", route: `session/${id}`,
      what: "رابط خاص لكل طرف يتفاوض منه بالأزرار على السعر والبنود والمعاينة. ترسل الرابط بنفسك من صفحة الغرفة.",
      state: [side("owner"), side("client")].join(" · ")
    },
    {
      id: "proposal", label: "إرسال مقترح", icon: "send", button: "تجهيز مقترح", route: `journey/${id}?focus=compose`,
      what: "رسالة جاهزة لطرف واحد برابط رد خاص بها (سعر، معاينة، طلب معلومة). تُجهَّز في صفحة الفرصة ثم ترسلها أنت.",
      state: Object.keys(journey.activeProposals || {}).length ? "يوجد مقترح قائم — حالته في صفحة الفرصة" : "لا يوجد مقترح قائم الآن"
    }
  ];
}

/**
 * What the system knows about each contact step — and only that:
 *   أُنشئ       prepared inside the system
 *   فُتح واتساب  the broker opened WhatsApp from here (the system cannot know whether it was sent)
 *   فتح الرابط   the side opened its link (known for certain)
 *   وصل رد      an answer arrived through a link (known for certain)
 */
const CONTACT_STATE = Object.freeze({
  PROPOSAL_CREATED: { state: "created", label: "أُنشئ", certain: true },
  PROPOSAL_SUPERSEDED: { state: "created", label: "استُبدل", certain: true },
  SESSION_LINK: { state: "created", label: "أُنشئ", certain: true },
  WHATSAPP_OPENED: { state: "opened", label: "فُتح واتساب", certain: false, note: "لا يؤكد وصول الرسالة" },
  MESSAGE_SHARED: { state: "opened", label: "فُتحت المشاركة", certain: false, note: "لا يؤكد الإرسال" },
  SESSION_BROKER_MESSAGE: { state: "sent", label: "أُرسلت داخل الغرفة", certain: true, note: "يراها الطرف عند فتح رابطه" },
  SESSION_OPENED: { state: "seen", label: "فتح الطرف الرابط", certain: true },
  PARTY_REPLY: { state: "reply", label: "وصل رد", certain: true },
  SESSION_MOVE: { state: "reply", label: "رد داخل الغرفة", certain: true },
  CALL_OUTCOME: { state: "reply", label: "رد بعد اتصال", certain: false, note: "سجّله الوسيط" }
});
const SIDES = new Set(["owner", "client"]);

export function communicationLog(events = [], { limit = 12 } = {}) {
  return events
    .filter((event) => {
      const type = String(event.type || "");
      if (!CONTACT_STATE[type]) return false;
      // A move inside the room is a reply only when a side made it from its own link.
      if (type === "SESSION_MOVE") return SIDES.has(String(event.actorRole || parsePayload(event).role || ""));
      return true;
    })
    .sort((a, b) => (toDate(b.at || b.createdAt)?.getTime() || 0) - (toDate(a.at || a.createdAt)?.getTime() || 0))
    .slice(0, limit)
    .map((event) => {
      const kind = CONTACT_STATE[String(event.type)];
      const payload = parsePayload(event);
      return {
        id: String(event.eventId || event.id || ""), type: String(event.type), state: kind.state, label: kind.label, certain: kind.certain,
        note: kind.note || "", text: String(event.text || ""), role: String(payload.role || ""), at: event.at || event.createdAt || null
      };
    });
}
