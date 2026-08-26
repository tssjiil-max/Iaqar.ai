/**
 * Canonical in-app back navigation — pure logic (no DOM).
 */

export const NAV_OVERLAY_ORDER = Object.freeze([
  "opportunityReviewOverlay",
  "iaqarWorkflowOverlay",
  "officeSettings"
]);

export function topOverlayIdFromSnapshot(overlays = {}) {
  for (const id of NAV_OVERLAY_ORDER) {
    if (overlays[id]) return id;
  }
  return "";
}

/**
 * @param {object} snapshot
 * @param {Record<string, boolean>} [snapshot.overlays]
 * @param {boolean} [snapshot.bankDetailOpen]
 * @param {string} [snapshot.mainTab] operations|opportunities
 * @param {string} [snapshot.oppSubTab] add|bank
 * @param {string} [snapshot.accessScreen] public access-gate screen id, if any
 */
export function resolveBackAction(snapshot = {}) {
  const overlays = snapshot.overlays || {};
  const topOverlay = topOverlayIdFromSnapshot(overlays);

  if (topOverlay === "opportunityReviewOverlay") {
    return { type: "close-overlay", id: "opportunityReviewOverlay" };
  }
  if (topOverlay === "iaqarWorkflowOverlay") {
    return { type: "close-overlay", id: "iaqarWorkflowOverlay" };
  }
  if (topOverlay === "officeSettings") {
    return { type: "close-overlay", id: "officeSettings" };
  }
  if (snapshot.bankDetailOpen) {
    return { type: "close-bank-detail" };
  }
  if (snapshot.mainTab === "opportunities") {
    return { type: "switch-main-tab", tab: "operations" };
  }

  const accessScreen = String(snapshot.accessScreen || "").trim();
  if (accessScreen) {
    return { type: "access-back", screen: accessScreen };
  }

  return null;
}

export function shouldShowHeaderBack(snapshot = {}) {
  return resolveBackAction(snapshot) != null;
}

export function resolveAccessBackTarget(screen = "", { publicOffice = false } = {}) {
  const id = String(screen || "").trim();
  if (!id) return "home";
  if (id === "owner-intake" || id === "client-intake") {
    return publicOffice ? "public-office" : "home";
  }
  if (id === "forgot-password" || id === "platform-login") {
    return "login";
  }
  if (id === "broker-apply") {
    return "home";
  }
  return "home";
}

if (typeof window !== "undefined") {
  window.IAQAR = window.IAQAR || {};
  window.IAQAR.navigationDomain = Object.freeze({
    NAV_OVERLAY_ORDER,
    topOverlayIdFromSnapshot,
    resolveBackAction,
    shouldShowHeaderBack,
    resolveAccessBackTarget
  });
}
