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
  return `<button type="button" class="${cls}" ${attr}="${escapeContentHtml(action.id)}"${party}${session}>${escapeContentHtml(action.label)}</button>`;
}

function nl(value) {
  return escapeContentHtml(value).replace(/\n/g, "<br>");
}

function summaryHtml(task = {}) {
  const badge = task.badgeLabel
    ? `<span class="cv2-exec-badge${task.badgeKey === "overdue" ? " is-late" : ""}">${escapeContentHtml(task.badgeLabel)}</span>`
    : "";
  const money = task.taskKind === "cooperation"
    ? ""
    : (task.moneyLine ? `<p class="cv2-exec-money">${nl(task.moneyLine)}</p>` : "");
  const property = task.propertyLine
    ? `<p class="cv2-exec-summary">${escapeContentHtml(task.propertyLine)}</p>`
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
  const kind = String(task.kindLabel || "").trim();
  const statusText = String(task.statusLabel || "").trim();
  const turnText = String(task.turnLine || "").trim();
  const nextText = String(task.nextActionLine || "").trim();
  const happenedText = String(task.happenedLine || "").trim();
  const turn = turnText && turnText !== kind && turnText !== statusText
    ? `<p class="cv2-exec-turn">${escapeContentHtml(turnText)}</p>`
    : "";
  const next = nextText && task.taskKind !== "cooperation" && nextText !== kind && nextText !== statusText
    ? `<p class="cv2-exec-next">${escapeContentHtml(nextText)}</p>`
    : "";
  const status = statusText && statusText !== kind
    ? `<p class="cv2-exec-status">${escapeContentHtml(statusText)}</p>`
    : "";
  const happened = happenedText && happenedText !== kind && happenedText !== statusText
    ? `<p class="cv2-exec-status">${escapeContentHtml(happenedText)}</p>`
    : "";
  return `<header class="cv2-exec-head">
      <p class="cv2-exec-kind">${escapeContentHtml(task.kindLabel || "")}</p>
      ${badge}
    </header>
    ${property}
    ${count}
    ${partner}
    ${proximity}
    ${money}
    ${happened}
    ${status}
    ${turn}
    ${next}`;
}

function listingFacts(listing = {}, money = "") {
  const line = [listing.propertyType, listing.district].filter(Boolean).join(" · ");
  const bits = [];
  if (line) bits.push(`<p>${escapeContentHtml(line)}</p>`);
  const amount = money || listing.money;
  if (amount) bits.push(`<p>${escapeContentHtml(amount)}</p>`);
  if (listing.area) bits.push(`<p>${escapeContentHtml(listing.area)}</p>`);
  return bits.join("");
}

function listingBlock(title, listing = {}, money = "") {
  const line = [listing.propertyType, listing.district].filter(Boolean).join(" · ");
  const amount = money || listing.money;
  const budget = amount ? `<p>السعر / الميزانية: ${escapeContentHtml(amount)}</p>` : "";
  return `<div class="cv2-coop-block">
    <strong>${escapeContentHtml(title)}</strong>
    <p>${escapeContentHtml(line || "—")}</p>
    ${budget}
  </div>`;
}

function matchFactBlock(title, listing = {}) {
  const facts = listingFacts(listing);
  if (!facts) return "";
  return `<div class="cv2-coop-block">
    <strong>${escapeContentHtml(title)}</strong>
    ${facts}
  </div>`;
}

function matchGroupBodyHtml(task = {}) {
  const reasons = (task.matchReasons || [])
    .map((line) => `<li>${escapeContentHtml(line)}</li>`)
    .join("");
  const ranked = (task.candidates || [])
    .map((item) => {
      const bits = [item.propertyLine, item.moneyLine, item.areaLine].filter(Boolean).join(" · ");
      return `<li>مرشح ${item.rank}: ${escapeContentHtml(bits || item.matchId || "")}</li>`;
    })
    .join("");
  return `<div class="cv2-coop-expanded cv2-match-expanded">
    ${matchFactBlock("طلب العميل", task.sourceListing || {})}
    ${matchFactBlock("العرض المقترح", task.proposedListing || {})}
    ${reasons ? `<div class="cv2-coop-block"><strong>سبب المطابقة</strong><ul>${reasons}</ul></div>` : ""}
    ${ranked ? `<div class="cv2-coop-block"><strong>المرشحون</strong><ol>${ranked}</ol></div>` : ""}
  </div>`;
}

function cooperationBodyHtml(task = {}) {
  const reasons = (task.matchReasons || [])
    .map((line) => `<li>${escapeContentHtml(line)}</li>`)
    .join("");
  const turn = task.yourTurnLine
    ? `<div class="cv2-coop-turn">${task.waiting ? "" : "<strong>دورك الآن</strong>"}<p>${nl(task.yourTurnLine)}</p></div>`
    : "";
  return `<div class="cv2-coop-expanded">
    ${listingBlock("طلب/عرض مكتبك", task.ownListing, task.ownMoney)}
    ${listingBlock("فرصة المكتب الثاني", task.partnerListing, task.partnerMoney)}
    <div class="cv2-coop-block">
      <strong>أهم نقاط التطابق</strong>
      <ul>${reasons}</ul>
    </div>
    <div class="cv2-coop-block">
      <strong>${escapeContentHtml(task.viewerRoleLabel || "")}</strong>
      <p>المكتب الآخر: ${escapeContentHtml(task.partnerOfficeName || "")}</p>
    </div>
    ${turn}
  </div>`;
}

function revealHtml(task, open) {
  const closed = task.revealClosedLabel || "عرض البيانات";
  const opened = task.revealOpenLabel || "إخفاء البيانات";
  const label = open ? opened : closed;
  return `<button type="button" class="cv2-exec-reveal" data-cv2-exec-reveal aria-expanded="${open ? "true" : "false"}">${label}</button>`;
}

export function buildDailyTaskCardHtml(task = {}, { open = false } = {}) {
  const primary = open ? buttonHtml(task.primaryAction, "primary") : "";
  const secondary = open
    ? (task.secondaryActions || []).map((action) => buttonHtml(action, "secondary")).join("")
    : "";
  const actions = open && (primary || secondary)
    ? `<div class="cv2-exec-actions">${primary}${secondary}</div>`
    : "";
  const body = open && task.taskKind === "cooperation"
    ? cooperationBodyHtml(task)
    : (open && task.taskKind === "match_group" ? matchGroupBodyHtml(task) : "");
  return `<article
      class="cv2-exec-card${open ? " is-open" : ""}${task.taskKind === "cooperation" ? " is-coop" : ""}"
      data-cv2-exec-task
      data-task-kind="${escapeContentHtml(task.taskKind || "")}"
      data-task-state="${escapeContentHtml(task.stateKey || "")}"
      data-task-id="${escapeContentHtml(task.id || "")}"
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

export function buildDailyTaskListHtml(tasks = [], { openTaskId = null } = {}) {
  if (!tasks.length) return buildDailyTaskEmptyHtml();
  return `<div class="cv2-exec-list" data-cv2-exec-list>
    ${tasks.map((task) => buildDailyTaskCardHtml(task, { open: Boolean(openTaskId) && task.id === openTaskId })).join("")}
  </div>`;
}
