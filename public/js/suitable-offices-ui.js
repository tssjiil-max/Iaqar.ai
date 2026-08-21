/**
 * واجهة التعاون مع المكاتب — بحث، اختيار متعدد، إرسال واحد.
 */

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

export function buildOfficeSearchResultHtml(office = {}) {
  const verified = office.verified ? `<span class="bank-coop-result-verified">موثق</span>` : "";
  const district = String(office.primaryNeighborhoodLabel || "").trim();
  const city = String(office.city || "").trim();
  return `
    <button type="button" class="bank-coop-search-result" data-pick-office-id="${esc(office.officeId)}">
      <strong>${esc(office.officeName || office.officeId)}</strong>
      <span>${esc([district ? `حي ${district}` : "", city].filter(Boolean).join(" — "))}</span>
      ${verified}
    </button>`;
}

export function buildOfficeSearchResultsHtml(offices = [], query = "") {
  const trimmed = String(query || "").trim();
  if (!trimmed) return "";
  if (!offices.length) {
    return `<p class="bank-coop-search-empty">لا توجد نتائج لـ «${esc(trimmed)}»</p>`;
  }
  return offices.map((office) => buildOfficeSearchResultHtml(office)).join("");
}

export function buildSelectedOfficeChipsHtml(selectedOffices = []) {
  if (!selectedOffices.length) {
    return `<p class="bank-coop-chips-empty">لم يتم اختيار مكتب بعد.</p>`;
  }
  return `
    <div class="bank-coop-chips" id="bankCoopSelectedChipsList">
      ${selectedOffices.map((office) => `
        <span class="bank-coop-chip" data-selected-office-id="${esc(office.officeId)}">
          <span class="bank-coop-chip-label">${esc(office.officeName || office.officeId)}</span>
          <button type="button" class="bank-coop-chip-remove" data-remove-office-id="${esc(office.officeId)}" aria-label="إزالة ${esc(office.officeName || office.officeId)}">×</button>
        </span>`).join("")}
    </div>`;
}

export function buildOfficeCooperationPanelHtml() {
  return `
    <div class="bank-coop-panel" id="bankCoopPanel">
      <div class="bank-coop-selected-wrap">
        <p class="bank-coop-selected-title">المكاتب المختارة:</p>
        <div id="bankCoopSelectedChips"></div>
      </div>
      <div class="bank-coop-search-wrap">
        <label class="bank-coop-search-label" for="bankCoopOfficesSearch">ابحث باسم المكتب</label>
        <input type="search" id="bankCoopOfficesSearch" class="bank-coop-search-input"
          placeholder="ابحث باسم المكتب" autocomplete="off" inputmode="search">
        <div id="bankCoopSearchResults" class="bank-coop-search-results" hidden></div>
      </div>
      <label class="bank-coop-message-label">رسالة اختيارية
        <textarea id="bankCoopMessage" class="bank-coop-message" maxlength="500"
          placeholder="رسالة للمكاتب المستلمة" rows="3"></textarea>
      </label>
      <button type="button" class="bank-action-primary iaqar-workflow-btn success bank-coop-send-btn"
        id="bankCoopSendBtn" disabled>إرسال الفرصة</button>
      <p class="bank-coop-privacy-note">لن تتم مشاركة بيانات المالك أو العميل أو أرقام التواصل.</p>
      <p class="section-status bank-coop-send-status" id="bankCoopSendStatus" role="status"></p>
    </div>`;
}

/** @deprecated use buildOfficeCooperationPanelHtml */
export function buildSuitableOfficesShareSectionHtml() {
  return buildOfficeCooperationPanelHtml();
}

/** @deprecated tiers removed */
export function buildSuitableOfficeCardHtml() {
  return "";
}

/** @deprecated tiers removed */
export function buildSuitableTierSectionHtml() {
  return "";
}

/** @deprecated tiers removed */
export function buildSuitableOfficesTiersHtml() {
  return "";
}

/** @deprecated use buildOfficeSearchResultHtml */
export function buildSuitableOfficeDropdownItemHtml(office = {}) {
  return buildOfficeSearchResultHtml(office);
}

/** @deprecated use buildOfficeSearchResultsHtml */
export function buildSuitableOfficeDropdownHtml(offices = [], query = "") {
  return buildOfficeSearchResultsHtml(offices, query);
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
