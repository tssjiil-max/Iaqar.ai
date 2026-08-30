/**
 * Compact daily-task accordion card. Not the opportunity data card.
 * Collapsed cards show a reveal control only. State actions render while open.
 */

function escapeContentHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function testIdForAction(actionId = "") {
  return {
    send_to_client: "send-client",
    resend_to_client: "send-client",
    send_to_owner: "send-owner",
    request_cooperation: "request-cooperation",
    accept_cooperation: "accept-cooperation",
    reject_cooperation: "reject-cooperation",
    confirm_deal: "complete-deal",
    open_offer: "match-details",
    open_details: "match-details",
    share_details: "share-details",
    accept_platform_opportunity: "accept-platform",
    decline_platform_opportunity: "decline-platform"
  }[actionId] || "";
}

function buttonHtml(action, kind) {
  if (!action?.id || !action?.label) return "";
  const cls = kind === "primary"
    ? "cv2-exec-primary"
    : action.variant === "text"
      ? "cv2-exec-secondary cv2-exec-text"
      : "cv2-exec-secondary";
  const attr = kind === "primary" ? "data-cv2-exec-primary" : "data-cv2-exec-secondary";
  const party = action.party ? ` data-party="${escapeContentHtml(action.party)}"` : "";
  const session = action.sessionKind ? ` data-session-kind="${escapeContentHtml(action.sessionKind)}"` : "";
  const testId = testIdForAction(action.id);
  const testAttr = testId ? ` data-testid="${escapeContentHtml(testId)}"` : "";
  return `<button type="button" class="${cls}" ${attr}="${escapeContentHtml(action.id)}"${party}${session}${testAttr}>${escapeContentHtml(action.label)}</button>`;
}

function nl(value) {
  return escapeContentHtml(value).replace(/\n/g, "<br>");
}

function clockLabel(value) {
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return "";
  return at.toLocaleString("en-US", {
    timeZone: "Asia/Riyadh",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  })
    .replace(/\u202f/g, " ")
    .replace(/\s*AM/i, " ص")
    .replace(/\s*PM/i, " م")
    .replace(/\s+/g, " ")
    .trim();
}

function purposeWord(listing = {}) {
  const purpose = String(listing.purpose || "").toUpperCase();
  const isRequest = String(listing.kindLabel || "").includes("طلب");
  if (purpose === "RENT" || purpose === "LEASE_REQUEST") return isRequest ? "للاستئجار" : "للإيجار";
  if (purpose === "SALE" || purpose === "PURCHASE" || purpose === "BUY") return isRequest ? "للشراء" : "للبيع";
  if (purpose === "INVESTMENT") return "للاستثمار";
  return String(listing.purpose || "").trim();
}

function typePurpose(listing = {}) {
  return [listing.propertyType, purposeWord(listing)].filter(Boolean).join(" ");
}

function districtOnly(listing = {}) {
  return String(listing.district || "").replace(/^حي\s+/u, "").trim();
}

function summaryHtml(task = {}) {
  const clock = task.clockLabel || task.badgeLabel;
  const badge = clock
    ? `<span class="cv2-exec-badge${task.badgeKey === "overdue" ? " is-late" : ""}">${escapeContentHtml(clock)}</span>`
    : "";
  const identity = task.identityLine || task.typePurposeLine
    ? `<p class="cv2-exec-summary">${escapeContentHtml(task.identityLine || task.typePurposeLine)}</p>`
    : (task.propertyLine ? `<p class="cv2-exec-summary">${nl(task.propertyLine)}</p>` : "");
  const city = task.placeLine && task.placeLine !== (task.identityLine || "")
    ? `<p class="cv2-exec-place">${escapeContentHtml(task.placeLine)}</p>`
    : "";
  const money = task.taskKind === "cooperation"
    ? ""
    : (task.moneyLine ? `<p class="cv2-exec-money">${nl(task.moneyLine)}</p>` : "");
  const reference = task.referenceCode
    ? `<p class="cv2-exec-ref">${escapeContentHtml(task.referenceCode)}</p>`
    : "";
  const count = task.candidateCountLine
    ? `<p class="cv2-exec-count">${escapeContentHtml(task.candidateCountLine)}</p>`
    : "";
  const partner = task.partnerLine
    ? `<p class="cv2-exec-partner">${nl(task.partnerLine)}</p>`
    : "";
  const proximity = task.proximityLine
    ? `<p class="cv2-exec-next">${escapeContentHtml(task.proximityLine)}</p>`
    : "";
  const reasons = task.taskKind === "platform_opportunity" && Array.isArray(task.reasonLabels) && task.reasonLabels.length
    ? `<div class="cv2-exec-reasons" data-testid="router-reasons">
        <strong>${escapeContentHtml(task.reasonTitle || "سبب ترشيح مكتبك")}</strong>
        <ul>${task.reasonLabels.map((label) => `<li>${escapeContentHtml(label)}</li>`).join("")}</ul>
      </div>`
    : "";
  const statusText = String(task.statusLabel || "").trim();
  const status = statusText && statusText !== String(task.kindLabel || "").trim()
    ? `<p class="cv2-exec-status">${escapeContentHtml(statusText)}</p>`
    : "";
  return `<header class="cv2-exec-head">
      <p class="cv2-exec-kind">${escapeContentHtml(task.kindLabel || "")}</p>
      <span class="cv2-exec-head-meta">${badge}</span>
    </header>
    ${identity}
    ${city}
    ${count}
    ${partner}
    ${proximity}
    ${reasons}
    ${money}
    ${reference}
    ${status}`;
}

