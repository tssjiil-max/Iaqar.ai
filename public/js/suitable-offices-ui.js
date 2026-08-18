/**
 * Suitable offices picker UI — tier sections and confirm step (Arabic only).
 */

import {
  SUITABLE_OFFICE_TIER,
  SUITABLE_OFFICE_TIER_LABELS
} from "./suitable-offices-domain.js";

const TIER_ORDER = [
  SUITABLE_OFFICE_TIER.SAME,
  SUITABLE_OFFICE_TIER.ADJACENT,
  SUITABLE_OFFICE_TIER.CITY
];

export const SUITABLE_OFFICES_INITIAL_PER_TIER = 5;

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function specialtyLabels(specialties = []) {
  const map = {
    sale: "بيع",
    purchase: "شراء",
    rent: "تأجير",
    property_management: "إدارة أملاك"
  };
  return (Array.isArray(specialties) ? specialties : [])
    .map((key) => map[key] || "")
    .filter(Boolean)
    .join("، ");
}

export function buildSuitableOfficeCardHtml(office = {}) {
  const verified = office.verified ? `<span class="bank-suitable-office-badge">موثق</span>` : "";
  const services = office.serviceNeighborhoodSummary
    || (office.serviceNeighborhoodLabels || []).slice(0, 3).join("، ");
  return `
    <article class="bank-suitable-office-card" data-suitable-office-id="${esc(office.officeId)}">
      <div class="bank-suitable-office-head">
        <strong>${esc(office.officeName || office.officeId)}</strong>
        ${verified}
      </div>
      <p class="bank-note">الحي الرئيسي: ${esc(office.primaryNeighborhoodLabel || "—")}</p>
      ${services ? `<p class="bank-note">الأحياء: ${esc(services)}</p>` : ""}
      <p class="bank-suitable-office-reason">${esc(office.reason || "")}</p>
      <button type="button" class="bank-action-primary iaqar-workflow-btn success" data-pick-suitable-office="${esc(office.officeId)}">اختيار المكتب</button>
    </article>`;
}

export function buildSuitableTierSectionHtml(tier, rows = [], options = {}) {
  const label = SUITABLE_OFFICE_TIER_LABELS[tier] || "";
  const expanded = options.expandedTiers?.[tier] === true;
  const limit = expanded ? rows.length : SUITABLE_OFFICES_INITIAL_PER_TIER;
  const visible = rows.slice(0, limit);
  const hiddenCount = rows.length - visible.length;
  const cards = visible.map((row) => buildSuitableOfficeCardHtml(row)).join("");
  const emptyMessage = `<p class="bank-note">لا توجد مكاتب في هذا القسم حاليًا.</p>`;
  const expandBtn = hiddenCount > 0
    ? `<button type="button" class="bank-action iaqar-workflow-btn secondary" data-expand-tier="${tier}">عرض بقية مكاتب المدينة (${hiddenCount})</button>`
    : "";
  return `
    <section class="bank-suitable-tier" data-tier="${tier}">
      <h5>${esc(label)}</h5>
      <div class="bank-suitable-office-list">${cards || emptyMessage}</div>
      ${expandBtn}
    </section>`;
}

export function buildSuitableOfficesTiersHtml(buckets = {}, expandedTiers = {}) {
  return TIER_ORDER.map((tier) =>
    buildSuitableTierSectionHtml(tier, buckets[tier] || [], { expandedTiers })
  ).join("");
}

