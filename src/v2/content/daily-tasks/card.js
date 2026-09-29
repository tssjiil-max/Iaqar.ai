/**
 * Compact daily-task accordion card. Not the opportunity data card.
 * Collapsed cards show a reveal control only. State actions render while open.
 */

import { buildNegotiationAssistant } from "./negotiation-assistant-domain.js";
import {
  AGREEMENT_FIELDS,
  brokerPartyChoices,
  brokerUnreadCount,
  isLifecycleReadOnly,
  lastUpdateLine,
  lifecycleLabel,
  MESSAGE_KINDS,
  isMessageResponseEvent,
  matchEventLogRow,
  matchPartyName,
  messageThreads,
  projectMatchEvents,
  unreadUpdatesLabel
} from "../../../../public/js/match-event-domain.js";
import { formatOpportunityReference } from "../../../../public/js/reference-code-domain.js";

// Current negotiation state for a match task: derived from its event history,
// falling back to the Worker's persisted state for anything older than the history.
function matchStateOf(task = {}) {
  const projected = projectMatchEvents(task.negotiationActivity || []);
  const persisted = task.matchState || {};
  const lifecycle = [projected.lifecycle, persisted.lifecycle, task.matchLifecycle].find((value) => value && value !== "ACTIVE") || "ACTIVE";
  return {
    ...projected,
    client: projected.client || persisted.client || null,
    owner: projected.owner || persisted.owner || null,
    agreement: { ...(persisted.agreement || {}), ...(projected.agreement || {}) },
    clientSendCount: Math.max(projected.clientSendCount, Number(persisted.clientSendCount || 0)),
    ownerSendCount: Math.max(projected.ownerSendCount, Number(persisted.ownerSendCount || 0)),
    lifecycle
  };
}

function unreadBadgeHtml(task = {}) {
  const count = brokerUnreadCount(task.negotiationActivity || [], task.brokerSeenAt || "");
  return count > 0 ? `<span class="cv2-unread-badge" data-unread-updates="${count}">${escapeContentHtml(unreadUpdatesLabel(count))}</span>` : "";
}

function escapeContentHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function testIdForAction(actionId = "") {
  return {
    send_to_client: "send-client", resend_to_client: "send-client", send_to_owner: "send-owner",
    request_cooperation: "request-cooperation", accept_cooperation: "accept-cooperation", reject_cooperation: "reject-cooperation",
    confirm_deal: "complete-deal", confirm_viewing_completed: "complete-viewing", mark_viewing_serious: "viewing-serious",
    mark_viewing_follow_up: "viewing-follow-up", mark_viewing_not_serious: "viewing-not-serious", create_deal: "create-deal",
    open_offer: "match-details", open_details: "match-details", share_details: "share-details",
    accept_platform_opportunity: "accept-platform", decline_platform_opportunity: "decline-platform"
  }[actionId] || "";
}

function buttonHtml(action, kind) {
  if (!action?.id || !action?.label) return "";
  const cls = kind === "primary" ? "cv2-exec-primary" : action.variant === "text" ? "cv2-exec-secondary cv2-exec-text" : "cv2-exec-secondary";
  const attr = kind === "primary" ? "data-cv2-exec-primary" : "data-cv2-exec-secondary";
  const party = action.party ? ` data-party="${escapeContentHtml(action.party)}"` : "";
  const session = action.sessionKind ? ` data-session-kind="${escapeContentHtml(action.sessionKind)}"` : "";
  const testId = testIdForAction(action.id);
  const testAttr = testId ? ` data-testid="${escapeContentHtml(testId)}"` : "";
  return `<button type="button" class="${cls}" ${attr}="${escapeContentHtml(action.id)}"${party}${session}${testAttr}>${escapeContentHtml(action.label)}</button>`;
}
function nl(value) { return escapeContentHtml(value).replace(/\n/g, "<br>"); }
// Presentation-only line icons for the negotiation workspace (no data meaning).
const NEG_ICONS = Object.freeze({
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
  clipboard: '<rect x="5" y="4.5" width="14" height="16" rx="2.5"/><path d="M9 4.5V3.5h6v1"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4"/>',
  coins: '<ellipse cx="12" cy="6.5" rx="6.5" ry="2.5"/><path d="M5.5 6.5v4c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-4"/><path d="M5.5 10.5v4c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-4"/><path d="M5.5 14.5v3c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-3"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  building: '<rect x="5.5" y="3.5" width="13" height="17" rx="1.5"/><path d="M9 7.5h1.5M13.5 7.5H15M9 11h1.5M13.5 11H15M9 14.5h1.5M13.5 14.5H15"/><path d="M10.5 20.5v-3h3v3"/>',
  area: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path d="m4 4 5 5M20 4l-5 5M4 20l5-5M20 20l-5-5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="4" y="7.5" width="16" height="12" rx="2.5"/><path d="M16 13.5h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  doc: '<path d="M6.5 3.5h7.5l4 4v12.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-16a.5.5 0 0 1 .5-.5z"/><path d="M13.5 3.5v4.5h4.5"/><path d="M9 13h6M9 16.5h4"/>',
  user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c.9-4 3.8-6 7.5-6s6.6 2 7.5 6"/>',
  owner: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><circle cx="12" cy="12.5" r="2.2"/><path d="M8.5 20c.5-2 1.8-3.2 3.5-3.2s3 1.2 3.5 3.2"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  x: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.8-5"/>',
  sofa: '<path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path d="M3.5 12.5a1.5 1.5 0 0 1 3 0V15h11v-2.5a1.5 1.5 0 0 1 3 0V18H3.5z"/><path d="M6 18v2M18 18v2"/>',
  send: '<path d="M21 3.5 3.5 10.5l7 2.5 2.5 7z"/><path d="m21 3.5-10.5 9.5"/>',
  whatsapp: '<path d="M4.5 19.5 5.6 16A8 8 0 1 1 8.3 18.6z"/><path d="M9.3 9.2c.3 2 1.8 3.8 3.9 4.6l1.1-1.1 1.9.8-.3 1.6c-3.4.2-7.3-3.5-7.1-6.9l1.6-.3.8 1.9z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  handshake: '<path d="m3 11 4-4 4 1.5L14 7l3 1 4 3.5"/><path d="M7 7v6l4.5 4 2-1.5 2 1 2.5-3V8"/><path d="m10.5 12 2 2"/>'
});
function negIcon(name, className = "cv2-neg-icon") {
  return `<span class="${className}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${NEG_ICONS[name] || NEG_ICONS.doc}</svg></span>`;
}
const PARTY_CHOICE_ICON = Object.freeze({ interested: "heart", not_interested: "x", needs_time: "clock", viewing: "eye", another_viewing: "eye", preliminary_agreement: "check", price: "coins", equipment: "sofa" });
function dayLabel(value) {
  const at = new Date(value || "");
  if (Number.isNaN(at.getTime())) return "";
  const today = new Date(); const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(today) - start(at)) / 86400000);
  if (days === 0) return "اليوم";
  if (days === 1) return "أمس";
  return `${at.getDate()}/${at.getMonth() + 1}`;
}
function logIconFor(eventType = "") {
  const type = String(eventType || "").toUpperCase();
  if (type.includes("WHATSAPP")) return "whatsapp";
  if (type === "LINK_OPENED") return "link";
  if (type === "BROKER_MESSAGE") return "send";
  if (type === "BROKER_INTERNAL_NOTE" || type === "AGREEMENT_UPDATED") return "doc";
  if (/^MATCH_/.test(type)) return "handshake";
  if (/^OWNER_/.test(type)) return "owner";
  if (/^CLIENT_/.test(type)) return "user";
  return "clock";
}
function clockLabel(value) {
  const at = new Date(value); if (!Number.isFinite(at.getTime())) return "";
  return at.toLocaleString("en-US", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\u202f/g, " ").replace(/\s*AM/i, " ص").replace(/\s*PM/i, " م").replace(/\s+/g, " ").trim();
}
function purposeWord(listing = {}) {
  const purpose = String(listing.purpose || "").toUpperCase(); const isRequest = String(listing.kindLabel || "").includes("طلب");
  if (purpose === "RENT" || purpose === "LEASE_REQUEST") return "للإيجار";
  if (purpose === "SALE" || purpose === "PURCHASE" || purpose === "BUY") return isRequest ? "للشراء" : "للبيع";
  if (purpose === "INVESTMENT") return "للاستثمار"; return String(listing.purpose || "").trim();
}
function typePurpose(listing = {}) { const prefix = listing.propertyType ? (String(listing.kindLabel || "").includes("طلب") ? "طلب" : "عرض") : ""; return [prefix, listing.propertyType, purposeWord(listing)].filter(Boolean).join(" "); }
function districtOnly(listing = {}) { return String(listing.district || "").replace(/^حي\s+/u, "").trim(); }