function listingFacts(listing = {}, { moneyLabel = "", money = "" } = {}) {
  const bits = [];
  if (listing.propertyType) {
    bits.push(`<p>نوع العقار: ${escapeContentHtml(listing.propertyType)}</p>`);
  }
  const purpose = purposeWord(listing);
  if (purpose) bits.push(`<p>الغرض: ${escapeContentHtml(purpose)}</p>`);
  const district = districtOnly(listing);
  if (district) bits.push(`<p>الحي: ${escapeContentHtml(district)}</p>`);
  if (listing.city) bits.push(`<p>المدينة: ${escapeContentHtml(listing.city)}</p>`);
  const amount = money || listing.money;
  if (amount) {
    const label = moneyLabel || (listing.kindLabel === "طلب العميل" ? "الميزانية" : "السعر");
    bits.push(`<p>${escapeContentHtml(label)}: ${escapeContentHtml(amount)}</p>`);
  }
  if (listing.area) {
    const area = String(listing.area).trim();
    const withUnit = /م/.test(area) ? area : `${area}م²`;
    bits.push(`<p>المساحة: ${escapeContentHtml(withUnit)}</p>`);
  }
  return bits.join("");
}

function listingBlock(title, listing = {}, money = "", moneyLabel = "") {
  const facts = listingFacts(listing, { money, moneyLabel });
  if (!title && !facts) return "";
  return `<div class="cv2-coop-block">
    <strong>${escapeContentHtml(title)}</strong>
    ${facts || ""}
  </div>`;
}

function matchFactBlock(title, listing = {}, moneyLabel = "") {
  const facts = listingFacts(listing, { moneyLabel });
  if (!facts) return "";
  return `<div class="cv2-coop-block">
    <strong>${escapeContentHtml(title)}</strong>
    ${facts}
  </div>`;
}

