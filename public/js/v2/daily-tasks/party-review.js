/**
 * Minimal public destination for a minted party review token.
 * Read-only. Not a negotiation UI and not a second opportunity record.
 */

import { parsePartyLinkToken } from "./party-link-domain.js";
import { resolveStoredPartyLink } from "./party-link.js";

function escapeContentHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

export function buildPartyReviewHtml(record) {
  if (!record?.matchId) {
    return `<section class="content-v2-surface" data-cv2-party-review data-cv2-party-error>
      <p>رابط المراجعة غير صالح.</p>
    </section>`;
  }
  const role = record.party === "owner" ? "المالك" : "العميل";
  const property = escapeContentHtml(record.propertyLine || "العقار");
  const money = record.moneyLine
    ? `<p>${escapeContentHtml(record.moneyLine)}</p>`
    : "";
  return `<section class="content-v2-surface" data-cv2-party-review data-party="${escapeContentHtml(record.party || "client")}" data-match-id="${escapeContentHtml(record.matchId)}">
    <p>مراجعة مطابقة ${role}</p>
    <p>${property}</p>
    ${money}
    <p>رقم المطابقة: ${escapeContentHtml(record.matchId)}</p>
  </section>`;
}

export function resolvePartyReviewRecord(token) {
  return parsePartyLinkToken(token) || resolveStoredPartyLink(token);
}

export function mountPartyReviewContentV2(root, token) {
  if (!root) return false;
  const record = resolvePartyReviewRecord(token);
  root.innerHTML = buildPartyReviewHtml(record);
  root.classList.remove("is-details");
  return Boolean(record?.matchId);
}