function summaryHtml(task = {}) {
  const clock = task.clockLabel || task.badgeLabel;
  const badge = clock ? `<span class="cv2-exec-badge${task.badgeKey === "overdue" ? " is-late" : ""}">${escapeContentHtml(clock)}</span>` : "";
  const identity = task.identityLine || task.typePurposeLine ? `<p class="cv2-exec-summary">${escapeContentHtml(task.identityLine || task.typePurposeLine)}</p>` : (task.propertyLine ? `<p class="cv2-exec-summary">${nl(task.propertyLine)}</p>` : "");
  const city = task.placeLine && task.placeLine !== (task.identityLine || "") ? `<p class="cv2-exec-place">${escapeContentHtml(task.placeLine)}</p>` : "";
  const money = task.taskKind === "cooperation" ? "" : (task.moneyLine ? `<p class="cv2-exec-money">${nl(task.moneyLine)}</p>` : "");
  const reference = task.referenceCode ? `<p class="cv2-exec-ref">${escapeContentHtml(task.referenceCode)}</p>` : "";
  const count = task.candidateCountLine ? `<p class="cv2-exec-count">${escapeContentHtml(task.candidateCountLine)}</p>` : "";
  const partner = task.partnerLine ? `<p class="cv2-exec-partner">${nl(task.partnerLine)}</p>` : "";
  const proximity = task.proximityLine ? `<p class="cv2-exec-next">${escapeContentHtml(task.proximityLine)}</p>` : "";
  const reasons = task.taskKind === "platform_opportunity" && Array.isArray(task.reasonLabels) && task.reasonLabels.length ? `<div class="cv2-exec-reasons" data-testid="router-reasons"><strong>${escapeContentHtml(task.reasonTitle || "سبب ترشيح مكتبك")}</strong><ul>${task.reasonLabels.map((label) => `<li>${escapeContentHtml(label)}</li>`).join("")}</ul></div>` : "";
  const statusText = String(task.statusLabel || "").trim(); const status = statusText && statusText !== String(task.kindLabel || "").trim() ? `<p class="cv2-exec-status">${escapeContentHtml(statusText)}</p>` : "";
  const nextAction = String(task.nextActionLine || "").trim(); const next = nextAction && nextAction !== statusText ? `<p class="cv2-exec-next"><strong>${task.requiresAction ? "المطلوب الآن:" : "الحالة الآن:"}</strong> ${escapeContentHtml(nextAction)}</p>` : "";
  const negotiationLabels = { NOT_STARTED: "لم يبدأ", STARTED: "بدأ", WAITING_OWNER: "بانتظار المالك", WAITING_CLIENT: "بانتظار العميل", NEGOTIATING: "جاري", VIEWING_REQUESTED: "طلب معاينة", PRELIMINARY_AGREEMENT: "اتفاق مبدئي", AGREED: "متفق", CLOSED: "مغلق" };
  const negotiationStatus = negotiationLabels[String(task.negotiationStatus || "").toUpperCase()] || "";
  const negotiation = negotiationStatus ? `<p class="cv2-exec-status">التفاوض: ${escapeContentHtml(negotiationStatus)}</p>` : "";
  const lastActivity = String(task.lastNegotiationEvent || "").trim();
  const activity = lastActivity ? `<p class="cv2-exec-next"><strong>آخر نشاط:</strong> ${escapeContentHtml(lastActivity.replace(/^(?:المالك|العميل|النظام):\s*/u, ""))}</p>` : "";
  const unread = task.taskKind === "match_group" ? unreadBadgeHtml(task) : "";
  return `<header class="cv2-exec-head"><p class="cv2-exec-kind">${escapeContentHtml(task.kindLabel || "")}</p><span class="cv2-exec-head-meta">${unread}${badge}</span></header>${identity}${city}${count}${partner}${proximity}${reasons}${money}${reference}${status}${negotiation}${activity}${next}`;
}