function normalizedFact(listing = {}, key = "") {
  if (key === "district") return districtOnly(listing).toLowerCase();
  if (key === "purpose") {
    const purpose = String(listing.purpose || "").toUpperCase();
    if (["RENT", "LEASE_REQUEST"].includes(purpose)) return "rent";
    if (["SALE", "PURCHASE", "BUY"].includes(purpose)) return "sale";
  }
  return String(listing[key] || "").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

function listingsDiffer(request = {}, offer = {}) {
  return ["propertyType", "purpose", "district", "city", "money", "area"]
    .some((key) => normalizedFact(request, key) !== normalizedFact(offer, key));
}

function matchOverviewHtml(task = {}) {
  const request = task.sourceListing || {};
  const offer = task.proposedListing || {};
  const primary = Object.keys(offer).length ? offer : request;
  const facts = listingFacts(primary, {
    moneyLabel: String(primary.kindLabel || "").includes("طلب") ? "الميزانية" : "السعر"
  });
  const details = listingsDiffer(request, offer)
    ? `<details class="cv2-match-details">
        <summary>تفاصيل المطابقة</summary>
        ${matchFactBlock(request.kindLabel || "طلب العميل", request, "الميزانية")}
        ${matchFactBlock(offer.kindLabel || "العرض المطابق", offer, "السعر")}
      </details>`
    : "";
  return `<div class="cv2-coop-block cv2-match-overview">
      <strong>ملخص المطابقة</strong>
      ${facts}
    </div>${details}`;
}

function partyProgress(task = {}, party = "client") {
  const labels = (Array.isArray(task.timeline) ? task.timeline : [])
    .map((event) => String(event?.label || "").trim());
  const name = party === "owner" ? "المالك" : "العميل";
  const openedWhatsApp = labels.some((label) => label.includes(`واتساب ${party === "owner" ? "للمالك" : "للعميل"}`));
  const openedLink = labels.some((label) => label.includes(`فتح ${name} الرابط`));
  const summary = party === "owner" ? task.coordinationOwnerSummary : task.coordinationClientSummary;
  const replied = Boolean(String(summary || "").trim()) || labels.some((label) => (
    label.startsWith(`${name} `) && !label.includes("فتح")
  ));
  return { openedWhatsApp, openedLink, replied };
}

function progressStep(label, done) {
  return `<span class="cv2-party-step${done ? " is-done" : ""}"><span aria-hidden="true">${done ? "✓" : "○"}</span>${escapeContentHtml(label)}</span>`;
}

function partyControlButton(task, party, progress) {
  const isOwner = party === "owner";
  const hasContext = Boolean(task.matchId && task.offerId && task.requestId);
  const disabled = task.dataIntegrity === "INVALID_TASK_DATA" || !hasContext;
  const action = isOwner ? "send_to_owner" : "send_to_client";
  const attr = isOwner ? "data-cv2-exec-secondary" : "data-cv2-exec-primary";
  const label = progress.openedWhatsApp
    ? `إعادة الإرسال لل${isOwner ? "مالك" : "عميل"}`
    : `إرسال لل${isOwner ? "مالك" : "عميل"}`;
  const unavailable = "تعذر ربط جلسة التفاوض";
  return `<button type="button" class="cv2-party-control${disabled ? " is-disabled" : ""}" ${attr}="${action}" data-party="${party}"${disabled ? " disabled" : ""}>${escapeContentHtml(disabled ? unavailable : label)}</button>`;
}

function partyProgressHtml(task = {}) {
  const client = partyProgress(task, "client");
  const owner = partyProgress(task, "owner");
  const row = (label, progress) => `<div class="cv2-party-progress-row">
    <strong>${label}</strong>
    <div>${progressStep("فتح واتساب", progress.openedWhatsApp)}${progressStep("فتح الرابط", progress.openedLink)}${progressStep("تم الرد", progress.replied)}</div>
  </div>`;
  return `<div class="cv2-coop-block cv2-party-progress">
    <strong>مسار العميل والمالك</strong>
    ${row("العميل", client)}
    ${row("المالك", owner)}
    <p class="cv2-party-progress-note">فتح واتساب لا يعني أن الرابط وصل أو أن الطرف رد.</p>
    <div class="cv2-party-controls">
      ${partyControlButton(task, "client", client)}
      ${partyControlButton(task, "owner", owner)}
    </div>
  </div>`;
}

function reasonItems(reasons = []) {
  return reasons
    .map((line) => {
      const text = String(line || "").trim();
      if (!text) return "";
      const marked = text.startsWith("✓") ? text : `✓ ${text}`;
      return `<li>${escapeContentHtml(marked)}</li>`;
    })
    .join("");
}

function timelineHtml(task = {}) {
  const events = Array.isArray(task.timeline) ? task.timeline : [];
  if (!events.length) return "";
  const rows = events.map((event) => {
    const time = clockLabel(event.createdAt);
    return `<li>
      ${time ? `<span class="cv2-exec-time">${escapeContentHtml(time)}</span>` : ""}
      <span>${escapeContentHtml(event.label)}</span>
    </li>`;
  }).join("");
  return `<div class="cv2-coop-block cv2-exec-timeline">
    <strong>الإجراءات التي تمت</strong>
    ${task.referenceCode ? `<p class="cv2-exec-ref-inline">${escapeContentHtml(task.referenceCode)}</p>` : ""}
    <ol>${rows}</ol>
  </div>`;
}

function yourTurnHtml(task = {}) {
  const waiting = Boolean(task.waiting);
  const line = String(task.yourTurnLine || "").trim();
  if (!line) return "";
  if (waiting) {
    return `<div class="cv2-coop-turn is-waiting">
      <p>${nl(line)}</p>
      <p>لا يوجد إجراء مطلوب منك الآن.</p>
    </div>`;
  }
  return `<div class="cv2-coop-turn">
    <strong>دورك الآن</strong>
    <p>${nl(line)}</p>
  </div>`;
}

function cleanReasonLabel(value = "") {
  return String(value || "").replace(/^\s*✓\s*/u, "").trim();
}

function matchHeroHtml(task = {}) {
  const listing = task.proposedListing || task.sourceListing || {};
  const reasons = (task.matchReasons || []).map(cleanReasonLabel).filter(Boolean);
  const reasonCount = reasons.length;
  const client = partyProgress(task, "client");
  const livingStage = String(task.livingStage || "").toUpperCase();
  const stateKey = String(task.stateKey || "").toUpperCase();
  const viewing = /VIEWING|APPOINTMENT|PROPERTY_CONFIRMATION/.test(String(task.livingStage || "").toUpperCase())
    || String(task.coordinationClientSummary || "").includes("معاينة");
  const partyBadge = viewing
    ? "عميل يريد معاينة"
    : (stateKey === "CLIENT_NEEDS_DETAILS"
      ? "العميل يحتاج تفاصيل أكثر"
      : (stateKey === "MATCH_UNSUITABLE"
        ? "المطابقة غير مناسبة"
        : (livingStage === "CLIENT_INTERESTED" || stateKey === "CLIENT_INTERESTED"
      ? "العميل مهتم"
      : (client.replied ? "وصل رد العميل" : (livingStage === "WAITING_CLIENT" || livingStage === "CLIENT_SENT" || stateKey === "AWAITING_CLIENT" ? "بانتظار رد العميل" : "بانتظار العميل")))));
  const quality = reasonCount >= 4 ? "مطابقة قوية" : "مطابقة مناسبة";
  const clock = task.clockLabel || task.badgeLabel || "";
  const title = typePurpose(listing) || task.identityLine || task.typePurposeLine || "مطابقة عقارية";
  const location = [districtOnly(listing), listing.city].filter(Boolean).join("، ");
  const facts = [
    { icon: "⌂", label: "نوع العقار", value: listing.propertyType },
    { icon: "◇", label: "السعر", value: listing.money || task.moneyLine },
    { icon: "□", label: "المساحة", value: listing.area }
  ].filter((item) => String(item.value || "").trim());
  return `<section class="cv2-match-hero">
    <div class="cv2-match-badges">
      <span class="cv2-match-badge">☆ ${escapeContentHtml(quality)}</span>
      <span class="cv2-match-badge is-party">♙ ${escapeContentHtml(partyBadge)}</span>
      ${clock ? `<span class="cv2-match-clock">${escapeContentHtml(clock)}</span>` : ""}
    </div>
    <div class="cv2-match-title-row">
      <span class="cv2-match-property-icon" aria-hidden="true">▥</span>
      <div><h3>${escapeContentHtml(title)}</h3>${location ? `<p>⌖ ${escapeContentHtml(location)}</p>` : ""}</div>
      ${task.referenceCode ? `<span class="cv2-match-reference">${escapeContentHtml(task.referenceCode)}</span>` : ""}
    </div>
    ${facts.length ? `<div class="cv2-match-facts">${facts.map((item) => `<div><span aria-hidden="true">${item.icon}</span><small>${escapeContentHtml(item.label)}</small><strong>${escapeContentHtml(item.value)}</strong></div>`).join("")}</div>` : ""}
    ${reasonCount ? `<div class="cv2-match-score">
      <div class="cv2-match-score-count">${reasonCount}/${reasonCount}</div>
      <div><small>سبب المطابقة</small><strong>${reasonCount >= 4 ? "تطابق كامل" : "معايير متطابقة"}</strong><p>${escapeContentHtml(`${reasonCount} معايير مؤكدة`)}</p></div>
      <ul>${reasons.map((reason) => `<li><span>✓</span>${escapeContentHtml(reason)}</li>`).join("")}</ul>
    </div>` : ""}
  </section>`;
}

function matchActionHtml(task = {}) {
  const line = String(task.yourTurnLine || task.nextActionLine || "").trim();
  if (!line) return "";
  return `<section class="cv2-match-action${task.waiting ? " is-waiting" : ""}">
    <span class="cv2-match-action-icon" aria-hidden="true">♙</span>
    <div><strong>${task.waiting ? "الحالة الآن" : "دورك الآن"}</strong><p>${nl(line)}</p>${task.waiting ? `<small>لا يوجد إجراء مطلوب منك الآن.</small>` : ""}</div>
  </section>`;
}

function matchDetailsHtml(task = {}) {
  const request = task.sourceListing || {};
  const offer = task.proposedListing || {};
  if (!listingsDiffer(request, offer)) return "";
  return `<details class="cv2-match-fold">
    <summary><span>☷</span> تفاصيل المطابقة</summary>
    <div class="cv2-match-fold-body">
      ${matchFactBlock(request.kindLabel || "طلب العميل", request, "الميزانية")}
      ${matchFactBlock(offer.kindLabel || "العرض المطابق", offer, "السعر")}
    </div>
  </details>`;
}

function matchGroupBodyHtml(task = {}) {
  const ranked = (task.candidates || [])
    .map((item) => {
      const bits = [item.propertyLine, item.moneyLine, item.areaLine].filter(Boolean).join(" · ");
      return `<li>مرشح ${item.rank}: ${escapeContentHtml(bits || item.matchId || "")}</li>`;
    })
    .join("");
  return `<div class="cv2-coop-expanded cv2-match-expanded">
    ${matchHeroHtml(task)}
    ${matchActionHtml(task)}
    ${partyProgressHtml(task)}
    ${matchDetailsHtml(task)}
    ${ranked && (task.candidates || []).length > 1 ? `<details class="cv2-match-fold"><summary><span>☷</span> المرشحون</summary><div class="cv2-match-fold-body"><ol>${ranked}</ol></div></details>` : ""}
    ${timelineHtml(task)}
  </div>`;
}

function cooperationBodyHtml(task = {}) {
  const reasons = reasonItems(task.matchReasons || []);
  const partnerTitle = task.partnerOfficeName || "";
  return `<div class="cv2-coop-expanded">
    ${listingBlock("مكتبك", task.ownListing, task.ownMoney, task.ownListing?.opportunityKind === "REQUEST" ? "الميزانية" : "السعر")}
    ${partnerTitle ? listingBlock(partnerTitle, task.partnerListing, task.partnerMoney, "السعر") : ""}
    ${task.viewerRoleLabel ? `<div class="cv2-coop-block"><strong>${escapeContentHtml(task.viewerRoleLabel)}</strong></div>` : ""}
    ${reasons ? `<div class="cv2-coop-block"><strong>سبب التعاون</strong><ul>${reasons}</ul></div>` : ""}
    ${yourTurnHtml(task)}
    ${timelineHtml(task)}
  </div>`;
}

function fullDetailsHtml(task = {}) {
  const phoneKeys = ["clientPhone", "ownerPhone", "contactPhone", "email"];
  const blocked = phoneKeys.some((key) => task[key] && String(task[key]).length > 6);
  void blocked;
  const rows = [
    ["المرجع", task.referenceCode],
    ["نوع العقار", task.propertyType],
    ["الغرض", task.typePurposeLine],
    ["الحي", task.district],
    ["المدينة", task.city],
    ["السعر / الميزانية", task.priceOrBudget || task.moneyLine],
    ["الحالة", task.statusLabel]
  ].filter(([, value]) => String(value || "").trim());
  const listing = task.taskKind === "cooperation"
    ? `${listingBlock("مكتبك", task.ownListing, task.ownMoney)}${listingBlock(task.partnerOfficeName || "", task.partnerListing, task.partnerMoney)}`
    : `${matchFactBlock("طلب العميل", task.sourceListing || {})}${matchFactBlock("العرض المطابق", task.proposedListing || {})}`;
  return `<div class="cv2-exec-full-details" data-cv2-exec-full-details>
    <strong>التفاصيل الكاملة</strong>
    ${task.referenceCode ? `<p class="cv2-exec-ref-inline">${escapeContentHtml(task.referenceCode)}</p>` : ""}
    ${listing}
    <dl>
      ${rows.map(([label, value]) => `<div><dt>${escapeContentHtml(label)}</dt><dd>${escapeContentHtml(value)}</dd></div>`).join("")}
    </dl>
    <button type="button" class="cv2-exec-secondary cv2-exec-text" data-cv2-exec-secondary="share_details">مشاركة التفاصيل</button>
    <button type="button" class="cv2-exec-secondary cv2-exec-text" data-cv2-exec-close-details data-testid="close-details">إغلاق التفاصيل</button>
  </div>`;
}

function revealHtml(task, open) {
  const closed = task.revealClosedLabel || "عرض البيانات";
  const opened = task.revealOpenLabel || "إخفاء البيانات";
  const label = open ? opened : closed;
  const testId = task.taskKind === "cooperation" ? "coop-open" : (task.taskKind === "platform_opportunity" ? "platform-open" : "match-open");
  return `<button type="button" class="cv2-exec-reveal" data-cv2-exec-reveal data-testid="${testId}" aria-expanded="${open ? "true" : "false"}">${label}</button>`;
}

export function buildDailyTaskCardHtml(task = {}, { open = false, detailsOpen = false } = {}) {
  const ownsPartyControls = open && (task.taskKind === "match_group" || task.matchId);
  const primaryAction = ownsPartyControls && ["send_to_client", "resend_to_client", "send_to_owner"].includes(task.primaryAction?.id)
    ? null
    : task.primaryAction;
  const secondaryActions = ownsPartyControls
    ? (task.secondaryActions || []).filter((action) => !["send_to_client", "resend_to_client", "send_to_owner"].includes(action?.id))
    : (task.secondaryActions || []);
  const primary = open ? buttonHtml(primaryAction, "primary") : "";
  const secondary = open
    ? secondaryActions.map((action) => buttonHtml(action, "secondary")).join("")
    : "";
  const actions = open && (primary || secondary)
    ? `<div class="cv2-exec-actions">${primary}${secondary}</div>`
    : "";
  const body = open && task.taskKind === "platform_opportunity"
    ? `<div class="cv2-exec-platform-body"><p>تظهر بيانات التواصل بعد استلام الفرصة.</p></div>`
    : (open && task.taskKind === "cooperation"
    ? cooperationBodyHtml(task)
    : (open && (task.taskKind === "match_group" || task.matchId) ? matchGroupBodyHtml(task) : (open ? `${yourTurnHtml(task)}${timelineHtml(task)}` : "")));
  const details = open && detailsOpen ? fullDetailsHtml(task) : "";
  return `<article
      class="cv2-exec-card${open ? " is-open" : ""}${detailsOpen ? " is-details-open" : ""}${task.taskKind === "cooperation" ? " is-coop" : ""}"
      data-cv2-exec-task
      data-task-kind="${escapeContentHtml(task.taskKind || "")}"
      data-task-state="${escapeContentHtml(task.stateKey || "")}"
      data-task-id="${escapeContentHtml(task.id || "")}"
      data-reference-code="${escapeContentHtml(task.referenceCode || "")}"
      data-cooperation-id="${escapeContentHtml(task.cooperationId || "")}"
      data-match-id="${escapeContentHtml(task.matchId || "")}"
      data-offer-id="${escapeContentHtml(task.offerId || "")}"
      data-request-id="${escapeContentHtml(task.requestId || "")}"
      data-opportunity-id="${escapeContentHtml(task.opportunityId || "")}"
      data-integrity="${escapeContentHtml(task.dataIntegrity || "ok")}"
      data-counterpart-id="${escapeContentHtml(task.counterpartOpportunityId || "")}"
      data-target-office="${escapeContentHtml(task.targetOfficeId || "")}"
      data-origin-office="${escapeContentHtml(task.originatingOfficeId || "")}"
      data-session-kind="${escapeContentHtml(task.sessionKind || "CLIENT_MATCH_REVIEW")}">
    ${open && (task.taskKind === "match_group" || task.matchId) ? "" : `<div class="cv2-exec-summary-block">${summaryHtml(task)}</div>`}
    ${body}
    ${details}
    ${actions}
    <div class="cv2-exec-reveal-row">${revealHtml(task, open)}</div>
  </article>`;
}

export function buildDailyTaskEmptyHtml() {
  return `<section class="cv2-exec-empty" data-cv2-exec-empty>
    <p class="cv2-exec-empty-title">لا توجد مهام تحتاج إجراء الآن</p>
    <p class="cv2-exec-empty-hint">ستظهر هنا المطابقات والمتابعات التي تحتاج تدخلك.</p>
  </section>`;
}

export function buildDailyTaskListHtml(tasks = [], { openTaskId = null, detailsTaskId = null } = {}) {
  if (!tasks.length) return buildDailyTaskEmptyHtml();
  return `<div class="cv2-exec-list" data-cv2-exec-list>
    ${tasks.map((task) => buildDailyTaskCardHtml(task, {
      open: Boolean(openTaskId) && task.id === openTaskId,
      detailsOpen: Boolean(detailsTaskId) && task.id === detailsTaskId
    })).join("")}
  </div>`;
}
