/**
 * Lightweight party-shell HTML. No broker chrome.
 */

import {
  PARTY_INVALID_COPY,
  PARTY_REPLY_RECORDED
} from "./party-session-domain.js";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
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

export function buildPartyShellHtml(view = {}) {
  const photos = (view.property?.photos || [])
    .map((url) => `<img class="party-photo" src="${escapeHtml(url)}" alt="">`)
    .join("");
  const gallery = photos ? `<div class="party-photos">${photos}</div>` : "";
  const rows = [
    ["العقار والغرض", view.property?.typePurpose],
    ["السعر", view.property?.priceLabel],
    ["الموقع", view.property?.locationLabel],
    ["المساحة", view.property?.areaLabel],
    ["المواصفات", view.property?.specs]
  ].filter(([, value]) => value);
  const details = rows.map(([label, value]) => `<p class="party-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></p>`).join("");
  const logo = view.officeLogoUrl
    ? `<img class="party-logo" src="${escapeHtml(view.officeLogoUrl)}" alt="">`
    : "";
  const actions = (view.actions || []).map((action) => (
    `<button type="button" class="party-action" data-party-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`
  )).join("");
  const reply = view.replied
    ? `<p class="party-recorded">${PARTY_REPLY_RECORDED}</p><p class="party-reply">${escapeHtml(view.replyLabel || "")}</p>`
    : (actions ? `<div class="party-actions">${actions}</div>` : "");
  return `<main class="party-shell" data-party-shell data-party="${escapeHtml(view.party || "client")}">
    <header class="party-brand">
      ${logo}
      <p class="party-office">${escapeHtml(view.officeName || "المكتب العقاري")}</p>
    </header>
    <section class="party-card">
      <h1>${escapeHtml(view.title || "")}</h1>
      ${gallery}
      ${details}
      ${reply}
      <p class="party-status" id="partyStatus" hidden></p>
    </section>
  </main>`;
}

export function partyShellHasBrokerChrome(html) {
  return /أنا عميل|أنا مالك|تسجيل دخول مكتب|المهام اليومية|العروض والطلبات/.test(String(html || ""));
}