function listingFacts(listing = {}, { moneyLabel = "", money = "" } = {}) {
  const bits = []; if (listing.propertyType) bits.push(`<p>نوع العقار: ${escapeContentHtml(listing.propertyType)}</p>`);
  const purpose = purposeWord(listing); if (purpose) bits.push(`<p>الغرض: ${escapeContentHtml(purpose)}</p>`);
  const district = districtOnly(listing); if (district) bits.push(`<p>الحي: ${escapeContentHtml(district)}</p>`); if (listing.city) bits.push(`<p>المدينة: ${escapeContentHtml(listing.city)}</p>`);
  const amount = money || listing.money; if (amount) { const label = moneyLabel || (listing.kindLabel === "طلب العميل" ? "الميزانية" : "السعر"); bits.push(`<p>${escapeContentHtml(label)}: ${escapeContentHtml(amount)}</p>`); }
  if (listing.area) { const area = String(listing.area).trim(); bits.push(`<p>المساحة: ${escapeContentHtml(/م/.test(area) ? area : `${area}م²`)}</p>`); } return bits.join("");
}
function listingBlock(title, listing = {}, money = "", moneyLabel = "") { const facts = listingFacts(listing, { money, moneyLabel }); if (!title && !facts) return ""; return `<div class="cv2-coop-block"><strong>${escapeContentHtml(title)}</strong>${facts || ""}</div>`; }
function matchFactBlock(title, listing = {}, moneyLabel = "") { const facts = listingFacts(listing, { moneyLabel }); if (!facts) return ""; return `<div class="cv2-coop-block"><strong>${escapeContentHtml(title)}</strong>${facts}</div>`; }
function normalizedFact(listing = {}, key = "") { if (key === "district") return districtOnly(listing).toLowerCase(); if (key === "purpose") { const purpose = String(listing.purpose || "").toUpperCase(); if (["RENT", "LEASE_REQUEST"].includes(purpose)) return "rent"; if (["SALE", "PURCHASE", "BUY"].includes(purpose)) return "sale"; } return String(listing[key] || "").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase(); }
function listingsDiffer(request = {}, offer = {}) { return ["propertyType", "purpose", "district", "city", "money", "area"].some((key) => normalizedFact(request, key) !== normalizedFact(offer, key)); }

