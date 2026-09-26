/**
 * العروض والطلبات list item — reuses the approved opportunity data card.
 * Daily-task details keep their own mount; this file only binds offer/request records.
 */

import { evaluateMatchingReadiness } from "./opportunity-readiness-domain.js";
import { mapOpportunityDetailsV2ViewModel } from "./opportunity-details-v2-domain.js";
import { completenessLine } from "./v2/opportunity-details/view-model.js";
import {
  buildCompleteMissingButtonV2,
  buildOpportunityDataCardV2
} from "./v2/opportunity-details/data-card.js";
import {
  BANK_INBOX_STATUS,
  bankInboxSourceLabel,
  bankInboxStatusKey,
  bankInboxStatusLabel
} from "./bank-inbox-card-domain.js";
import { formatDailyTaskClock } from "./v2/daily-tasks/domain.js";
import { archiveActionLabel } from "./opportunity-delete-plan-domain.js";

const DAILY_TASK_ACTION_CODES = new Set([
  "review_match",
  "record_viewing_result",
  "view_appointment",
  "open_follow_up",
  "view_waiting",
  "open_negotiation"
]);

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#39;"
  }[character]));
}

function extraIdFor(opportunityId) {
  const safe = String(opportunityId || "x").replace(/[^A-Za-z0-9_-]/g, "");
  return `cv2DataExtra-${safe || "x"}`;
}

export function bankInboxStatusLine(record = {}, context = {}, vm = {}) {
  const action = context.action || null;
  if (action?.badge) {
    const count = Number(action.matchCount || 0);
    return action.category === "matches" && count > 1
      ? `${action.badge} — ${count}`
      : String(action.badge);
  }
  const key = bankInboxStatusKey(record, context);
  const label = bankInboxStatusLabel(key);
  if (key === BANK_INBOX_STATUS.NEEDS_COMPLETION) {
    const missing = completenessLine(vm);
    if (missing && missing !== label) return `${label} · ${missing}`;
  }
  return label;
}

export function bankOperationalNavigationDetail(button) {
  const actionCode = String(button?.getAttribute?.("data-opportunity-primary-action") || "").trim();
  if (!DAILY_TASK_ACTION_CODES.has(actionCode)) return null;
  const article = button?.closest?.("[data-cv2-inbox-item][data-opportunity-id]");
  const opportunityId = String(article?.getAttribute?.("data-opportunity-id") || "").trim();
  const matchId = String(button?.getAttribute?.("data-match-id") || "").trim();
  const operationId = String(button?.getAttribute?.("data-operation-id") || "").trim();
  if (!opportunityId) return null;
  return {
    opportunityId,
    matchId,
    operationId,
    actionCode,
    clientRequestId: String(button?.getAttribute?.("data-client-request-id") || "").trim(),
    ownerOfferId: String(button?.getAttribute?.("data-owner-offer-id") || "").trim(),
    propertyType: String(button?.getAttribute?.("data-property-type") || "").trim(),
    district: String(button?.getAttribute?.("data-district") || "").trim()
  };
}

export async function hydrateBankMatchReviewDetail(detail = {}, win = globalThis.window) {
  const matchId = String(detail.matchId || detail.recordId || detail.id || "").trim();
  const base = {
    ...detail,
    id: matchId || detail.id || "",
    recordId: matchId || detail.recordId || "",
    recordType: "match",
    matchId,
    actionMode: "primary",
    returnTarget: "bank_matches"
  };
  if (!matchId) return base;

  const matches = win?.IAQAR?.office?.refs?.matches;
  if (!matches?.doc) return base;

  try {
    const snapshot = await matches.doc(matchId).get();
    if (!snapshot?.exists) return base;
    const data = snapshot.data?.() || {};
    return {
      ...base,
      propertyType: data.propertyType || data.candidatePropertyType || base.propertyType || "",
      district: data.district || data.candidateDistrict || base.district || "",
      clientRequestId: data.clientRequestId || data.requestId || data.requestOpportunityId || base.clientRequestId || "",
      ownerOfferId: data.ownerOfferId || data.offerId || data.offerOpportunityId || base.ownerOfferId || "",
      status: data.status || base.status || "",
      workflowStage: data.workflowStage || base.workflowStage || "",
      appointmentAt: data.viewingAt || base.appointmentAt || null,
      viewingAt: data.viewingAt || base.viewingAt || null,
      nextFollowUpAt: data.nextFollowUpAt || base.nextFollowUpAt || null,
      ownerMediaMissing: data.ownerMediaMissing ?? base.ownerMediaMissing
    };
  } catch (error) {
    console.warn("[iaqar] exact bank match hydration failed", error);
    return base;
  }
}

