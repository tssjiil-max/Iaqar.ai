/**
 * Opportunity card navigation — document-id helpers and deep-link parsing.
 * Hash form keeps the PWA on `/` so relative assets keep loading.
 */

export const OPPORTUNITY_DEEP_LINK_PREFIX = "#/opportunities/";

export function normalizeOpportunityDocumentId(value) {
  const id = String(value == null ? "" : value).trim();
  if (!id) return "";
  if (id.includes("/") || id.includes("\\") || id.includes("..")) return "";
  if (id.length > 128) return "";
  return id;
}

export function buildOpportunityDeepLinkHash(opportunityId) {
  const id = normalizeOpportunityDocumentId(opportunityId);
  return id ? `${OPPORTUNITY_DEEP_LINK_PREFIX}${encodeURIComponent(id)}` : "";
}

export function parseOpportunityIdFromHash(hash) {
  const raw = String(hash || "");
  const match = raw.match(/^#\/opportunities(?:-v2)?\/([^/?#]+)/);
  if (!match) return "";
  try {
    return normalizeOpportunityDocumentId(decodeURIComponent(match[1]));
  } catch {
    return "";
  }
}

export function parseOpportunityIdFromPathname(pathname) {
  const raw = String(pathname || "");
  const match = raw.match(/(?:^|\/)opportunities\/([^/]+)\/?$/);
  if (!match) return "";
  try {
    return normalizeOpportunityDocumentId(decodeURIComponent(match[1]));
  } catch {
    return "";
  }
}

export function parseOpportunityIdFromLocation(locationLike = {}) {
  return parseOpportunityIdFromHash(locationLike.hash)
    || parseOpportunityIdFromPathname(locationLike.pathname);
}

export function opportunityDeepLinkHref(locationLike = {}, opportunityId) {
  const hash = buildOpportunityDeepLinkHash(opportunityId);
  if (!hash) return "";
  const pathname = locationLike.pathname || "/";
  const search = locationLike.search || "";
  return `${pathname}${search}${hash}`;
}

export function stripOpportunityDeepLinkHref(locationLike = {}) {
  const pathname = locationLike.pathname || "/";
  const search = locationLike.search || "";
  return `${pathname}${search}`;
}

/**
 * Nested controls that already have their own action.
 * Do not treat a bare `<a>` without href as a separate action.
 */
export function isBankCardActionControl(target) {
  if (!target || typeof target.closest !== "function") return false;
  return Boolean(target.closest(
    "button, a[href], [data-summary-key], [data-bank-open-tasks], .bank-action"
  ));
}

if (typeof window !== "undefined") {
  window.IAQAR = window.IAQAR || {};
  window.IAQAR.opportunityNavigationDomain = Object.freeze({
    OPPORTUNITY_DEEP_LINK_PREFIX,
    normalizeOpportunityDocumentId,
    buildOpportunityDeepLinkHash,
    parseOpportunityIdFromHash,
    parseOpportunityIdFromPathname,
    parseOpportunityIdFromLocation,
    opportunityDeepLinkHref,
    stripOpportunityDeepLinkHref,
    isBankCardActionControl
  });
}
