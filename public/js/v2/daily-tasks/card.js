/**
 * Compact daily-task accordion card. Not the opportunity data card.
 * Collapsed cards show a reveal control only. State actions render while open.
 */

import { buildNegotiationAssistant } from "./negotiation-assistant-domain.js";
import {
  negotiationActivityLogRow,
  partyNegotiationChoices,
  summarizeNegotiationActivity
} from "../../negotiation-activity-domain.js";

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
  return `<header class="cv2-exec-head"><p class="cv2-exec-kind">${escapeContentHtml(task.kindLabel || "")}</p><span class="cv2-exec-head-meta">${badge}</span></header>${identity}${city}${count}${partner}${proximity}${reasons}${money}${reference}${status}${negotiation}${activity}${next}`;
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
function clientShowedInterest(task = {}, activity = summarizeNegotiationActivity(task.negotiationActivity)) {
  if (activity.clientChoice?.id === "interested") return true;
  return /CLIENT_INTERESTED|CLIENT_NEEDS_DETAILS|VIEWING|NEGOTIATION|AGREED/.test(`${task.livingStage || ""} ${task.stateKey || ""}`.toUpperCase())
    || /مهتم|معاينة|معلومات|موافق|تخفيض|تفاوض|شرط/.test(String(task.coordinationClientSummary || ""));
}
// Sending never locks: the button is always an action (send / resend). Waiting for
// the other party is shown as status text only.
function partyControlButton(task, party, progress, activity) {
  const isOwner = party === "owner";
  const hasContext = Boolean(task.matchId && task.offerId && task.requestId);
  const disabled = task.dataIntegrity === "INVALID_TASK_DATA" || !hasContext;
  const sendCount = isOwner ? activity.ownerSendCount : activity.clientSendCount;
  const sent = sendCount > 0 || progress.openedWhatsApp;
  const action = isOwner ? "send_to_owner" : "send_to_client"; const attr = isOwner ? "data-cv2-exec-secondary" : "data-cv2-exec-primary";
  const label = disabled ? "تعذر ربط جلسة التفاوض" : sent ? `إعادة الإرسال لل${isOwner ? "مالك" : "عميل"}` : `إرسال لل${isOwner ? "مالك" : "عميل"}`;
  const times = sendCount === 1 ? "مرة واحدة" : sendCount === 2 ? "مرتين" : `${sendCount} مرات`;
  const count = sendCount > 0 ? `<small class="cv2-party-send-count" data-party-send-count="${party}">أُرسل ${isOwner ? "للمالك" : "للعميل"} ${escapeContentHtml(times)}</small>` : "";
  return `<button type="button" class="cv2-party-control${disabled ? " is-disabled" : ""}" ${attr}="${action}" data-party="${party}" data-party-send="${party}" data-testid="party-send-${party}"${disabled ? " disabled" : ""}>${escapeContentHtml(label)}</button>${count}`;
}
function partyChoicesHtml(task = {}, party = "client", activity) {
  const listing = task.proposedListing || {};
  const choices = partyNegotiationChoices({ propertyType: listing.propertyType || task.propertyType || "", purpose: listing.purpose || task.purpose || "" });
  const current = party === "owner" ? activity.ownerChoice : activity.clientChoice;
  const icon = (id) => (id === "interested" ? "✓" : id === "not_interested" ? "✕" : "◇");
  const buttons = choices.map((choice) => {
    const selected = current?.id === choice.id;
    return `<button type="button" class="cv2-party-choice${selected ? " is-selected" : ""}" data-party-choice="${escapeContentHtml(choice.id)}" data-party="${party}" aria-pressed="${selected ? "true" : "false"}"><span aria-hidden="true">${icon(choice.id)}</span>${escapeContentHtml(choice.label)}</button>`;
  }).join("");
  const name = party === "owner" ? "المالك" : "العميل";
  const currentLine = current ? `<p class="cv2-party-choice-current" data-party-choice-current="${party}">خيار ${escapeContentHtml(name)} الحالي: <strong>${escapeContentHtml(current.label)}</strong></p>` : "";
  return `<div class="cv2-party-choices" role="group" aria-label="خيارات ${escapeContentHtml(name)}" data-party-choices="${party}">${buttons}</div>${currentLine}`;
}
function partyProgressHtml(task = {}) {
  const activity = summarizeNegotiationActivity(task.negotiationActivity);
  const side = (party, label) => {
    const progress = partyProgress(task, party);
    const summary = party === "owner" ? task.coordinationOwnerSummary : task.coordinationClientSummary;
    const waiting = party === "owner" && !clientShowedInterest(task, activity) ? `<p class="cv2-party-status" data-party-status="owner">الحالة: بانتظار موافقة العميل — يمكنك الإرسال للمالك في أي وقت</p>` : "";
    return `<div class="cv2-party-side" data-party-side="${party}"><h4>${label}</h4><div class="cv2-party-steps">${progressStep("واتساب", progress.openedWhatsApp || (party === "owner" ? activity.ownerSendCount : activity.clientSendCount) > 0)}${progressStep("فتح الرابط", progress.openedLink)}${progressStep("رد", progress.replied)}</div><p>${escapeContentHtml(summary || "بانتظار الرد")}</p>${waiting}${partyChoicesHtml(task, party, activity)}${partyControlButton(task, party, progress, activity)}</div>`;
  };
  return `<section class="cv2-party-progress" aria-label="تبادل قرارات الطرفين"><h3>ردود المالك والعميل</h3><div class="cv2-party-columns">${side("owner", "المالك")}${side("client", "العميل")}</div><p class="cv2-party-progress-note">اختيارات كل طرف تُحفظ وتُسجَّل في سجل الإجراءات. فتح واتساب لا يعني أن الرابط وصل أو أن الطرف رد.</p></section>`;
}
function partyResponsesHtml(task = {}) { const rows = [["رد العميل", task.coordinationClientSummary], ["رد المالك", task.coordinationOwnerSummary]].filter(([, summary]) => String(summary || "").trim()); if (!rows.length) return ""; return `<section class="cv2-party-responses" aria-label="ردود الأطراف">${rows.map(([label, summary]) => `<div><strong>${escapeContentHtml(label)}</strong><p>${nl(summary)}</p></div>`).join("")}</section>`; }
function reasonItems(reasons = []) { return reasons.map((line) => { const value = String(line || "").trim(); if (!value) return ""; return `<li>${escapeContentHtml(value.startsWith("✓") ? value : `✓ ${value}`)}</li>`; }).join(""); }
function timelineHtml(task = {}) { const events = Array.isArray(task.timeline) ? task.timeline : []; if (!events.length) return ""; const rows = events.map((event) => { const time = clockLabel(event.createdAt); return `<li>${time ? `<span class="cv2-exec-time">${escapeContentHtml(time)}</span>` : ""}<span>${escapeContentHtml(event.label)}</span></li>`; }).join(""); return `<div class="cv2-coop-block cv2-exec-timeline"><strong>الإجراءات التي تمت</strong>${task.referenceCode ? `<p class="cv2-exec-ref-inline">${escapeContentHtml(task.referenceCode)}</p>` : ""}<ol>${rows}</ol></div>`; }
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
  const facts = [{ icon: "⌂", label: "نوع العقار", value: listing.propertyType }, { icon: "◇", label: "السعر", value: listing.money || task.moneyLine }, { icon: "□", label: "المساحة", value: listing.area }].filter((item) => String(item.value || "").trim());
  return `<section class="cv2-match-hero"><div class="cv2-match-badges"><span class="cv2-match-badge">☆ ${escapeContentHtml(quality)}</span><span class="cv2-match-badge is-party">♙ ${escapeContentHtml(partyBadge)}</span>${clock ? `<span class="cv2-match-clock">${escapeContentHtml(clock)}</span>` : ""}</div><div class="cv2-match-title-row"><span class="cv2-match-property-icon" aria-hidden="true">▥</span><div><h3>${escapeContentHtml(title)}</h3>${location ? `<p>⌖ ${escapeContentHtml(location)}</p>` : ""}</div>${task.referenceCode ? `<span class="cv2-match-reference">${escapeContentHtml(task.referenceCode)}</span>` : ""}</div>${facts.length ? `<div class="cv2-match-facts">${facts.map((item) => `<div><span aria-hidden="true">${item.icon}</span><small>${escapeContentHtml(item.label)}</small><strong>${escapeContentHtml(item.value)}</strong></div>`).join("")}</div>` : ""}${(reasonCount || differences.length || trustedScore) ? `<div class="cv2-match-score"><div class="cv2-match-score-count">${escapeContentHtml(scoreText)}</div><div><small>${trustedScore ? "درجة المطابقة" : "تقييم حسب البيانات المتاحة"}</small><strong>${escapeContentHtml(quality)}</strong><p>${reasonCount ? escapeContentHtml(`سبب المطابقة: ${reasonCount} أسباب واضحة`) : "لا توجد أسباب تفصيلية كافية"}</p></div><ul>${reasons.map((reason) => `<li><span>✓</span>${escapeContentHtml(reason)}</li>`).join("")}${differences.map((difference) => `<li class="is-warning"><span>!</span>${escapeContentHtml(difference)}</li>`).join("")}</ul></div>` : ""}</section>`;
}
function matchActionHtml(task = {}) { const line = String(task.yourTurnLine || task.nextActionLine || "").trim(); if (!line) return ""; return `<section class="cv2-match-action${task.waiting ? " is-waiting" : ""}"><span class="cv2-match-action-icon" aria-hidden="true">♙</span><div><strong>${task.waiting ? "الحالة الآن" : "دورك الآن"}</strong><p>${nl(line)}</p>${task.waiting ? `<small>لا يوجد إجراء مطلوب منك الآن.</small>` : ""}</div></section>`; }
function matchDetailsHtml(task = {}) { const request = task.sourceListing || {}, offer = task.proposedListing || {}; if (!listingsDiffer(request, offer)) return ""; return `<details class="cv2-match-fold"><summary><span>☷</span> تفاصيل المطابقة</summary><div class="cv2-match-fold-body">${matchFactBlock(request.kindLabel || "طلب العميل", request, "الميزانية")}${matchFactBlock(offer.kindLabel || "العرض المطابق", offer, "السعر")}</div></details>`; }
function matchCandidatesHtml(task = {}) {
  const candidates = Array.isArray(task.candidates) ? task.candidates : [];
  if (candidates.length < 2) return "";
  return `<section class="cv2-match-candidates" aria-label="المطابقات المرتبة"><h4>المطابقات حسب درجة الملاءمة</h4><ol>${candidates.map((candidate, index) => `<li${candidate.matchId === task.matchId ? ' class="is-current"' : ""}><strong>مرشح ${index + 1}</strong> ${escapeContentHtml(candidate.propertyLine || "")}${candidate.moneyLine ? ` · ${escapeContentHtml(candidate.moneyLine)}` : ""}${candidate.score > 0 ? ` · ${escapeContentHtml(Math.round(candidate.score))}%` : ""}</li>`).join("")}</ol></section>`;
}