function partyProgress(task = {}, party = "client") {
  const labels = (Array.isArray(task.timeline) ? task.timeline : []).map((event) => String(event?.label || "").trim()); const name = party === "owner" ? "المالك" : "العميل";
  const openedWhatsApp = labels.some((label) => label.includes(`واتساب ${party === "owner" ? "للمالك" : "للعميل"}`)); const openedLink = labels.some((label) => label.includes(`فتح ${name} الرابط`));
  const summary = party === "owner" ? task.coordinationOwnerSummary : task.coordinationClientSummary; const replied = Boolean(String(summary || "").trim()) || labels.some((label) => label.startsWith(`${name} `) && !label.includes("فتح")); return { openedWhatsApp, openedLink, replied };
}
function progressStep(label, done) { return `<span class="cv2-party-step${done ? " is-done" : ""}"><span aria-hidden="true">${done ? "✓" : "○"}</span>${escapeContentHtml(label)}</span>`; }
function clientShowedInterest(task = {}, state = matchStateOf(task)) {
  if (["interested", "preliminary_agreement"].includes(state.client?.choiceId)) return true;
  return /CLIENT_INTERESTED|CLIENT_NEEDS_DETAILS|VIEWING|NEGOTIATION|AGREED/.test(`${task.livingStage || ""} ${task.stateKey || ""}`.toUpperCase())
    || /مهتم|معاينة|معلومات|موافق|تخفيض|تفاوض|شرط/.test(String(task.coordinationClientSummary || ""));
}
// Sending never locks: the button is always an action (send / resend). Waiting for
// the other party is shown as status text only.
function partyControlButton(task, party, progress, state) {
  const isOwner = party === "owner";
  const hasContext = Boolean(task.matchId && task.offerId && task.requestId);
  const disabled = task.dataIntegrity === "INVALID_TASK_DATA" || !hasContext;
  const sendCount = isOwner ? state.ownerSendCount : state.clientSendCount;
  const sent = sendCount > 0 || progress.openedWhatsApp;
  const action = isOwner ? "send_to_owner" : "send_to_client"; const attr = isOwner ? "data-cv2-exec-secondary" : "data-cv2-exec-primary";
  const label = disabled ? "تعذر ربط جلسة التفاوض" : sent ? `إعادة الإرسال لل${isOwner ? "مالك" : "عميل"}` : `إرسال لل${isOwner ? "مالك" : "عميل"}`;
  const times = sendCount === 1 ? "مرة واحدة" : sendCount === 2 ? "مرتين" : `${sendCount} مرات`;
  const count = sendCount > 0 ? `<small class="cv2-party-send-count" data-party-send-count="${party}">أُرسل ${isOwner ? "للمالك" : "للعميل"} ${escapeContentHtml(times)}</small>` : "";
  return `<button type="button" class="cv2-party-control${disabled ? " is-disabled" : ""}" ${attr}="${action}" data-party="${party}" data-party-send="${party}" data-testid="party-send-${party}"${disabled ? " disabled" : ""}>${escapeContentHtml(label)}</button>${count}`;
}
function partyChoicesHtml(task = {}, party = "client", state, readOnly = false) {
  const listing = task.proposedListing || {};
  const choices = brokerPartyChoices({ propertyType: listing.propertyType || task.propertyType || "", purpose: listing.purpose || task.purpose || "" });
  const current = party === "owner" ? state.owner : state.client;
  const icon = (id) => negIcon(PARTY_CHOICE_ICON[id] || "doc", "cv2-choice-icon");
  const name = matchPartyName(party);
  const source = current ? (current.actorType === party ? `من رابط ${name}` : "سجّله الوسيط") : "";
  const currentLine = current ? `<p class="cv2-party-choice-current" data-party-choice-current="${party}">حالة ${escapeContentHtml(name)} الحالية: <strong>${escapeContentHtml(current.label)}</strong> <small>(${escapeContentHtml(source)})</small></p>` : `<p class="cv2-party-choice-current" data-party-choice-current="${party}">لم يختر ${escapeContentHtml(name)} بعد</p>`;
  if (readOnly) return currentLine;
  const buttons = choices.map((choice) => {
    const selected = current?.choiceId === choice.id;
    return `<button type="button" class="cv2-party-choice${selected ? " is-selected" : ""}" data-party-choice="${escapeContentHtml(choice.id)}" data-party="${party}" aria-pressed="${selected ? "true" : "false"}">${icon(choice.id)}${escapeContentHtml(choice.label)}</button>`;
  }).join("");
  return `${currentLine}<div class="cv2-party-choices" role="group" aria-label="خيارات ${escapeContentHtml(name)} (يسجلها الوسيط)" data-party-choices="${party}">${buttons}</div>`;
}
function whatsappOutboxHtml(task = {}, readOnly = false) {
  const pending = (Array.isArray(task.whatsappOutbox) ? task.whatsappOutbox : []).filter((item) => item && item.dispatchId);
  if (!pending.length || readOnly) return "";
  return `<div class="cv2-wa-outbox" data-whatsapp-outbox><h4>إشعارات واتساب للطرفين</h4><p class="cv2-wa-outbox-note">تُفتح عبر واتساب من جهازك. فتح واتساب لا يعني أن الرسالة وصلت.</p><ul>${pending.map((item) => {
    const name = matchPartyName(item.recipient);
    const action = item.phone
      ? `<button type="button" class="cv2-exec-secondary" data-whatsapp-handoff="${escapeContentHtml(item.dispatchId)}" data-recipient="${escapeContentHtml(item.recipient)}">فتح واتساب ل${item.recipient === "owner" ? "لمالك" : "لعميل"}</button>`
      : `<small>رقم تواصل ${escapeContentHtml(name)} غير متوفر</small>`;
    return `<li data-whatsapp-outbox-item="${escapeContentHtml(item.dispatchId)}"><span>${nl(item.text || "")}</span>${action}</li>`;
  }).join("")}</ul></div>`;
}
function partyProgressHtml(task = {}) {
  const state = matchStateOf(task);
  const readOnly = isLifecycleReadOnly(state.lifecycle);
  const side = (party, label) => {
    const progress = partyProgress(task, party);
    const summary = party === "owner" ? task.coordinationOwnerSummary : task.coordinationClientSummary;
    const waiting = !readOnly && party === "owner" && !clientShowedInterest(task, state) ? `<p class="cv2-party-status" data-party-status="owner">الحالة: بانتظار موافقة العميل — يمكنك الإرسال للمالك في أي وقت</p>` : "";
    const opened = (task.negotiationActivity || []).some((event) => event.eventType === "LINK_OPENED" && event.actorType === party);
    return `<div class="cv2-party-side" data-party-side="${party}"><header class="cv2-party-head">${negIcon(party === "owner" ? "owner" : "user", "cv2-party-avatar")}<h4>${label}</h4></header><div class="cv2-party-steps">${progressStep("واتساب", progress.openedWhatsApp || (party === "owner" ? state.ownerSendCount : state.clientSendCount) > 0)}${progressStep("فتح الرابط", progress.openedLink || opened)}${progressStep("رد", progress.replied || Boolean(state[party] && state[party].actorType === party))}</div><p>${escapeContentHtml(summary || "بانتظار الرد")}</p>${waiting}${partyChoicesHtml(task, party, state, readOnly)}${readOnly ? "" : partyControlButton(task, party, progress, state)}</div>`;
  };
  return `<section class="cv2-party-progress" aria-label="ردود المالك والعميل"><div class="cv2-party-columns">${side("owner", "المالك")}${side("client", "العميل")}</div>${whatsappOutboxHtml(task, readOnly)}<p class="cv2-party-progress-note">يختار كل طرف من رابطه وتصل اختياراته هنا مباشرة. فتح واتساب لا يعني أن الرابط وصل أو أن الطرف رد.</p></section>`;
}
function partyResponsesHtml(task = {}) { const rows = [["رد العميل", task.coordinationClientSummary], ["رد المالك", task.coordinationOwnerSummary]].filter(([, summary]) => String(summary || "").trim()); if (!rows.length) return ""; return `<section class="cv2-party-responses" aria-label="ردود الأطراف">${rows.map(([label, summary]) => `<div><strong>${escapeContentHtml(label)}</strong><p>${nl(summary)}</p></div>`).join("")}</section>`; }
function reasonItems(reasons = []) { return reasons.map((line) => { const value = String(line || "").trim(); if (!value) return ""; return `<li>${escapeContentHtml(value.startsWith("✓") ? value : `✓ ${value}`)}</li>`; }).join(""); }
function timelineHtml(task = {}, title = "الإجراءات التي تمت") { const events = Array.isArray(task.timeline) ? task.timeline : []; if (!events.length) return ""; const rows = events.map((event) => { const time = clockLabel(event.createdAt); return `<li>${time ? `<span class="cv2-exec-time">${escapeContentHtml(time)}</span>` : ""}<span>${escapeContentHtml(event.label)}</span></li>`; }).join(""); return `<div class="cv2-coop-block cv2-exec-timeline"><strong>${escapeContentHtml(title)}</strong>${task.referenceCode ? `<p class="cv2-exec-ref-inline">${escapeContentHtml(task.referenceCode)}</p>` : ""}<ol>${rows}</ol></div>`; }
function yourTurnHtml(task = {}) { const waiting = Boolean(task.waiting), line = String(task.yourTurnLine || "").trim(); if (!line) return ""; if (waiting) return `<div class="cv2-coop-turn is-waiting"><p>${nl(line)}</p><p>لا يوجد إجراء مطلوب منك الآن.</p></div>`; return `<div class="cv2-coop-turn"><strong>دورك الآن</strong><p>${nl(line)}</p></div>`; }
function cleanReasonLabel(value = "") { return String(value || "").replace(/^\s*✓\s*/u, "").trim(); }