export function buildSuitableOfficesShareSectionHtml() {
  return `
    <h4>اختر مكتبًا للتعاون</h4>
    <p class="bank-note iaqar-workflow-note">تظهر مكاتب الحي أولًا، ثم الأحياء المجاورة، ثم بقية المدينة.</p>
    <p class="section-status" id="bankSuitableOfficesStatus" role="status"></p>
    <label>بحث باسم المكتب أو الحي
      <input type="search" id="bankSuitableOfficesSearch" placeholder="ابحث باسم المكتب أو الحي" autocomplete="off">
    </label>
    <p class="bank-note" id="bankSuitableOfficesCount" hidden></p>
    <div id="bankSuitableOfficesTiers" class="bank-suitable-tiers"></div>
    <div id="bankSuitableOfficeConfirm" class="bank-suitable-confirm" hidden>
      <h5>تأكيد الإرسال</h5>
      <p class="bank-note" id="bankSuitableConfirmOfficeName"></p>
      <div class="bank-suitable-preview" id="bankSuitableSharePreview"></div>
      <label>رسالة اختيارية
        <textarea id="bankSuitableShareMessage" maxlength="500" placeholder="رسالة خاصة للمكتب المستلم"></textarea>
      </label>
      <button type="button" class="bank-action-primary iaqar-workflow-btn success" id="bankSuitableSendBtn">إرسال الفرصة للمكتب</button>
      <button type="button" class="bank-action iaqar-workflow-btn secondary" id="bankSuitableCancelPickBtn">اختيار مكتب آخر</button>
      <p class="section-status" id="bankShareStatus" role="status"></p>
      <p class="bank-note iaqar-workflow-note">ملخص آمن — بدون بيانات المالك أو العميل أو أرقامهم.</p>
    </div>
    <input type="hidden" id="bankDetailScopeTarget" value="">`;
}

export function buildSharedPreviewHtml(preview = {}) {
  const lines = [
    preview.propertyType,
    preview.purpose,
    preview.city,
    preview.district,
    preview.priceOrBudget != null && preview.priceOrBudget !== "" ? `${preview.priceOrBudget} ريال` : "",
    preview.area != null && preview.area !== "" ? `${preview.area} م²` : "",
    preview.rooms != null && preview.rooms !== "" ? `${preview.rooms} غرف` : ""
  ].filter(Boolean);
  const description = String(preview.description || "").trim();
  return `
    <p><strong>معاينة الفرصة المسموح بمشاركتها</strong></p>
    <p>${esc(lines.join(" — ") || "ملخص الفرصة")}</p>
    ${description ? `<p class="bank-note">${esc(description)}</p>` : ""}`;
}

export function buildIncomingCooperationItemHtml(request = {}, requestId = "") {
  const specs = [
    request.propertyType,
    request.city,
    request.district,
    request.priceOrBudget != null && request.priceOrBudget !== "" ? `${request.priceOrBudget} ريال` : "",
    request.area != null && request.area !== "" ? `${request.area} م²` : ""
  ].filter(Boolean).join(" — ");
  const sentAt = request.requestedAt || request.createdAt;
  const sentLabel = sentAt
    ? new Date(sentAt).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })
    : "";
  const statusLabel = incomingStatusLabel(request.status);
  return `
    <div class="bank-incoming-item bank-incoming-coop" data-request-id="${esc(requestId)}">
      <div>
        <strong>من ${esc(request.originatingOfficeName || request.originatingOfficeId || "")}</strong>
        <p>${esc(request.opportunityKind || "")} — ${esc(specs || "فرصة تعاون")}</p>
        ${sentLabel ? `<small>تاريخ الإرسال: ${esc(sentLabel)}</small>` : ""}
        <small>الحالة: ${esc(statusLabel)}</small>
      </div>
      <div class="bank-incoming-actions">
        <button type="button" class="bank-action-primary" data-accept-request="${esc(requestId)}">قبول التعاون</button>
        <button type="button" class="bank-action" data-details-request="${esc(requestId)}">طلب تفاصيل</button>
        <button type="button" class="bank-action" data-reject-request="${esc(requestId)}">اعتذار</button>
      </div>
    </div>`;
}

export function incomingStatusLabel(status = "") {
  const key = String(status || "").toUpperCase();
  if (key === "PENDING") return "بانتظار رد المكتب";
  if (key === "ACCEPTED") return "قَبِل المكتب";
  if (key === "DETAILS_REQUESTED") return "طلب تفاصيل";
  if (key === "REJECTED") return "اعتذر المكتب";
  if (key === "REVOKED" || key === "ENDED") return "انتهى التعاون";
  return status || "";
}
