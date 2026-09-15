/**
 * Exposes daily-tasks category domain for the shell inline script and tests.
 */
import * as operationsCenterDomain from "./operations-center-domain.js";
import * as dailyTasksDomain from "./daily-tasks-domain.js";
import * as brokerMatchUxDomain from "./broker-match-ux-domain.js";
import * as brokerAlertsDomain from "./broker-alerts-domain.js";

window.IAQAR = window.IAQAR || {};
window.IAQAR.operationsCenterDomain = operationsCenterDomain;
window.IAQAR.dailyTasksDomain = dailyTasksDomain;
window.IAQAR.brokerMatchUxDomain = brokerMatchUxDomain;
window.IAQAR.brokerAlertsDomain = brokerAlertsDomain;

function replayCachedOperationsForOpen(event) {
  const items = window.IAQAR?.operationsItems;
  if (!Array.isArray(items) || items.length === 0) return;

  const requestedId = String(event?.detail?.id || "").trim();
  const requestedMatchId = String(event?.detail?.matchId || "").trim();
  if (!requestedId && !requestedMatchId) return;

  const hasRequested = items.some((item) =>
    (requestedId && String(item?.id || "").trim() === requestedId) ||
    (requestedMatchId && String(item?.matchId || "").trim() === requestedMatchId)
  );
  if (!hasRequested) return;

  window.dispatchEvent(new CustomEvent("iaqar:operations-data", {
    detail: {
      items,
      authoritative: true
    }
  }));
}

// The bridge loads before operations-center-ui.js. If the authoritative feed
// arrived before the UI attached its listener, replay the cached snapshot
// synchronously so the same open-operation event can resolve the requested card.
window.addEventListener("iaqar:open-operation", replayCachedOperationsForOpen);
window.dispatchEvent(new CustomEvent("iaqar:operations-center-domain-ready"));
