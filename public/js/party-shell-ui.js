/**
 * Lightweight party-shell HTML. No broker chrome.
 */

import {
  PARTY_INVALID_COPY,
  PARTY_REPLY_RECORDED
} from "./party-session-domain.js";

function escapeHtml(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

export function buildPartyErrorHtml(message = PARTY_INVALID_COPY) {
  return `<main class="party-shell" data-party-shell data-party-error>
    <section class="party-card">
      <p class="party-error">${escapeHtml(message)}</p>
    </section>
  </main>`;
}

export function buildPartyLoadingHtml() {
  return `<main class="party-shell" data-party-shell data-party-loading>
    <section class="party-card"><p class="party-muted">جارٍ تجهيز الصفحة...</p></section>
  </main>`;
}

function propertyRows(property = {}) {
  const rows = [
    ["نوع العقار", property.propertyType],
    ["الغرض", property.purposeLabel],
    ["المدينة", property.city],
    ["الحي", property.district ? `حي ${String(property.district).replace(/^حي\s+/, "")}` : ""],
    ["السعر", property.priceLabel],
    ["المساحة", property.areaLabel],
    ["المواصفات", property.specs],
    ["اتجاه الشارع", property.streetDirection],
    ["عرض الشارع", property.streetWidthLabel],
    ["الواجهة", property.facade],
    ["العمق", property.depthLabel],
    ["رقم القطعة", property.plotNumber],
    ["الوصف", property.description]
  ];
  if (!property.propertyType && !property.purposeLabel && property.typePurpose) {
    rows.unshift(["نوع العقار", property.typePurpose]);
  }
  return rows
    .filter(([, value]) => value)
    .map(([label, value]) => `<p class="party-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></p>`)
    .join("");
}

function galleryHtml(property = {}) {
  const photos = Array.isArray(property.photos) ? property.photos.filter(Boolean) : [];
  if (!photos.length) {
    return `<p class="party-no-photos">لا توجد صور مرفقة</p>`;
  }
  const images = photos.map((url, index) => (
    `<img class="party-photo${index === 0 ? " is-hero" : ""}" src="${escapeHtml(url)}" alt="">`
  )).join("");
  return `<div class="party-photos">${images}</div>`;
}

function locationButtonHtml(property = {}) {
  const url = String(property.locationUrl || "").trim();
  if (!url) return "";
  return `<p class="party-location-wrap"><a class="party-location" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">عرض الموقع</a></p>`;
}

function actionButtons(actions = []) {
  return (actions || []).map((action) => (
    `<button type="button" class="party-action" data-party-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`
  )).join("");
}

export function buildPartyShellHtml(view = {}) {
  const property = view.property || {};
  const details = propertyRows(property);
  const logo = view.officeLogoUrl
    ? `<img class="party-logo" src="${escapeHtml(view.officeLogoUrl)}" alt="" onerror="this.remove()">`
    : "";
  const ownerStatus = view.ownerClientStatus
    ? `<p class="party-client-status">${escapeHtml(view.ownerClientStatus)}</p>`
    : "";
  const prompt = view.promptLine
    ? `<p class="party-prompt">${escapeHtml(view.promptLine)}</p>`
    : "";
  const revealed = view.revealedDetail?.value
    ? `<div class="party-revealed"><p>${escapeHtml(view.revealedDetail.label || "")}</p><strong>${escapeHtml(view.revealedDetail.value)}</strong></div>`
    : "";
  const primaryActions = actionButtons(view.actions);
  const followUp = actionButtons(view.followUpActions);
  let replyBlock = "";
  if (view.replied) {
    replyBlock = `<div class="party-reply-block">
      <p class="party-recorded">${PARTY_REPLY_RECORDED}</p>
      <p class="party-reply">${escapeHtml(view.replyLabel || "")}</p>
      ${view.followUpLabel ? `<p class="party-followup-choice">${escapeHtml(view.followUpLabel)}</p>` : ""}
      ${revealed}
      ${view.replyLabel === "أحتاج تفاصيل أكثر" && followUp ? `<p class="party-prompt">ما التفاصيل التي تحتاجها؟</p>` : ""}
      ${followUp ? `<div class="party-actions party-followup">${followUp}</div>` : ""}
    </div>`;
  } else if (primaryActions) {
    replyBlock = `<div class="party-reply-card-inner">${prompt}<div class="party-actions">${primaryActions}</div></div>`;
  }
  return `<main class="party-shell" data-party-shell data-party="${escapeHtml(view.party || "client")}">
    <header class="party-brand">
      ${logo}
      <p class="party-office">${escapeHtml(view.officeName || "المكتب العقاري")}</p>
    </header>
    <section class="party-card party-property-card">
      <h1>${escapeHtml(view.title || "")}</h1>
      ${ownerStatus}
      ${galleryHtml(property)}
      ${details}
      ${locationButtonHtml(property)}
    </section>
    <section class="party-card party-reply-card">
      ${replyBlock}
      <p class="party-status" id="partyStatus" hidden></p>
    </section>
  </main>`;
}

export function partyShellHasBrokerChrome(html) {
  return /أنا عميل|أنا مالك|تسجيل دخول مكتب|المهام اليومية|العروض والطلبات/.test(String(html || ""));
}