function negotiationAssistantHtml(task = {}) {
  const vm = buildNegotiationAssistant(task);
  const stages = vm.stages.map((stage) => `<span class="cv2-neg-stage is-${stage.state}" data-neg-stage="${escapeContentHtml(stage.id)}"><span aria-hidden="true">${stage.state === "done" ? "✓" : stage.state === "current" ? "●" : "○"}</span>${escapeContentHtml(stage.label)}</span>`).join(`<span class="cv2-neg-arrow" aria-hidden="true">←</span>`);
  return `<section class="cv2-neg-assistant" data-negotiation-assistant data-current-stage="${escapeContentHtml(vm.currentStage)}">
    <div class="cv2-neg-stages" aria-label="تقدم التفاوض">${stages}</div>
    <p class="cv2-neg-summary"><strong>ملخص الوسيط:</strong> ${escapeContentHtml(vm.smartSummary)}</p>
    <div class="cv2-neg-parties"><span><strong>العميل:</strong> ${escapeContentHtml(vm.clientStatus)}</span><span><strong>المالك:</strong> ${escapeContentHtml(vm.ownerStatus)}</span></div>
    ${vm.priceGapPct !== null ? `<p class="cv2-neg-gap"><strong>فجوة السعر:</strong> ${escapeContentHtml(`${vm.priceGapPct}%`)}</p>` : ""}
    ${vm.interventionRequired ? `<div class="cv2-neg-intervention" role="status"><strong>تدخل الوسيط مطلوب</strong><p>${escapeContentHtml(vm.interventionLine)}</p></div>` : `<p class="cv2-neg-auto">المسار مستمر تلقائيًا — لا يحتاج تدخلًا الآن.</p>`}
  </section>`;
}

function matchHeroHtml(task = {}) {
  const listing = task.proposedListing || task.sourceListing || {}, reasons = (task.matchReasons || []).map(cleanReasonLabel).filter(Boolean), differences = (task.matchDifferences || []).map(cleanReasonLabel).filter(Boolean), reasonCount = reasons.length, client = partyProgress(task, "client");
  const livingStage = String(task.livingStage || "").toUpperCase(), stateKey = String(task.stateKey || "").toUpperCase(); const viewing = /VIEWING|APPOINTMENT|PROPERTY_CONFIRMATION/.test(livingStage) || String(task.coordinationClientSummary || "").includes("معاينة");
  const partyBadge = viewing ? "عميل يريد معاينة" : stateKey === "CLIENT_NEEDS_DETAILS" ? "العميل يحتاج تفاصيل أكثر" : stateKey === "MATCH_UNSUITABLE" ? "المطابقة غير مناسبة" : (livingStage === "CLIENT_INTERESTED" || stateKey === "CLIENT_INTERESTED") ? "العميل مهتم" : client.replied ? "وصل رد العميل" : (livingStage === "WAITING_CLIENT" || livingStage === "CLIENT_SENT" || stateKey === "AWAITING_CLIENT") ? "بانتظار رد العميل" : "بانتظار العميل";
  const quality = task.matchStrengthLabel || (reasonCount >= 4 ? "مطابقة قوية" : reasonCount >= 2 ? "مطابقة متوسطة" : "مطابقة مبدئية"); const trustedScore = task.hasReliableMatchScore && Number(task.matchScore) > 0 ? Math.round(Number(task.matchScore)) : 0; const scoreText = trustedScore ? `${trustedScore}%` : quality.replace(/^مطابقة\s+/u, ""); const clock = task.clockLabel || task.badgeLabel || ""; const title = typePurpose(listing) || task.identityLine || task.typePurposeLine || "مطابقة عقارية"; const location = [districtOnly(listing), listing.city].filter(Boolean).join("، ");
  const offerListing = [task.proposedListing, task.sourceListing].find((item) => String(item?.opportunityKind || "").toUpperCase() === "OFFER") || listing;
  const offerLocation = [offerListing.city, districtOnly(offerListing) ? `حي ${districtOnly(offerListing)}` : ""].filter(Boolean).join(" - ");
  const facts = [{ icon: "coins", label: "السعر", value: offerListing.money || task.moneyLine }, { icon: "pin", label: "الموقع", value: offerLocation }, { icon: "building", label: "نوع العقار", value: offerListing.propertyType }, { icon: "area", label: "المساحة", value: offerListing.area }];
  const refs = [["رقم العرض", formatOpportunityReference(task.offerId)], ["رقم الطلب", formatOpportunityReference(task.requestId)]];
  return `<section class="cv2-match-hero"><div class="cv2-match-badges"><span class="cv2-match-badge">☆ ${escapeContentHtml(quality)}</span><span class="cv2-match-badge is-party">♙ ${escapeContentHtml(partyBadge)}</span>${clock ? `<span class="cv2-match-clock">${escapeContentHtml(clock)}</span>` : ""}</div><div class="cv2-match-title-row"><div><h3>${escapeContentHtml(title)}</h3>${location ? `<p>${escapeContentHtml(location)}</p>` : ""}</div></div><div class="cv2-match-refs">${refs.map(([label, value]) => `<div><small>${label}</small><strong${value ? "" : ' class="is-empty"'}>${escapeContentHtml(value || "—")}</strong></div>`).join("")}</div><div class="cv2-match-facts">${facts.map((item) => `<div>${negIcon(item.icon, "cv2-fact-icon")}<small>${escapeContentHtml(item.label)}</small><strong${String(item.value || "").trim() ? "" : ' class="is-empty"'}>${escapeContentHtml(String(item.value || "").trim() || "—")}</strong></div>`).join("")}</div>${(reasonCount || differences.length || trustedScore) ? `<div class="cv2-match-score"><div class="cv2-match-score-count">${escapeContentHtml(scoreText)}</div><div><small>${trustedScore ? "درجة المطابقة" : "تقييم حسب البيانات المتاحة"}</small><strong>${escapeContentHtml(quality)}</strong><p>${reasonCount ? escapeContentHtml(`سبب المطابقة: ${reasonCount} أسباب واضحة`) : "لا توجد أسباب تفصيلية كافية"}</p></div><ul>${reasons.map((reason) => `<li><span>✓</span>${escapeContentHtml(reason)}</li>`).join("")}${differences.map((difference) => `<li class="is-warning"><span>!</span>${escapeContentHtml(difference)}</li>`).join("")}</ul></div>` : ""}</section>`;
}
function matchActionHtml(task = {}) { const line = String(task.yourTurnLine || task.nextActionLine || "").trim(); if (!line) return ""; return `<section class="cv2-match-action${task.waiting ? " is-waiting" : ""}"><span class="cv2-match-action-icon" aria-hidden="true">♙</span><div><strong>${task.waiting ? "الحالة الآن" : "دورك الآن"}</strong><p>${nl(line)}</p>${task.waiting ? `<small>لا يوجد إجراء مطلوب منك الآن.</small>` : ""}</div></section>`; }
function matchDetailsHtml(task = {}) { const request = task.sourceListing || {}, offer = task.proposedListing || {}; if (!listingsDiffer(request, offer)) return ""; return `<details class="cv2-match-fold"><summary><span>☷</span> تفاصيل المطابقة</summary><div class="cv2-match-fold-body">${matchFactBlock(request.kindLabel || "طلب العميل", request, "الميزانية")}${matchFactBlock(offer.kindLabel || "العرض المطابق", offer, "السعر")}</div></details>`; }
function matchCandidatesHtml(task = {}) {
  const candidates = Array.isArray(task.candidates) ? task.candidates : [];
  if (candidates.length < 2) return "";
  return `<section class="cv2-match-candidates" aria-label="المطابقات المرتبة"><h4>المطابقات حسب درجة الملاءمة</h4><ol>${candidates.map((candidate, index) => `<li${candidate.matchId === task.matchId ? ' class="is-current"' : ""}><strong>مرشح ${index + 1}</strong> ${escapeContentHtml(candidate.propertyLine || "")}${candidate.moneyLine ? ` · ${escapeContentHtml(candidate.moneyLine)}` : ""}${candidate.score > 0 ? ` · ${escapeContentHtml(Math.round(candidate.score))}%` : ""}</li>`).join("")}</ol></section>`;
}

