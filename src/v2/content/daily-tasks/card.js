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
    share_details: "share-details"
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
  return at.toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    hour: "numeric",
    minute: "2-digit",
    hour12: false
  }).replace(/\s+/g, " ").trim();
}

function typePurpose(listing = {}) {
  const purpose = String(listing.purpose || "").toUpperCase();
  const word = purpose === "RENT" || purpose === "LEASE_REQUEST"
    ? "للإيجار"
    : purpose === "SALE" || purpose === "PURCHASE"
      ? "للبيع"
      : "";
  return [listing.propertyType, word].filter(Boolean).join(" ");
}

function districtOnly(listing = {}) {
  return String(listing.district || "").replace(/^حي\s+/u, "").trim();
}

function summaryHtml(task = {}) {
  const badge = task.badgeLabel
    ? `<span class="cv2-exec-badge${task.badgeKey === "overdue" ? " is-late" : ""}">${escapeContentHtml(task.badgeLabel)}</span>`
    : "";
  const reference = task.referenceCode
    ? `<span class="cv2-exec-ref">${escapeContentHtml(task.referenceCode)}</span>`
    : "";
  const money = task.taskKind === "cooperation"
    ? ""
    : (task.moneyLine ? `<p class="cv2-exec-money">${nl(task.moneyLine)}</p>` : "");
  const typeLine = task.typePurposeLine
    ? `<p class="cv2-exec-summary">${escapeContentHtml(task.typePurposeLine)}</p>`
    : (task.propertyLine ? `<p class="cv2-exec-summary">${nl(task.propertyLine)}</p>` : "");
  const place = task.placeLine
    ? `<p class="cv2-exec-place">${escapeContentHtml(task.placeLine)}</p>`
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
  const statusText = String(task.statusLabel || "").trim();
  const status = statusText && statusText !== String(task.kindLabel || "").trim()
    ? `<p class="cv2-exec-status">${escapeContentHtml(statusText)}</p>`
    : "";
  return `<header class="cv2-exec-head">
      <p class="cv2-exec-kind">${escapeContentHtml(task.kindLabel || "")}</p>
      <span class="cv2-exec-head-meta">${reference}${badge}</span>
    </header>
    ${typeLine}
    ${place}
    ${count}
    ${partner}
    ${proximity}
    ${money}
    ${status}`;
}

function listingFacts(listing = {}, { moneyLabel = "", money = "" } = {}) {
  const bits = [];
  const head = typePurpose(listing);
  if (head) bits.push(`<p>${escapeContentHtml(head)}</p>`);
  const district = districtOnly(listing);
  if (district) bits.push(`<p>${escapeContentHtml(district)}</p>`);
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

function matchGroupBodyHtml(task = {}) {
  const reasons = reasonItems(task.matchReasons || []);
  const requestTitle = task.sourceListing?.kindLabel || "طلب العميل";
  const offerTitle = task.proposedListing?.kindLabel || "العرض المطابق";
  const requestMoney = requestTitle.includes("طلب") ? "الميزانية" : "السعر";
  const offerMoney = offerTitle.includes("طلب") ? "الميزانية" : "السعر";
  const ranked = (task.candidates || [])
    .map((item) => {
      const bits = [item.propertyLine, item.moneyLine, item.areaLine].filter(Boolean).join(" · ");
      return `<li>مرشح ${item.rank}: ${escapeContentHtml(bits || item.matchId || "")}</li>`;
    })
    .join("");
  return `<div class="cv2-coop-expanded cv2-match-expanded">
    ${matchFactBlock(requestTitle, task.sourceListing || {}, requestMoney)}
    ${matchFactBlock(offerTitle, task.proposedListing || {}, offerMoney)}
    ${reasons ? `<div class="cv2-coop-block"><strong>سبب المطابقة</strong><ul>${reasons}</ul></div>` : ""}
    ${ranked && (task.candidates || []).length > 1 ? `<div class="cv2-coop-block"><strong>المرشحون</strong><ol>${ranked}</ol></div>` : ""}
    ${yourTurnHtml(task)}
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
  const testId = task.taskKind === "cooperation" ? "coop-open" : "match-open";
  return `<button type="button" class="cv2-exec-reveal" data-cv2-exec-reveal data-testid="${testId}" aria-expanded="${open ? "true" : "false"}">${label}</button>`;
}

export function buildDailyTaskCardHtml(task = {}, { open = false, detailsOpen = false } = {}) {
  const primary = open ? buttonHtml(task.primaryAction, "primary") : "";
  const secondary = open
    ? (task.secondaryActions || []).map((action) => buttonHtml(action, "secondary")).join("")
    : "";
  const actions = open && (primary || secondary)
    ? `<div class="cv2-exec-actions">${primary}${secondary}</div>`
    : "";
  const body = open && task.taskKind === "cooperation"
    ? cooperationBodyHtml(task)
    : (open && (task.taskKind === "match_group" || task.matchId) ? matchGroupBodyHtml(task) : (open ? `${yourTurnHtml(task)}${timelineHtml(task)}` : ""));
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
      data-counterpart-id="${escapeContentHtml(task.counterpartOpportunityId || "")}"
      data-target-office="${escapeContentHtml(task.targetOfficeId || "")}"
      data-origin-office="${escapeContentHtml(task.originatingOfficeId || "")}"
      data-session-kind="${escapeContentHtml(task.sessionKind || "CLIENT_MATCH_REVIEW")}">
    <div class="cv2-exec-summary-block">
      ${summaryHtml(task)}
    </div>
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