function negotiationActivityLogHtml(task = {}) {
  const rows = (Array.isArray(task.negotiationActivity) ? task.negotiationActivity : [])
    .map(negotiationActivityLogRow).filter(Boolean).reverse();
  if (!rows.length) return "";
  return `<div class="cv2-coop-block cv2-neg-log" data-negotiation-log><strong>سجل الإجراءات</strong><ol>${rows.map((row) => { const time = clockLabel(row.createdAt); return `<li data-negotiation-log-kind="${escapeContentHtml(row.kind)}"><span class="cv2-neg-log-title">${escapeContentHtml(row.title)}</span>${row.message ? `<span class="cv2-neg-log-message">${nl(row.message)}</span>` : ""}<span class="cv2-neg-log-meta">${row.recipient ? `<span data-log-recipient>المستلم: ${escapeContentHtml(row.recipient)}</span>` : ""}${time ? `<span class="cv2-exec-time" data-log-time>${escapeContentHtml(time)}</span>` : ""}<span data-log-status>${escapeContentHtml(row.statusLabel)}</span></span></li>`; }).join("")}</ol></div>`;
}
// Broker section: a message that is sent to a party is separate from an internal
// note that stays with the broker.
function brokerNegotiationPanelHtml(task = {}) {
  const vm = buildNegotiationAssistant(task);
  const serious = task.seriousIntentConfirmed === true || String(task.viewingOutcome || "").toUpperCase() === "SERIOUS";
  const message = `<div class="cv2-broker-block" data-broker-message-block><h4>رسالة الوسيط</h4><label>نص الرسالة<textarea data-broker-message maxlength="1000" rows="3" placeholder="اكتب رسالتك للطرف"></textarea></label><label>الموجّه إليه<select data-broker-audience><option value="client">العميل</option><option value="owner">المالك</option><option value="both">الطرفان</option></select></label><button type="button" class="cv2-exec-primary" data-broker-action="send_message">إرسال</button><small>تظهر الرسالة في رابط الطرف المختار وتُسجَّل في سجل الإجراءات.</small></div>`;
  const note = `<div class="cv2-broker-block is-internal" data-broker-note-block><h4>ملاحظة داخلية</h4><label>ملاحظة خاصة بالوسيط فقط — لا تُرسل لأي طرف<textarea data-broker-internal-note maxlength="1000" rows="2" placeholder="ملاحظة داخلية"></textarea></label><button type="button" class="cv2-exec-secondary" data-broker-action="save_internal_note">حفظ الملاحظة</button></div>`;
  return `<section class="cv2-broker-panel" data-broker-panel><h3>الوسيط</h3><div class="cv2-broker-panel-body">${vm.interventionLine ? `<p class="cv2-neg-intervention-line">${escapeContentHtml(vm.interventionLine)}</p>` : ""}${message}${note}<div class="cv2-broker-decisions">${serious ? `<button type="button" class="cv2-exec-primary" data-broker-action="continue">بدء دورة الصفقة</button>` : ""}<button type="button" class="cv2-exec-secondary" data-broker-action="no_agreement">إنهاء المطابقة دون اتفاق</button></div></div></section>`;
}
function matchGroupBodyHtml(task = {}) {
  return `<div class="cv2-coop-expanded cv2-match-expanded" data-match-negotiation-page><section data-match-section="property"><h3>بيانات العقار</h3>${matchHeroHtml(task)}${matchDetailsHtml(task)}${matchCandidatesHtml(task)}</section><section data-match-section="agreement"><h3>ما تم الاتفاق عليه</h3>${negotiationAssistantHtml(task)}${matchActionHtml(task)}</section><section data-match-section="parties">${partyProgressHtml(task)}</section><section data-match-section="broker">${brokerNegotiationPanelHtml(task)}</section>${negotiationActivityLogHtml(task)}${timelineHtml(task)}</div>`;
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