// Replies are shown under the exact broker message they answer.
function messageRepliesHtml(thread = null) {
  if (!thread) return "";
  const kind = `<span class="cv2-neg-msg-kind" data-message-kind="${escapeContentHtml(thread.messageKind)}">${escapeContentHtml(thread.kindLabel)}</span>`;
  if (!thread.requiresReply) return kind;
  const replies = thread.recipients.map((party) => {
    const response = thread.latestByParty[party];
    const name = matchPartyName(party);
    if (!response) return `<li data-message-response="${escapeContentHtml(party)}" data-response-id="">بانتظار رد ${escapeContentHtml(name)}</li>`;
    const time = clockLabel(response.createdAt);
    return `<li data-message-response="${escapeContentHtml(party)}" data-response-id="${escapeContentHtml(response.responseId)}"><strong>ردّ ${escapeContentHtml(name)}: ${escapeContentHtml(response.responseLabel)}</strong>${response.responseText ? ` — ${escapeContentHtml(response.responseText)}` : ""}${time ? ` <span class="cv2-exec-time">${escapeContentHtml(time)}</span>` : ""}</li>`;
  }).join("");
  return `${kind}<ul class="cv2-neg-msg-replies" data-message-replies>${replies}</ul>`;
}
function negotiationActivityLogHtml(task = {}) {
  const events = Array.isArray(task.negotiationActivity) ? task.negotiationActivity : [];
  const threads = new Map(messageThreads(events, { viewer: "broker" }).map((thread) => [thread.eventId, thread]));
  const rows = events.filter((event) => !isMessageResponseEvent(event.eventType))
    .map(matchEventLogRow).filter(Boolean).reverse();
  if (!rows.length) return "";
  return `<div class="cv2-coop-block cv2-neg-log" data-negotiation-log><strong>${negIcon("clock", "cv2-title-icon")}الإجراءات التي تمت</strong><ol>${rows.map((row) => { const time = clockLabel(row.createdAt); const day = dayLabel(row.createdAt); const thread = threads.get(row.eventId); return `<li data-negotiation-log-kind="${escapeContentHtml(row.eventType)}" data-log-actor="${escapeContentHtml(row.actorType)}"${thread ? ` data-message-thread="${escapeContentHtml(row.eventId)}"` : ""}>${negIcon(logIconFor(row.eventType), "cv2-log-icon")}<span class="cv2-neg-log-body"><span class="cv2-neg-log-title">${escapeContentHtml(row.title)}</span>${row.message ? `<span class="cv2-neg-log-message">${nl(row.message)}</span>` : ""}${messageRepliesHtml(thread)}<span class="cv2-neg-log-meta">${row.recipient ? `<span data-log-recipient>المستلم: ${escapeContentHtml(row.recipient)}</span>` : ""}<span data-log-status>${escapeContentHtml(row.statusLabel)}</span></span></span><span class="cv2-neg-log-when">${day ? `<span>${escapeContentHtml(day)}</span>` : ""}${time ? `<span class="cv2-exec-time" data-log-time>${escapeContentHtml(time)}</span>` : ""}</span></li>`; }).join("")}</ol></div>`;
}
function lastUpdateHtml(task = {}) {
  const line = lastUpdateLine(task.negotiationActivity || []);
  return line ? `<p class="cv2-neg-last-update" data-last-update><strong>آخر تحديث:</strong> ${escapeContentHtml(line)}</p>` : "";
}
const AGREEMENT_DISPLAY = Object.freeze({ price: ["السعر المقترح", "coins"], viewingAt: ["موعد المعاينة", "calendar"], paymentMethod: ["طريقة الدفع", "wallet"], responseDuration: ["مدة الرد", "clock"], terms: ["الشروط", "doc"] });
function agreementHtml(task = {}) {
  const state = matchStateOf(task);
  const readOnly = isLifecycleReadOnly(state.lifecycle);
  const rows = AGREEMENT_FIELDS.map((field) => ({ ...field, current: state.agreement?.[field.id] }));
  // Price and viewing time are always shown (empty = "—"); other terms appear once agreed.
  const tiles = rows.filter((row) => row.current?.value || row.id === "price" || row.id === "viewingAt");
  const hasValues = rows.some((row) => row.current?.value);
  const current = `<dl class="cv2-agreement-current" data-agreement-current>${tiles.map((row) => { const [label, icon] = AGREEMENT_DISPLAY[row.id] || [row.label, "doc"]; const value = row.current?.value; return `<div${value ? ` data-agreement-field-value="${escapeContentHtml(row.id)}"` : ' class="is-empty"'}>${negIcon(icon, "cv2-fact-icon")}<dt>${escapeContentHtml(label)}</dt><dd>${escapeContentHtml(value || "—")}</dd></div>`; }).join("")}</dl>${hasValues ? "" : `<p class="cv2-agreement-empty">لم تُحدد بنود الاتفاق بعد.</p>`}`;
  const form = readOnly ? "" : `<div class="cv2-agreement-form" data-agreement-form><label>البند<select data-agreement-field>${AGREEMENT_FIELDS.map((field) => `<option value="${escapeContentHtml(field.id)}">${escapeContentHtml(field.label)}</option>`).join("")}</select></label><label>القيمة<input type="text" data-agreement-value maxlength="300" placeholder="اكتب القيمة المتفق عليها"></label><button type="button" class="cv2-exec-secondary" data-broker-action="agreement_update">تحديث الاتفاق</button></div>`;
  return `<div class="cv2-agreement" data-agreement>${current}${form}</div>`;
}
function lifecycleBannerHtml(task = {}) {
  const state = matchStateOf(task);
  if (!isLifecycleReadOnly(state.lifecycle)) return "";
  return `<div class="cv2-match-readonly" data-match-readonly="${escapeContentHtml(state.lifecycle)}" role="status"><strong>${escapeContentHtml(lifecycleLabel(state.lifecycle))}</strong><p>للعرض فقط — سجل التفاوض محفوظ.</p></div>`;
}
// Broker section: a message that is sent to a party is separate from an internal
// note that stays with the broker.
function brokerNegotiationPanelHtml(task = {}) {
  if (isLifecycleReadOnly(matchStateOf(task).lifecycle)) return "";
  const vm = buildNegotiationAssistant(task);
  const serious = task.seriousIntentConfirmed === true || String(task.viewingOutcome || "").toUpperCase() === "SERIOUS";
  // The select stays the single source of truth for the recipient; the segmented
  // buttons only set it (see syncBrokerAudience in the controller).
  const audiences = [["both", "الطرفان"], ["owner", "المالك"], ["client", "العميل"]];
  const audience = `<div class="cv2-broker-audience"><span class="cv2-broker-label" id="cv2-audience-${escapeContentHtml(task.id || "task")}">إرسال إلى</span><div class="cv2-audience-seg" role="radiogroup" aria-labelledby="cv2-audience-${escapeContentHtml(task.id || "task")}">${audiences.map(([value, label]) => `<button type="button" role="radio" aria-checked="${value === "client" ? "true" : "false"}" data-broker-audience-pick="${value}">${label}</button>`).join("")}</div><select data-broker-audience class="cv2-visually-hidden" tabindex="-1" aria-hidden="true"><option value="client">العميل</option><option value="owner">المالك</option><option value="both">الطرفان</option></select></div>`;
  const message = `<div class="cv2-broker-block" data-broker-message-block>${audience}<label class="cv2-broker-text">رسالة إلى الطرف<textarea data-broker-message maxlength="1000" rows="3" placeholder="اكتب رسالتك هنا..."></textarea></label><div class="cv2-broker-options"><label>نوع الرسالة<select data-broker-message-kind>${MESSAGE_KINDS.map((kind) => `<option value="${escapeContentHtml(kind.id)}">${escapeContentHtml(kind.label)}</option>`).join("")}</select></label><label class="cv2-broker-check"><input type="checkbox" data-broker-requires-reply checked> يطلب ردًا من الطرف</label></div><button type="button" class="cv2-exec-primary" data-broker-action="send_message">${negIcon("send", "cv2-btn-icon")}إرسال</button><small>تظهر الرسالة في رابط الطرف المختار وتُسجَّل في الإجراءات.</small></div>`;
  const note = `<div class="cv2-broker-block is-internal" data-broker-note-block><label class="cv2-broker-text">ملاحظة داخلية — لا تُرسل لأي طرف<textarea data-broker-internal-note maxlength="1000" rows="2" placeholder="اكتب ملاحظتك هنا..."></textarea></label><button type="button" class="cv2-exec-secondary" data-broker-action="save_internal_note">${negIcon("doc", "cv2-btn-icon")}حفظ ملاحظة</button></div>`;
  return `<section class="cv2-broker-panel" data-broker-panel><header class="cv2-broker-head">${negIcon("user", "cv2-party-avatar")}<div><h3>الوسيط</h3><p>أرسل رسالة أو قم بتوثيق ملاحظة</p></div></header><div class="cv2-broker-panel-body">${vm.interventionLine ? `<p class="cv2-neg-intervention-line">${escapeContentHtml(vm.interventionLine)}</p>` : ""}${message}${note}<div class="cv2-broker-decisions">${serious ? `<button type="button" class="cv2-exec-primary" data-broker-action="continue">بدء دورة الصفقة</button>` : ""}<button type="button" class="cv2-exec-secondary" data-broker-action="no_agreement">إنهاء المطابقة دون اتفاق</button></div></div></section>`;
}
function matchGroupBodyHtml(task = {}) {
  const activityLog = negotiationActivityLogHtml(task);
  return `<div class="cv2-coop-expanded cv2-match-expanded" data-match-negotiation-page><section data-match-section="property"><h3>${negIcon("home", "cv2-title-icon")}بيانات العقار</h3>${matchHeroHtml(task)}${matchDetailsHtml(task)}${matchCandidatesHtml(task)}</section><section data-match-section="agreement"><h3>${negIcon("clipboard", "cv2-title-icon")}ما تم الاتفاق عليه</h3>${lifecycleBannerHtml(task)}${agreementHtml(task)}${lastUpdateHtml(task)}${negotiationAssistantHtml(task)}${matchActionHtml(task)}</section><section data-match-section="parties">${partyProgressHtml(task)}</section><section data-match-section="broker">${brokerNegotiationPanelHtml(task)}</section>${activityLog}${timelineHtml(task, activityLog ? "سجل المتابعة" : "الإجراءات التي تمت")}</div>`;
}