function showOperationalNavigationError(doc, message) {
  const toast = doc?.getElementById?.("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  const timerHost = doc.defaultView || globalThis;
  timerHost.clearTimeout?.(showOperationalNavigationError.timer);
  showOperationalNavigationError.timer = timerHost.setTimeout?.(() => toast.classList.remove("show"), 2800);
}

function removeLegacyOpportunityOverlay(doc) {
  const overlay = doc?.getElementById?.("iaqarWorkflowOverlay");
  const title = doc?.getElementById?.("iaqarWorkflowTitle");
  if (!overlay || String(title?.textContent || "").trim() !== "إدارة الفرصة") return false;
  overlay.hidden = true;
  overlay.remove();
  return true;
}

export function installLegacyOpportunityWorkflowRetirement(doc = globalThis.document, win = globalThis.window) {
  if (!doc || !win?.addEventListener) return false;
  if (win.__iaqarLegacyOpportunityWorkflowRetired) return true;
  win.__iaqarLegacyOpportunityWorkflowRetired = true;

  win.addEventListener("iaqar:workflow-action", async (event) => {
    const detail = event.detail || {};
    if (String(detail.recordType || "") !== "match") return;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();

    let linkedOpportunityId = String(
      detail.opportunityId || detail.clientRequestId || detail.ownerOfferId || ""
    ).trim();
    if (!linkedOpportunityId) {
      const hydrated = await hydrateBankMatchReviewDetail(detail, win);
      linkedOpportunityId = String(
        hydrated.opportunityId || hydrated.clientRequestId || hydrated.ownerOfferId || ""
      ).trim();
    }

    const openOpportunityDetail = win.IAQAR?.openOpportunityDetail;
    if (linkedOpportunityId && typeof openOpportunityDetail === "function") {
      await openOpportunityDetail(linkedOpportunityId);
      return;
    }
    showOperationalNavigationError(
      doc,
      "تعذر فتح الفرصة المرتبطة بهذه المطابقة. حدّث الصفحة وحاول مرة أخرى."
    );
  }, true);

  removeLegacyOpportunityOverlay(doc);
  if (typeof win.MutationObserver === "function" && doc.documentElement) {
    const observer = new win.MutationObserver(() => removeLegacyOpportunityOverlay(doc));
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
    win.__iaqarLegacyOpportunityOverlayObserver = observer;
  }
  return true;
}

export function installBankOperationalActionBridge(doc = globalThis.document, win = globalThis.window) {
  if (!doc?.addEventListener || !win) return false;
  installLegacyOpportunityWorkflowRetirement(doc, win);
  if (doc.__iaqarBankOperationalActionBridgeBound) return true;
  doc.__iaqarBankOperationalActionBridgeBound = true;
  doc.addEventListener("click", async (event) => {
    const button = event.target?.closest?.("[data-opportunity-primary-action]");
    if (!button) return;
    const detail = bankOperationalNavigationDetail(button);
    if (!detail) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const openOpportunityDetail = win.IAQAR?.openOpportunityDetail;
    if (typeof openOpportunityDetail !== "function") {
      showOperationalNavigationError(
        doc,
        "تعذر فتح تفاصيل الفرصة الآن. حدّث الصفحة وحاول مرة أخرى."
      );
      return;
    }
    await openOpportunityDetail(detail.opportunityId);
  }, true);
  return true;
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  installBankOperationalActionBridge(document, window);
}

export function buildArchiveInboxRowHtml(record = {}, now = new Date()) {
  const opportunityId = String(record.id || record.opportunityId || "").trim();
  const vm = mapOpportunityDetailsV2ViewModel(opportunityId, record, {});
  const archivedAt = record.archivedAt || "";
  return `
    <article
      class="cv2-details archive-row"
      data-cv2-inbox-item
      data-archive-row
      data-testid="archive-row"
      data-opportunity-id="${esc(opportunityId)}"
      aria-label="${esc(["أرشيف", vm.referenceCode, vm.propertyPurpose].filter(Boolean).join(" — "))}">
      <div class="archive-row-main">
        <strong class="archive-row-ref">${esc(vm.referenceCode || "—")}</strong>
        <span>${esc(vm.propertyPurpose || record.propertyType || "—")}</span>
        <span>${esc(vm.district || record.district || "—")}</span>
        <span class="archive-row-date">أُرشِف ${esc(formatDailyTaskClock(archivedAt, now) || "—")}</span>
      </div>
      <div class="archive-row-actions">
        <button type="button" class="bank-action" data-archive-restore="${esc(opportunityId)}">استعادة</button>
        <button type="button" class="bank-action danger" data-archive-purge="${esc(opportunityId)}">حذف نهائي</button>
      </div>
    </article>`;
}

export function buildBankInboxCardHtml(record = {}, context = {}) {
  const opportunityId = String(record.id || record.opportunityId || "").trim();
  const readiness = evaluateMatchingReadiness(record);
  const vm = mapOpportunityDetailsV2ViewModel(opportunityId, record, { readiness });
  const statusKey = bankInboxStatusKey(record, context);
  const statusLabel = bankInboxStatusLabel(statusKey);
  const archived = Boolean(vm.archived);
  if (archived) return buildArchiveInboxRowHtml(record, context.now);
  const archiveLabel = archiveActionLabel(record);
  const action = context.action || null;
  const sourceLabel = bankInboxSourceLabel(record);
  const compactMeta = [vm.area, sourceLabel].filter(Boolean);
  const statusText = action
    ? `${action.badge}${action.category === "matches" && action.matchCount > 1 ? ` — ${action.matchCount}` : ""}`
    : "لا إجراء حالي";
  const actionOperation = action?.operation || {};
  const clientRequestId = actionOperation.clientRequestId || actionOperation.requestId || actionOperation.requestOpportunityId || "";
  const ownerOfferId = actionOperation.ownerOfferId || actionOperation.offerId || actionOperation.offerOpportunityId || "";
  const actionPropertyType = actionOperation.propertyType || actionOperation.candidatePropertyType || record.propertyType || vm.type || "";
  const actionDistrict = actionOperation.district || actionOperation.candidateDistrict || record.district || vm.district || "";
  const actionStrip = `
      <section class="bank-card-action bank-card-action--${esc(action?.tone || "quiet")}" data-opportunity-action-state="${esc(action?.category || "none")}">
        <div class="bank-card-action-head">
          <span class="bank-card-action-badge"><i class="bank-card-status-dot" aria-hidden="true"></i>${esc(statusText)}</span>
          ${action?.reason && action.reason !== statusText ? `<strong>${esc(action.reason)}</strong>` : ""}
        </div>
        ${action?.detail ? `<p class="bank-card-action-detail">${esc(action.detail)}</p>` : ""}
        ${action?.primaryAction ? `<div class="bank-card-action-row">
          <span><small>الإجراء التالي:</small> ${esc(action.primaryAction)}</span>
          <button type="button" class="bank-card-primary-action" data-opportunity-primary-action="${esc(action.actionCode)}"
            data-operation-id="${esc(action.operationId)}" data-match-id="${esc(action.matchId)}"
            data-client-request-id="${esc(clientRequestId)}" data-owner-offer-id="${esc(ownerOfferId)}"
            data-property-type="${esc(actionPropertyType)}" data-district="${esc(actionDistrict)}">${esc(action.primaryAction)}</button>
        </div>` : ""}
      </section>`;
  return `
    <article
      class="cv2-details${context.dataCardExpanded ? " is-card-expanded" : ""}${action ? ` has-bank-action is-${esc(action.tone)}` : ""}"
      data-cv2-inbox-item
      data-testid="inbox-row"
      data-opportunity-id="${esc(opportunityId)}"
      data-inbox-status="${esc(statusKey)}"
      aria-label="${esc([vm.propertyPurpose || vm.type, statusLabel].filter(Boolean).join(" — "))}">
      ${buildOpportunityDataCardV2(vm, {
        dataCardExpanded: Boolean(context.dataCardExpanded),
        extraId: extraIdFor(opportunityId),
        statusLine: bankInboxStatusLine(record, context, vm)
      })}
      ${compactMeta.length ? `<p class="bank-card-compact-meta">${compactMeta.map((item) => `<span>${esc(item)}</span>`).join("")}</p>` : ""}
      <div class="bank-card-share-wrap">
        <button type="button" class="bank-card-share-toggle" data-bank-share-toggle="${esc(opportunityId)}" aria-label="مشاركة الفرصة" aria-expanded="false">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a3 3 0 1 0-2.83-4A3 3 0 0 0 15 5c0 .18.02.35.05.52L8.91 9.1A3 3 0 1 0 9 14.9l6.05 3.58A3 3 0 0 0 15 19a3 3 0 1 0 .83-2.07l-6.06-3.58c.15-.44.15-1.26 0-1.7l6.06-3.58A3 3 0 0 0 18 8Z"/></svg>
        </button>
        <div class="bank-card-share-menu" data-bank-share-menu="${esc(opportunityId)}" hidden>
          <button type="button" data-bank-share-action="whatsapp">إرسال عبر واتساب</button>
          <button type="button" data-bank-share-action="telegram">إرسال عبر تيليجرام</button>
          <button type="button" data-bank-share-action="copy_text">نسخ العرض كنص</button>
          <button type="button" data-bank-share-action="copy_link">نسخ رابط المكتب</button>
          <button type="button" data-bank-share-action="native" data-bank-native-share>مشاركة عامة</button>
        </div>
      </div>
      ${actionStrip}
      ${buildCompleteMissingButtonV2(vm)}
      <div class="opp-archive-actions">
        <button type="button" class="opp-archive-link" data-inbox-edit="${esc(opportunityId)}">تعديل</button>
        <button type="button" class="opp-archive-link is-muted" data-inbox-archive="${esc(opportunityId)}">${esc(archiveLabel)}</button>
      </div>
    </article>`;
}
