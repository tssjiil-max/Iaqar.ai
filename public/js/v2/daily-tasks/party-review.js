/**
 * Legacy broker-surface party preview is retired.
 * Public party pages are rendered by party-entry + Worker sessions.
 */

export function buildPartyReviewHtml() {
  return "";
}

export function resolvePartyReviewRecord() {
  return null;
}

export function mountPartyReviewContentV2(root) {
  if (root) root.innerHTML = "";
  return false;
}