function cooperationBodyHtml(task = {}) { const reasons = reasonItems(task.matchReasons || []), partnerTitle = task.partnerOfficeName || ""; return `<div class="cv2-coop-expanded">${listingBlock("مكتبك", task.ownListing, task.ownMoney, task.ownListing?.opportunityKind === "REQUEST" ? "الميزانية" : "السعر")}${partnerTitle ? listingBlock(partnerTitle, task.partnerListing, task.partnerMoney, "السعر") : ""}${task.viewerRoleLabel ? `<div class="cv2-coop-block"><strong>${escapeContentHtml(task.viewerRoleLabel)}</strong></div>` : ""}${reasons ? `<div class="cv2-coop-block"><strong>سبب التعاون</strong><ul>${reasons}</ul></div>` : ""}${yourTurnHtml(task)}${timelineHtml(task)}</div>`; }
function fullDetailsHtml(task = {}) { const rows = [["المرجع", task.referenceCode], ["نوع العقار", task.propertyType], ["الغرض", task.typePurposeLine], ["الحي", task.district], ["المدينة", task.city], ["السعر / الميزانية", task.priceOrBudget || task.moneyLine], ["الحالة", task.statusLabel]].filter(([, value]) => String(value || "").trim()); const listing = task.taskKind === "cooperation" ? `${listingBlock("مكتبك", task.ownListing, task.ownMoney)}${listingBlock(task.partnerOfficeName || "", task.partnerListing, task.partnerMoney)}` : `${matchFactBlock("طلب العميل", task.sourceListing || {})}${matchFactBlock("العرض المطابق", task.proposedListing || {})}`; return `<div class="cv2-exec-full-details" data-cv2-exec-full-details><strong>التفاصيل الكاملة</strong>${task.referenceCode ? `<p class="cv2-exec-ref-inline">${escapeContentHtml(task.referenceCode)}</p>` : ""}${listing}<dl>${rows.map(([label, value]) => `<div><dt>${escapeContentHtml(label)}</dt><dd>${escapeContentHtml(value)}</dd></div>`).join("")}</dl><button type="button" class="cv2-exec-secondary cv2-exec-text" data-cv2-exec-secondary="share_details">مشاركة التفاصيل</button><button type="button" class="cv2-exec-secondary cv2-exec-text" data-cv2-exec-close-details data-testid="close-details">إغلاق التفاصيل</button></div>`; }
function revealHtml(task, open) { const label = open ? (task.revealOpenLabel || "إخفاء البيانات") : (task.revealClosedLabel || "عرض البيانات"); const testId = task.taskKind === "cooperation" ? "coop-open" : task.taskKind === "platform_opportunity" ? "platform-open" : "match-open"; return `<button type="button" class="cv2-exec-reveal" data-cv2-exec-reveal data-testid="${testId}" aria-expanded="${open ? "true" : "false"}">${label}</button>`; }

export function buildDailyTaskCardHtml(task = {}, { open = false, detailsOpen = false } = {}) {
  const isMatchTask = task.taskKind === "match_group", isDirectTask = task.taskKind === "opportunity_action" || task.taskKind === "deal_action", showActions = open || isDirectTask, ownsPartyControls = open && isMatchTask;
  const primaryAction = ownsPartyControls && ["send_to_client", "resend_to_client", "send_to_owner"].includes(task.primaryAction?.id) ? null : task.primaryAction;
  const secondaryActions = ownsPartyControls ? (task.secondaryActions || []).filter((action) => !["send_to_client", "resend_to_client", "send_to_owner"].includes(action?.id)) : (task.secondaryActions || []);
  const primary = showActions ? buttonHtml(primaryAction, "primary") : "", secondary = showActions ? secondaryActions.map((action) => buttonHtml(action, "secondary")).join("") : "", actions = showActions && (primary || secondary) ? `<div class="cv2-exec-actions">${primary}${secondary}</div>` : "";
  const body = open && task.taskKind === "platform_opportunity" ? `<div class="cv2-exec-platform-body"><p>تظهر بيانات التواصل بعد استلام الفرصة.</p></div>` : open && task.taskKind === "cooperation" ? cooperationBodyHtml(task) : open && isMatchTask ? matchGroupBodyHtml(task) : open ? `${yourTurnHtml(task)}${timelineHtml(task)}` : "";
  const details = open && detailsOpen ? fullDetailsHtml(task) : "";
  return `<article class="cv2-exec-card${open ? " is-open" : ""}${detailsOpen ? " is-details-open" : ""}${task.taskKind === "cooperation" ? " is-coop" : ""}" data-cv2-exec-task data-task-kind="${escapeContentHtml(task.taskKind || "")}" data-task-state="${escapeContentHtml(task.stateKey || "")}" data-task-id="${escapeContentHtml(task.id || "")}" data-reference-code="${escapeContentHtml(task.referenceCode || "")}" data-cooperation-id="${escapeContentHtml(task.cooperationId || "")}" data-match-id="${escapeContentHtml(task.matchId || "")}" data-offer-id="${escapeContentHtml(task.offerId || "")}" data-request-id="${escapeContentHtml(task.requestId || "")}" data-opportunity-id="${escapeContentHtml(task.opportunityId || "")}" data-integrity="${escapeContentHtml(task.dataIntegrity || "ok")}" data-counterpart-id="${escapeContentHtml(task.counterpartOpportunityId || "")}" data-target-office="${escapeContentHtml(task.targetOfficeId || "")}" data-origin-office="${escapeContentHtml(task.originatingOfficeId || "")}" data-session-kind="${escapeContentHtml(task.sessionKind || "CLIENT_MATCH_REVIEW")}">${open && isMatchTask ? "" : `<div class="cv2-exec-summary-block">${summaryHtml(task)}</div>`}${body}${details}${actions}${isDirectTask ? "" : `<div class="cv2-exec-reveal-row">${revealHtml(task, open)}</div>`}</article>`;
}
export function buildDailyTaskEmptyHtml() { return `<section class="cv2-exec-empty" data-cv2-exec-empty><p class="cv2-exec-empty-title">لا توجد مهام تحتاج إجراء الآن</p><p class="cv2-exec-empty-hint">ستظهر هنا المطابقات والمتابعات التي تحتاج تدخلك.</p></section>`; }
export function buildDailyTaskListHtml(tasks = [], { openTaskId = null, detailsTaskId = null } = {}) { if (!tasks.length) return buildDailyTaskEmptyHtml(); return `<div class="cv2-exec-list" data-cv2-exec-list>${tasks.map((task) => buildDailyTaskCardHtml(task, { open: Boolean(openTaskId) && task.id === openTaskId, detailsOpen: Boolean(detailsTaskId) && task.id === detailsTaskId })).join("")}</div>`; }
