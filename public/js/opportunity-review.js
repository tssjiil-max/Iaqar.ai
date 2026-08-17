/**
 * Opportunity review overlay — searchable catalog fields + advertiser data before final save.
 */

import {
  CITIES,
  DISTRICT_OTHER_ID,
  DISTRICTS,
  DISTRICT_UNCONFIRMED_WARNING,
  OPERATION_TYPES,
  PROPERTY_TYPES,
  buildReviewDefaults,
  conservativeMatchDistrict,
  conservativeMatchPropertyType,
  districtsForCity,
  filterBySearch,
  filterDistrictOptions,
  reviewTransactionMode,
  reviewValuesToBrokerFields
} from "./reference-catalog.js";
import {
  ADVERTISER_CONTACT_STATUSES,
  ADVERTISER_ROLES,
  MARKETING_CONSENT_STATUSES,
  buildAdvertiserCompletionMessage,
  extractAdvertiserPhonesFromText,
  getAdvertiserMessageModalContext,
  clearAdvertiserMessageModalContext,
  normalizeAdvertiserPhoneE164,
  whatsappDigitsFromE164
} from "./advertiser-phone-domain.js";
import { importReviewValuesToBrokerFields } from "./import-field-normalization-domain.js";
import {
  IMPORT_EXTRA_FIELD_DEFS,
  IMPORT_OPPORTUNITY_KINDS,
  IMPORT_RECORD_LABEL,
  classifyImportPropertyType,
  evaluateImportReviewSaveMinimum,
  importSimplifiedReviewValuesToBrokerFields,
  resolveImportOperationTypeId,
  resolveImportPriceFieldLabel,
  resolveImportPrimaryInfoFields
} from "./import-advert-review-domain.js";

function $(id) {
  return document.getElementById(id);
}

let activeDraft = null;
let onApproveCallback = null;
let onReanalyzeCallback = null;
let activeReviewOptions = null;
let advertiserExtractedAuto = false;
let advertiserCandidates = [];
let activeReviewValues = {};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function officeContext() {
  return window.IAQAR?.office || {};
}

function e164ToLocalInput(e164) {
  const digits = String(e164 || "").replace(/\D/g, "");
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^05\d{8}$/.test(digits)) return digits;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  return "";
}

function closeReview(options = {}) {
  const overlay = $("opportunityReviewOverlay");
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  document.body.style.overflow = "";
  activeDraft = null;
  advertiserExtractedAuto = false;
  advertiserCandidates = [];
  closeAdvertiserMessageModal();
  window.dispatchEvent(new CustomEvent("iaqar:opportunity-review-closed"));
  if (!options.explicit && window.history?.state?.iaqarOverlay) {
    window.history.replaceState(null, "", location.href);
  }
  window.IAQAR?.navigation?.updateBackButton?.();
  window.dispatchEvent(new CustomEvent("iaqar:navigation-changed"));
}

function closeAdvertiserMessageModal() {
  const modal = $("advertiserMessageOverlay");
  if (modal) modal.hidden = true;
}

function openReviewOverlay(draft, onApprove, options = {}) {
  const overlay = $("opportunityReviewOverlay");
  if (!overlay) return;
  activeDraft = draft;
  onApproveCallback = onApprove;
  onReanalyzeCallback = options.onReanalyze || null;
  activeReviewOptions = options;
  advertiserCandidates = extractAdvertiserPhonesFromText(draft.sourceText || "");
  advertiserExtractedAuto = advertiserCandidates.length > 0;
  const defaults = draft.reviewDefaults || buildReviewDefaults(
    draft.fields || {},
    draft.sourceText || "",
    {
      extended: draft.extended || draft.fields?.extended,
      needsReview: draft.needsReview || draft.fields?.needsReview
    }
  );
  renderReviewForm(defaults, options);
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  window.dispatchEvent(new CustomEvent("iaqar:nav-open", { detail: { view: "opportunityReviewOverlay" } }));
}

function reviewLabel(name, label, needsReview) {
  const flag = needsReview && needsReview[name];
  return flag
    ? `${label} <span data-review-needed="true" title="يحتاج مراجعة" aria-label="يحتاج مراجعة" style="color:#b7791f;font-size:13px">●</span>`
    : label;
}

function reviewContextFromDraft() {
  const fields = activeDraft?.fields || {};
  return {
    purpose: fields.purpose || activeDraft?.prepared?.opportunity?.purpose || "",
    opportunityKind: fields.opportunityKind || activeDraft?.prepared?.opportunity?.opportunityKind || ""
  };
}

function renderAdvertiserSection(defaults) {
  const savedPhone = defaults.advertiserPhoneNormalized || "";
  const primary = advertiserCandidates.length === 1 ? advertiserCandidates[0] : null;
  const localPhone = savedPhone
    ? e164ToLocalInput(savedPhone)
    : (primary ? e164ToLocalInput(primary.advertiserPhoneNormalized) : "");
  const savedRole = String(defaults.advertiserRole || "").trim();
  const roleOptions = ADVERTISER_ROLES.map((r) => {
    const selected = savedRole
      ? r.id === savedRole
      : r.id === "UNKNOWN";
    return `<option value="${r.id}" ${selected ? "selected" : ""}>${escapeHtml(r.label)}</option>`;
  }).join("");
  const savedContact = String(defaults.advertiserContactStatus || "").trim();
  const contactOptions = ADVERTISER_CONTACT_STATUSES.map((r) => {
    const selected = savedContact
      ? r.id === savedContact
      : r.id === "NOT_CONTACTED";
    return `<option value="${r.id}" ${selected ? "selected" : ""}>${escapeHtml(r.label)}</option>`;
  }).join("");
  const savedMarketing = String(defaults.marketingConsentStatus || "").trim();
  const marketingOptions = MARKETING_CONSENT_STATUSES.map((r) => {
    const selected = savedMarketing
      ? r.id === savedMarketing
      : r.id === "NOT_STARTED";
    return `<option value="${r.id}" ${selected ? "selected" : ""}>${escapeHtml(r.label)}</option>`;
  }).join("");
  const multiPick = advertiserCandidates.length > 1
    ? `<div class="advertiser-phone-multi">
        <span>تم العثور على ${advertiserCandidates.length} أرقام — اختر للمراجعة:</span>
        <select id="advertiserPhonePick" class="advertiser-phone-pick">
          ${advertiserCandidates.map((c, i) =>
            `<option value="${i}" ${i === 0 ? "selected" : ""}>${escapeHtml(c.advertiserPhoneNormalized)}</option>`
          ).join("")}
        </select>
      </div>`
    : "";

  return `
    <section class="review-advertiser-card" aria-labelledby="reviewAdvertiserTitle">
      <h3 id="reviewAdvertiserTitle">بيانات المعلن</h3>
      ${multiPick}
      <label class="review-field advertiser-phone-field">
        <span>رقم جوال المعلن</span>
        <input name="advertiserPhoneLocal" type="tel" inputmode="numeric" maxlength="10"
          placeholder="05XXXXXXXX" value="${escapeHtml(localPhone)}"
          aria-label="رقم جوال المعلن">
        <small class="advertiser-extracted-hint" id="advertiserPhoneExtractedHint"
          ${advertiserExtractedAuto && localPhone ? "" : "hidden"}>تم استخراجه من الإعلان</small>
      </label>
      <label class="review-field">
        <span>صفة المعلن</span>
        <select name="advertiserRole">${roleOptions}</select>
      </label>
      <label class="review-field">
        <span>حالة التواصل</span>
        <select name="advertiserContactStatus">${contactOptions}</select>
      </label>
      <label class="review-field">
        <span>حالة استكمال إجراءات التسويق</span>
        <select name="marketingConsentStatus">${marketingOptions}</select>
      </label>
      <button type="button" class="review-advertiser-prep" id="advertiserPrepMessageBtn"
        ${localPhone ? "" : "disabled"}>تجهيز رسالة الاستكمال</button>
    </section>
  `;
}

function importKindRadiosMarkup(selectedKind = "OFFER") {
  const kind = String(selectedKind || "OFFER").toUpperCase() === "REQUEST" ? "REQUEST" : "OFFER";
  const options = IMPORT_OPPORTUNITY_KINDS.map((item) => {
    const checked = item.id === kind ? "checked" : "";
    return `<label class="import-kind-option">
      <input type="radio" name="opportunityKind" value="${item.id}" ${checked}>
      <span>${escapeHtml(item.label)}</span>
    </label>`;
  }).join("");
  return `
    <fieldset class="review-field import-kind-field">
      <legend>نوع الفرصة</legend>
      <div class="import-kind-options">${options}</div>
    </fieldset>
  `;
}

function importExtraFieldsMarkup(extraValues = {}) {
  const fields = IMPORT_EXTRA_FIELD_DEFS.map((field) => {
    const value = extraValues[field.name] ?? "";
    const display = value === "" || value == null ? "" : String(value);
    if (field.type === "textarea") {
      return `
        <label class="review-field import-extra-field">
          <span>${escapeHtml(field.label)}</span>
          <textarea name="${field.name}" rows="3" maxlength="2000" autocomplete="off">${escapeHtml(display)}</textarea>
        </label>
      `;
    }
    const inputMode = field.type === "number" ? ' inputmode="decimal"' : "";
    const inputType = field.type === "number" ? "number" : "text";
    return `
      <label class="review-field import-extra-field">
        <span>${escapeHtml(field.label)}</span>
        <input name="${field.name}" type="${inputType}" value="${escapeHtml(display)}" maxlength="120" autocomplete="off"${inputMode}>
      </label>
    `;
  }).join("");
  return `
    <details class="import-extra-details">
      <summary>تفاصيل إضافية</summary>
      <div class="import-extra-fields">${fields}</div>
    </details>
  `;
}

function renderImportPriceFieldMarkup(defaults = {}) {
  const operationTypeId = defaults.operationTypeId
    || resolveImportOperationTypeId({
      opportunityKind: defaults.opportunityKind,
      purpose: defaults.purpose || defaults.extractedSnapshot?.purpose || ""
    });
  const mode = reviewTransactionMode(operationTypeId, {
    purpose: defaults.purpose || defaults.extractedSnapshot?.purpose || "",
    opportunityKind: defaults.opportunityKind || defaults.extractedSnapshot?.opportunityKind || ""
  });
  const label = resolveImportPriceFieldLabel(operationTypeId, defaults.opportunityKind);
  const name = mode === "budget"
    ? "budget"
    : mode === "rent"
      ? "annualRent"
      : mode === "investment"
        ? "investmentValue"
        : "salePrice";
  const value = defaults[name] ?? "";
  const display = value === "" || value == null ? "" : String(value);
  return `
    <input type="hidden" name="operationTypeId" value="${escapeHtml(operationTypeId)}">
    <label class="review-field import-price-field">
      <span>${escapeHtml(label)}</span>
      <input name="${name}" type="number" min="0" step="any" value="${escapeHtml(display)}" inputmode="decimal" autocomplete="off">
    </label>
  `;
}

function renderImportPrimaryInfoMarkup(defaults = {}) {
  const propertyType = defaults.rawPropertyTypeText || defaults.propertyTypeDisplay || "";
  const primaryFields = resolveImportPrimaryInfoFields(propertyType, defaults);
  return primaryFields.map((field) => {
    const value = defaults[field.name] ?? "";
    const display = value === "" || value == null ? "" : String(value);
    const optionalHint = field.optional ? ' <small class="review-optional-hint">(اختياري)</small>' : "";
    return `
      <label class="review-field import-primary-field" data-primary-field="${field.name}">
        <span>${escapeHtml(field.label)}${optionalHint}</span>
        <input name="${field.name}" type="number" min="0" step="any" value="${escapeHtml(display)}" inputmode="decimal" autocomplete="off">
      </label>
    `;
  }).join("");
}

function renderImportSimplifiedReviewForm(defaults, options = {}) {
  const body = $("opportunityReviewBody");
  if (!body) return;
  const titleNode = $("opportunityReviewTitle");
  const headParagraph = body.parentElement?.querySelector(".settings-head p");
  if (titleNode) titleNode.textContent = options.title || IMPORT_RECORD_LABEL;
  if (headParagraph) {
    headParagraph.textContent = options.subtitle || "راجع البيانات الأساسية ثم احفظ الفرصة.";
  }
  const needs = defaults.needsReview || {};
  activeReviewValues = {
    salePrice: defaults.salePrice,
    annualRent: defaults.annualRent,
    monthlyRent: defaults.monthlyRent,
    optionalMonthlyRent: defaults.optionalMonthlyRent,
    paymentInstallments: defaults.paymentInstallments,
    budget: defaults.budget,
    investmentValue: defaults.investmentValue,
    area: defaults.area,
    rooms: defaults.rooms,
    bathrooms: defaults.bathrooms,
    floorNumber: defaults.floorNumber,
    units: defaults.units,
    floorsCount: defaults.floorsCount
  };

  const localPhone = defaults.advertiserPhoneNormalized
    ? e164ToLocalInput(defaults.advertiserPhoneNormalized)
    : (advertiserCandidates.length === 1
      ? e164ToLocalInput(advertiserCandidates[0].advertiserPhoneNormalized)
      : "");

  body.innerHTML = `
    ${options.importSummary
      ? `<p class="import-review-summary">${escapeHtml(options.importSummary)}</p>` : ""}
    ${options.sourceUrl
      ? `<a class="import-review-source-link" href="${escapeHtml(options.sourceUrl)}" target="_blank" rel="noopener noreferrer">فتح الإعلان الأصلي</a>` : ""}
    <p class="review-hint">عدّل البيانات الأساسية فقط — التفاصيل الإضافية اختيارية داخل القسم المغلق.</p>
    <form id="opportunityReviewForm" class="review-form import-simplified-review" autocomplete="off">
      ${importKindRadiosMarkup(defaults.opportunityKind)}
      ${plainTextField(
        "rawPropertyTypeText",
        reviewLabel("propertyType", "نوع العقار", needs),
        defaults.rawPropertyTypeText || defaults.propertyTypeDisplay || defaults.propertyTypeManual || "",
        "مثال: فيلا، شقة، أرض، عمارة، دور، محل"
      )}
      ${plainTextField(
        "rawNeighborhoodText",
        reviewLabel("district", "الحي", needs),
        defaults.rawNeighborhoodText || defaults.districtDisplay || defaults.districtManual || ""
      )}
      ${plainTextField(
        "rawCityText",
        reviewLabel("city", "المدينة", needs),
        defaults.rawCityText || defaults.cityManual || defaults.extractedSnapshot?.city || ""
      )}
      <div id="importReviewPriceField">${renderImportPriceFieldMarkup(defaults)}</div>
      <div id="importReviewPrimaryInfo">${renderImportPrimaryInfoMarkup(defaults)}</div>
      <label class="review-field import-phone-field">
        <span>رقم الجوال</span>
        <input name="advertiserPhoneLocal" type="tel" inputmode="numeric" maxlength="10"
          placeholder="05XXXXXXXX" value="${escapeHtml(localPhone)}"
          aria-label="رقم جوال المعلن أو العميل" autocomplete="off">
        <small class="advertiser-extracted-hint" id="advertiserPhoneExtractedHint"
          ${advertiserExtractedAuto && localPhone ? "" : "hidden"}>تم استخراجه من الإعلان</small>
      </label>
      ${importExtraFieldsMarkup(defaults.importExtraFields || {})}
      <div class="review-actions">
        <button type="submit" class="review-approve" id="opportunityReviewApprove">${escapeHtml(options.approveLabel || "حفظ الفرصة")}</button>
        ${options.showReanalyze
          ? `<button type="button" class="review-cancel" id="opportunityReviewReanalyze">إعادة التحليل</button>` : ""}
        <button type="button" class="review-cancel" id="opportunityReviewCancel">إلغاء</button>
      </div>
      <p class="review-status" id="opportunityReviewStatus" role="status"></p>
      <p class="review-import-missing" id="importReviewMissingHint" hidden></p>
    </form>
  `;

  wireImportSimplifiedReviewForm(body, defaults);
  wireAdvertiserPhoneOnly();
  const form = $("opportunityReviewForm");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitReview();
  });
  $("opportunityReviewCancel")?.addEventListener("click", () => closeReview());
  $("opportunityReviewReanalyze")?.addEventListener("click", () => {
    if (typeof onReanalyzeCallback === "function") onReanalyzeCallback();
  });
}

function wireAdvertiserPhoneOnly() {
  const phoneInput = document.querySelector('input[name="advertiserPhoneLocal"]');
  const hint = $("advertiserPhoneExtractedHint");
  phoneInput?.addEventListener("input", () => {
    advertiserExtractedAuto = false;
    if (hint) hint.hidden = true;
  });
}

function wireImportSimplifiedReviewForm(root, defaults = {}) {
  const refreshDynamicSections = () => {
    const form = $("opportunityReviewForm");
    if (!form) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const opportunityKind = data.opportunityKind || defaults.opportunityKind || "OFFER";
    const purpose = defaults.purpose || defaults.extractedSnapshot?.purpose || "";
    const operationTypeId = resolveImportOperationTypeId({ opportunityKind, purpose });
    const nextDefaults = {
      ...defaults,
      ...activeReviewValues,
      ...data,
      opportunityKind,
      operationTypeId
    };
    const priceHost = root.querySelector("#importReviewPriceField");
    if (priceHost) priceHost.innerHTML = renderImportPriceFieldMarkup(nextDefaults);
    const primaryHost = root.querySelector("#importReviewPrimaryInfo");
    if (primaryHost) {
      primaryHost.innerHTML = renderImportPrimaryInfoMarkup({
        ...nextDefaults,
        rawPropertyTypeText: data.rawPropertyTypeText || nextDefaults.rawPropertyTypeText
      });
    }
  };

  root.querySelectorAll('input[name="opportunityKind"]').forEach((input) => {
    input.addEventListener("change", refreshDynamicSections);
  });
  root.querySelector('[name="rawPropertyTypeText"]')?.addEventListener("input", refreshDynamicSections);

  root.oninput = (event) => {
    const name = event.target?.name;
    if (name && Object.prototype.hasOwnProperty.call(activeReviewValues, name)) {
      activeReviewValues[name] = event.target.value;
      if (String(event.target.value || "").trim()) {
        event.target.closest("label")?.querySelector("[data-review-needed]")?.remove();
      }
    }
  };
}

function renderReviewForm(defaults, options = {}) {
  if (options.importSimplifiedReview) {
    renderImportSimplifiedReviewForm(defaults, options);
    return;
  }
  const body = $("opportunityReviewBody");
  if (!body) return;
  const titleNode = $("opportunityReviewTitle");
  const headParagraph = body.parentElement?.querySelector(".settings-head p");
  if (titleNode) titleNode.textContent = options.title || "مراجعة الفرصة";
  if (headParagraph) {
    headParagraph.textContent = options.subtitle || "راجع البيانات المستخرجة قبل الحفظ النهائي.";
  }
  const needs = defaults.needsReview || {};
  const mode = reviewTransactionMode(defaults.operationTypeId, {
    purpose: defaults.extractedSnapshot?.purpose || activeDraft?.fields?.purpose || "",
    opportunityKind: defaults.extractedSnapshot?.opportunityKind || activeDraft?.fields?.opportunityKind || ""
  });
  activeReviewValues = {
    salePrice: defaults.salePrice,
    annualRent: defaults.annualRent,
    monthlyRent: defaults.monthlyRent,
    optionalMonthlyRent: defaults.optionalMonthlyRent,
    paymentInstallments: defaults.paymentInstallments,
    budget: defaults.budget,
    investmentValue: defaults.investmentValue,
    area: defaults.area,
    rooms: defaults.rooms,
    bathrooms: defaults.bathrooms,
    floorNumber: defaults.floorNumber
  };
  const snapshotLines = [
    defaults.extractedSnapshot?.transactionType,
    defaults.extractedSnapshot?.propertyType,
    defaults.extractedSnapshot?.district,
    mode === "sale" && defaults.extractedSnapshot?.salePrice
      ? `${defaults.extractedSnapshot.salePrice} ريال سعر بيع`
      : "",
    mode === "rent" && defaults.extractedSnapshot?.annualRent
      ? `${defaults.extractedSnapshot.annualRent} ريال سنوي`
      : ""
  ].filter(Boolean);

  const importPlainLocation = Boolean(options.importPlainLocationFields);
  const locationFieldsMarkup = importPlainLocation
    ? `
      ${plainTextField("rawPropertyTypeText", reviewLabel("propertyType", "نوع العقار", needs), defaults.rawPropertyTypeText || defaults.propertyTypeDisplay || defaults.propertyTypeManual || "")}
      ${plainTextField("rawCityText", reviewLabel("city", "المدينة", needs), defaults.rawCityText || defaults.cityManual || defaults.extractedSnapshot?.city || "")}
      ${plainTextField("rawNeighborhoodText", reviewLabel("district", "الحي", needs), defaults.rawNeighborhoodText || defaults.districtDisplay || defaults.districtManual || "")}
      ${defaults.normalizationHint
        ? `<p class="review-normalization-hint" id="reviewNormalizationHint">${escapeHtml(defaults.normalizationHint)}</p>`
        : `<p class="review-normalization-hint" id="reviewNormalizationHint" hidden></p>`}
    `
    : `
      ${searchField("propertyTypeId", reviewLabel("propertyType", "نوع العقار", needs), PROPERTY_TYPES, defaults.propertyTypeId, "label", "", defaults.propertyTypeDisplay || defaults.propertyTypeManual)}
      ${manualField("propertyTypeManual", "اكتب نوع العقار", defaults.propertyTypeManual, defaults.propertyTypeId === "other")}
      ${searchField("cityId", reviewLabel("city", "المدينة", needs), CITIES, defaults.cityId, "label")}
      ${manualField("cityManual", "اكتب المدينة", defaults.cityManual, defaults.cityId === "other")}
      ${searchField("districtId", reviewLabel("district", "الحي", needs), districtOptions(defaults.cityId), defaults.districtId, "officialName", defaults.districtManual, defaults.districtDisplay || defaults.districtManual)}
      ${manualField("districtManual", "اكتب اسم الحي", defaults.districtManual, defaults.districtId === DISTRICT_OTHER_ID)}
    `;

  body.innerHTML = `
    ${options.importSummary
      ? `<p class="import-review-summary">${escapeHtml(options.importSummary)}</p>` : ""}
    ${options.sourceUrl
      ? `<a class="import-review-source-link" href="${escapeHtml(options.sourceUrl)}" target="_blank" rel="noopener noreferrer">فتح الإعلان الأصلي</a>` : ""}
    <p class="review-hint">راجع القيم المستخرجة وعدّل ما يلزم قبل الحفظ النهائي.</p>
    ${defaults.districtUnconfirmedWarning
      ? `<p class="review-district-warning" id="reviewDistrictWarning">${escapeHtml(defaults.districtUnconfirmedWarning)}</p>`
      : `<p class="review-district-warning" id="reviewDistrictWarning" hidden></p>`}
    ${snapshotLines.length
      ? `<p class="review-extracted">مستخرَج: ${escapeHtml(snapshotLines.join(" — "))}</p>` : ""}
    <form id="opportunityReviewForm" class="review-form" autocomplete="off">
      ${searchField("operationTypeId", reviewLabel("transactionType", "نوع العملية", needs), OPERATION_TYPES, defaults.operationTypeId, "label")}
      ${locationFieldsMarkup}
      <div id="reviewTransactionFields" style="display:contents"></div>
      <div id="reviewPropertyFields" style="display:contents"></div>
      ${renderAdvertiserSection(defaults)}
      <div class="review-actions">
        <button type="submit" class="review-approve" id="opportunityReviewApprove">${escapeHtml(options.approveLabel || "اعتماد وحفظ")}</button>
        ${options.showReanalyze
          ? `<button type="button" class="review-cancel" id="opportunityReviewReanalyze">إعادة التحليل</button>` : ""}
        <button type="button" class="review-cancel" id="opportunityReviewCancel">إلغاء</button>
      </div>
      <p class="review-status" id="opportunityReviewStatus" role="status"></p>
    </form>
  `;

  wireSearchFields(body, { importPlainLocation });
  renderDynamicReviewFields(body, defaults);
  body.oninput = (event) => {
    const name = event.target?.name;
    if (name && Object.prototype.hasOwnProperty.call(activeReviewValues, name)) {
      activeReviewValues[name] = event.target.value;
      if (String(event.target.value || "").trim()) {
        event.target.closest("label")?.querySelector("[data-review-needed]")?.remove();
      }
    }
  };
  wireAdvertiserSection();
  const form = $("opportunityReviewForm");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitReview();
  });
  $("opportunityReviewCancel")?.addEventListener("click", () => closeReview());
  $("opportunityReviewReanalyze")?.addEventListener("click", () => {
    if (typeof onReanalyzeCallback === "function") onReanalyzeCallback();
  });
}

function wireAdvertiserSection() {
  const phoneInput = document.querySelector('input[name="advertiserPhoneLocal"]');
  const hint = $("advertiserPhoneExtractedHint");
  const prepBtn = $("advertiserPrepMessageBtn");
  const pick = $("advertiserPhonePick");

  const syncPrepState = () => {
    const local = (phoneInput?.value || "").replace(/\D/g, "");
    const valid = /^5\d{8}$/.test(local);
    if (prepBtn) prepBtn.disabled = !valid;
  };

  phoneInput?.addEventListener("input", () => {
    advertiserExtractedAuto = false;
    if (hint) hint.hidden = true;
    syncPrepState();
  });

  pick?.addEventListener("change", () => {
    const idx = Number(pick.value);
    const candidate = advertiserCandidates[idx];
    if (candidate && phoneInput) {
      phoneInput.value = e164ToLocalInput(candidate.advertiserPhoneNormalized);
      advertiserExtractedAuto = true;
      if (hint) hint.hidden = false;
      syncPrepState();
    }
  });

  prepBtn?.addEventListener("click", () => openAdvertiserMessageModal());
  syncPrepState();
}

function readAdvertiserForm() {
  const form = $("opportunityReviewForm");
  if (!form) return {};
  const data = Object.fromEntries(new FormData(form).entries());
  const local = String(data.advertiserPhoneLocal || "").replace(/\D/g, "");
  const normalized = /^5\d{8}$/.test(local) ? normalizeAdvertiserPhoneE164(local) : "";
  const primary = advertiserCandidates.length === 1 ? advertiserCandidates[0] : null;
  return {
    advertiserPhoneRaw: normalized
      ? (primary?.advertiserPhoneRaw || `0${local}`)
      : "",
    advertiserPhoneNormalized: normalized,
    advertiserPhoneSource: normalized && advertiserExtractedAuto
      ? (primary?.advertiserPhoneSource || "text_extraction")
      : (normalized ? "manual_entry" : ""),
    advertiserPhoneEvidence: normalized && advertiserExtractedAuto
      ? (primary?.advertiserPhoneEvidence || "")
      : "",
    advertiserRole: data.advertiserRole || "UNKNOWN",
    advertiserContactStatus: data.advertiserContactStatus || "NOT_CONTACTED",
    marketingConsentStatus: data.marketingConsentStatus || "NOT_STARTED",
    lastContactAt: null,
    contactNotes: ""
  };
}

function currentReviewPropertyLabels() {
  const form = $("opportunityReviewForm");
  if (!form) return {};
  if (activeReviewOptions?.importPlainLocationFields) {
    return {
      propertyType: form.querySelector('[name="rawPropertyTypeText"]')?.value || "",
      city: form.querySelector('[name="rawCityText"]')?.value || "",
      district: form.querySelector('[name="rawNeighborhoodText"]')?.value || ""
    };
  }
  const propertyTypeInput = form.querySelector('[data-search-for="propertyTypeId"]');
  const districtInput = form.querySelector('[data-search-for="districtId"]');
  const cityInput = form.querySelector('[data-search-for="cityId"]');
  return {
    propertyType: propertyTypeInput?.value || activeDraft?.fields?.propertyType || "",
    district: districtInput?.value || activeDraft?.fields?.district || "",
    city: cityInput?.value || activeDraft?.fields?.city || ""
  };
}

function openAdvertiserMessageModal() {
  const advertiser = readAdvertiserForm();
  if (!advertiser.advertiserPhoneNormalized) return;
  const office = officeContext();
  const labels = currentReviewPropertyLabels();
  const message = buildAdvertiserCompletionMessage({
    brokerName: office.brokerName || office.displayBroker || "",
    officeName: office.officeName || office.displayName || "",
    licenseNumber: office.licenseNumber || office.falLicense || "",
    propertyType: labels.propertyType,
    district: labels.district,
    city: labels.city
  });
  const modal = $("advertiserMessageOverlay");
  const target = $("advertiserMessageTarget");
  const textarea = $("advertiserMessageText");
  if (!modal || !textarea) return;
  if (target) target.textContent = advertiser.advertiserPhoneNormalized;
  textarea.value = message;
  modal.hidden = false;
}

function wireAdvertiserMessageModal() {
  const modal = $("advertiserMessageOverlay");
  if (!modal || modal.dataset.bound === "1") return;
  modal.dataset.bound = "1";
  const textarea = $("advertiserMessageText");
  $("advertiserMessageCopy")?.addEventListener("click", () => {
    void navigator.clipboard?.writeText(textarea?.value || "");
  });
  $("advertiserMessageWhatsApp")?.addEventListener("click", () => {
    const ctx = getAdvertiserMessageModalContext();
    const advertiser = readAdvertiserForm();
    const phone = ctx?.phone || advertiser.advertiserPhoneNormalized;
    const digits = whatsappDigitsFromE164(phone);
    if (!digits) return;
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(textarea?.value || "")}`;
    window.location.href = url;
    if (ctx?.onWhatsAppOpened) {
      void ctx.onWhatsAppOpened();
    }
    clearAdvertiserMessageModalContext();
    closeAdvertiserMessageModal();
  });
  $("advertiserMessageCancel")?.addEventListener("click", () => {
    clearAdvertiserMessageModalContext();
    closeAdvertiserMessageModal();
  });
  $("advertiserMessageClose")?.addEventListener("click", () => {
    clearAdvertiserMessageModalContext();
    closeAdvertiserMessageModal();
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeAdvertiserMessageModal();
  });
}

function districtOptions(cityId) {
  const list = districtsForCity(cityId || "madinah");
  return [
    ...list,
    {
      id: DISTRICT_OTHER_ID,
      officialName: "حي آخر / غير موجود في القائمة",
      label: "حي آخر / غير موجود في القائمة"
    }
  ];
}

function plainTextField(name, label, value, placeholder = "") {
  const placeholderAttr = placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : "";
  return `
    <label class="review-field import-plain-location-field" data-field="${name}">
      <span>${label}</span>
      <input name="${name}" type="text" value="${escapeHtml(value || "")}" maxlength="80" autocomplete="off"${placeholderAttr}>
    </label>
  `;
}

function searchField(name, label, items, selectedId, labelKey = "label", districtManual = "", displayOverride = "") {
  const selected = items.find((i) => i.id === selectedId);
  const display = displayOverride
    ? escapeHtml(displayOverride)
    : selected
      ? escapeHtml(selected[labelKey] || selected.label || "")
      : (name === "districtId" && selectedId === DISTRICT_OTHER_ID
        ? escapeHtml(districtManual || "حي آخر / غير موجود في القائمة")
        : "");
  return `
    <label class="search-field" data-field="${name}">
      <span>${label}</span>
      <input type="text" class="search-select-input hybrid-text-input" data-search-for="${name}" placeholder="اكتب أو اختر من الاقتراحات…" value="${display}" autocomplete="off">
      <input type="hidden" name="${name}" value="${escapeHtml(selectedId || "")}">
      <ul class="search-select-list hybrid-suggestions" data-list-for="${name}" hidden></ul>
    </label>
  `;
}

function manualField(name, label, value, visible) {
  return `
    <label class="review-manual" data-manual-for="${name.replace("Manual", "Id")}" ${visible ? "" : "hidden"}>
      <span>${label}</span>
      <input name="${name}" type="text" value="${escapeHtml(value || "")}" maxlength="80">
    </label>
  `;
}

function numericField(name, label, value) {
  const display = value === "" || value == null ? "" : String(value);
  return `
    <label class="review-field">
      <span>${label}</span>
      <input name="${name}" type="number" min="0" step="any" value="${escapeHtml(display)}" inputmode="decimal">
    </label>
  `;
}

function updateDistrictWarning(root, field, typed, result = null) {
  const warn = root.querySelector("#reviewDistrictWarning") || document.getElementById("reviewDistrictWarning");
  if (!warn || field !== "districtId") return;
  const cityId = root.querySelector('input[name="cityId"]')?.value || "madinah";
  const check = result || conservativeMatchDistrict(typed, cityId);
  if (check.warning) {
    warn.hidden = false;
    warn.textContent = check.warning;
  } else {
    warn.hidden = true;
    warn.textContent = "";
  }
}

function wireSearchFields(root, options = {}) {
  if (options.importPlainLocation) return;
  root.querySelectorAll(".search-select-input").forEach((input) => {
    const field = input.dataset.searchFor;
    const list = root.querySelector(`[data-list-for="${field}"]`);
    const hidden = root.querySelector(`input[name="${field}"]`);
    const items = field === "districtId"
      ? districtOptions(root.querySelector('input[name="cityId"]')?.value || "madinah")
      : field === "operationTypeId" ? OPERATION_TYPES
        : field === "propertyTypeId" ? PROPERTY_TYPES
          : CITIES;

    const render = (query = "") => {
      const labelKey = field === "districtId" ? "officialName" : "label";
      const filtered = field === "districtId"
        ? filterDistrictOptions(query, items, 40)
        : filterBySearch(query, items, labelKey).slice(0, 40);
      list.innerHTML = filtered.map((item) =>
        `<li><button type="button" data-pick-id="${escapeHtml(item.id)}" data-pick-label="${escapeHtml(item[labelKey] || item.label || "")}">${escapeHtml(item[labelKey] || item.label || "")}</button></li>`
      ).join("");
      list.hidden = filtered.length === 0;
    };

    input.addEventListener("focus", () => {
      render(input.value);
      list.hidden = false;
    });
    input.addEventListener("input", () => {
      if (field === "propertyTypeId" || field === "districtId") {
        hidden.value = "";
        updateDistrictWarning(root, field, input.value);
      }
      render(input.value);
    });
    input.addEventListener("blur", () => {
      if (field !== "propertyTypeId" && field !== "districtId") return;
      const typed = String(input.value || "").trim();
      updateDistrictWarning(root, field, typed);
    });
    list.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-pick-id]");
      if (!btn) return;
      const typedQuery = String(input.value || "").trim();
      hidden.value = btn.dataset.pickId || "";
      input.value = btn.dataset.pickLabel || "";
      if (field === "districtId" && btn.dataset.pickId === DISTRICT_OTHER_ID) {
        const manual = root.querySelector('[name="districtManual"]');
        if (manual && !String(manual.value || "").trim()) {
          const looksLikeOtherLabel = /حي\s*آخر|غير موجود/.test(typedQuery);
          if (typedQuery && !looksLikeOtherLabel) manual.value = typedQuery.slice(0, 80);
        }
      }
      input.closest("label")?.querySelector("[data-review-needed]")?.remove();
      list.hidden = true;
      syncManualVisibility(root);
      if (field === "cityId") refreshDistrictField(root);
      if (field === "operationTypeId" || field === "propertyTypeId") {
        syncReviewConditionalVisibility(root);
      }
    });
    document.addEventListener("click", (event) => {
      if (!input.parentElement.contains(event.target)) list.hidden = true;
    });
  });
}

function syncReviewConditionalVisibility(root) {
  renderDynamicReviewFields(root, {
    needsReview: activeDraft?.needsReview || activeDraft?.fields?.needsReview || {}
  });
}

function captureDynamicReviewValues(root) {
  for (const name of Object.keys(activeReviewValues)) {
    const input = root.querySelector(`[name="${name}"]`);
    if (input) activeReviewValues[name] = input.value;
  }
}

function renderDynamicReviewFields(root, defaults = {}) {
  captureDynamicReviewValues(root);
  const operationId = root.querySelector('input[name="operationTypeId"]')?.value || "";
  const ctx = reviewContextFromDraft();
  const mode = reviewTransactionMode(operationId, ctx);
  const needs = defaults.needsReview || activeDraft?.needsReview || activeDraft?.fields?.needsReview || {};
  const transactionFields = root.querySelector("#reviewTransactionFields");
  const propertyFields = root.querySelector("#reviewPropertyFields");
  const awaitingTransaction = mode === "unknown";
  if (activeReviewOptions?.importPlainLocationFields) {
    root.querySelectorAll(".import-plain-location-field, #reviewNormalizationHint").forEach((field) => {
      field.style.display = awaitingTransaction ? "none" : "";
    });
  } else {
    for (const fieldName of ["propertyTypeId", "cityId", "districtId"]) {
      const field = root.querySelector(`[data-field="${fieldName}"]`);
      if (field) field.style.display = awaitingTransaction ? "none" : "";
    }
    root.querySelectorAll(".review-manual").forEach((field) => {
      if (awaitingTransaction) field.style.display = "none";
      else field.style.removeProperty("display");
    });
  }
  const advertiserSection = root.querySelector(".review-advertiser-card");
  if (advertiserSection) advertiserSection.style.display = awaitingTransaction ? "none" : "";

  const propertyRaw = activeReviewOptions?.importPlainLocationFields
    ? (root.querySelector('[name="rawPropertyTypeText"]')?.value || "")
    : "";
  const propertyId = activeReviewOptions?.importPlainLocationFields
    ? ""
    : (root.querySelector('input[name="propertyTypeId"]')?.value || "");
  const isLand = activeReviewOptions?.importPlainLocationFields
    ? /أرض|ارض/.test(propertyRaw)
    : propertyId === "land";

  if (transactionFields) {
    const fields = [];
    if (mode === "sale") {
      fields.push(numericField(
        "salePrice",
        reviewLabel("salePrice", "السعر المطلوب (ريال)", needs),
        activeReviewValues.salePrice
      ));
    } else if (mode === "rent") {
      fields.push(numericField(
        "annualRent",
        reviewLabel("annualRent", "الإيجار السنوي (ريال)", needs),
        activeReviewValues.annualRent
      ));
      fields.push(numericField(
        "paymentInstallments",
        reviewLabel("paymentInstallments", "عدد الدفعات", needs),
        activeReviewValues.paymentInstallments
      ));
      if (activeReviewValues.optionalMonthlyRent !== "" && activeReviewValues.optionalMonthlyRent != null) {
        fields.push(numericField(
          "optionalMonthlyRent",
          reviewLabel(
            "optionalMonthlyRentAfterSixMonths",
            "الإيجار الشهري الاختياري بعد أول 6 أشهر (ريال)",
            needs
          ),
          activeReviewValues.optionalMonthlyRent
        ));
      }
      if (activeReviewValues.monthlyRent !== "" && activeReviewValues.monthlyRent != null) {
        fields.push(numericField("monthlyRent", "الإيجار الشهري (ريال)", activeReviewValues.monthlyRent));
      }
    } else if (mode === "budget") {
      fields.push(numericField(
        "budget",
        reviewLabel("budget", "الميزانية (ريال)", needs),
        activeReviewValues.budget
      ));
    } else if (mode === "investment") {
      fields.push(numericField(
        "investmentValue",
        "القيمة الاستثمارية (ريال)",
        activeReviewValues.investmentValue
      ));
    }
    transactionFields.innerHTML = fields.join("");
  }

  if (propertyFields) {
    if (awaitingTransaction) {
      propertyFields.innerHTML = "";
      return;
    }
    const fields = [
      numericField("area", reviewLabel("area", "المساحة (م²)", needs), activeReviewValues.area)
    ];
    if (!isLand) {
      fields.push(numericField(
        "rooms",
        reviewLabel("rooms", "عدد الغرف", needs),
        activeReviewValues.rooms
      ));
      fields.push(numericField(
        "bathrooms",
        reviewLabel("bathrooms", "دورات المياه", needs),
        activeReviewValues.bathrooms
      ));
      fields.push(numericField(
        "floorNumber",
        reviewLabel("floorNumber", "رقم الدور / الطابق", needs),
        activeReviewValues.floorNumber
      ));
    }
    propertyFields.innerHTML = fields.join("");
  }
}

function refreshDistrictField(root) {
  const districtInput = root.querySelector('[data-search-for="districtId"]');
  const districtHidden = root.querySelector('input[name="districtId"]');
  if (districtInput) districtInput.value = "";
  if (districtHidden) districtHidden.value = "";
  const list = root.querySelector('[data-list-for="districtId"]');
  if (list) list.innerHTML = "";
  syncManualVisibility(root);
}

function syncManualVisibility(root) {
  const propertyId = root.querySelector('input[name="propertyTypeId"]')?.value;
  const cityId = root.querySelector('input[name="cityId"]')?.value;
  const districtId = root.querySelector('input[name="districtId"]')?.value;
  const propManual = root.querySelector('[data-manual-for="propertyTypeId"]');
  const cityManual = root.querySelector('[data-manual-for="cityId"]');
  const distManual = root.querySelector('[data-manual-for="districtId"]');
  if (propManual) propManual.hidden = propertyId !== "other";
  if (cityManual) cityManual.hidden = cityId !== "other";
  if (distManual) distManual.hidden = districtId !== DISTRICT_OTHER_ID;
}

function readReviewForm() {
  const form = $("opportunityReviewForm");
  if (!form) return null;
  const data = Object.fromEntries(new FormData(form).entries());
  const ctx = reviewContextFromDraft();
  if (activeReviewOptions?.importSimplifiedReview) {
    const opportunityKind = data.opportunityKind || "OFFER";
    const purpose = activeDraft?.fields?.purpose
      || activeDraft?.prepared?.opportunity?.purpose
      || ctx.purpose
      || "";
    const operationTypeId = data.operationTypeId
      || resolveImportOperationTypeId({ opportunityKind, purpose });
    const mode = reviewTransactionMode(operationTypeId, { ...ctx, opportunityKind, purpose });
    const land = classifyImportPropertyType(data.rawPropertyTypeText || "") === "land";
    const extra = {};
    for (const field of IMPORT_EXTRA_FIELD_DEFS) {
      if (data[field.name] !== undefined) extra[field.name] = data[field.name] || "";
    }
    return {
      importSimplifiedReview: true,
      importPlainLocationFields: true,
      opportunityKind,
      purpose,
      operationTypeId,
      rawCityText: data.rawCityText || "",
      rawNeighborhoodText: data.rawNeighborhoodText || "",
      rawPropertyTypeText: data.rawPropertyTypeText || "",
      salePrice: mode === "sale" ? (data.salePrice || "") : "",
      annualRent: mode === "rent" ? (data.annualRent || "") : "",
      monthlyRent: mode === "rent" ? (data.monthlyRent || "") : "",
      optionalMonthlyRentAfterSixMonths: mode === "rent" ? (data.optionalMonthlyRent || "") : "",
      paymentInstallments: mode === "rent" ? (data.paymentInstallments || "") : "",
      budget: mode === "budget" ? (data.budget || "") : "",
      investmentValue: mode === "investment" ? (data.investmentValue || "") : "",
      area: data.area || "",
      rooms: land ? "" : (data.rooms || ""),
      bathrooms: data.bathrooms || extra.bathrooms || "",
      floorNumber: data.floorNumber || extra.floorNumber || "",
      units: data.units || "",
      floorsCount: data.floorsCount || "",
      importExtraFields: extra,
      livingRoom: extra.livingRoom || "",
      direction: extra.direction || "",
      streetWidth: extra.streetWidth || "",
      condition: extra.condition || "",
      usageType: extra.usageType || "",
      waterAndSewagePaidBy: extra.waterAndSewagePaidBy || "",
      electricityMeter: extra.electricityMeter || "",
      description: extra.description || "",
      ownerConditions: extra.ownerConditions || "",
      extractedSnapshot: activeDraft?.fields ? {
        opportunityKind,
        purpose: purpose || activeDraft.fields.purpose || "",
        propertyType: activeDraft.fields.propertyType || "",
        city: activeDraft.fields.city || "",
        district: activeDraft.fields.district || ""
      } : null
    };
  }
  const mode = reviewTransactionMode(data.operationTypeId || "", ctx);
  const land = activeReviewOptions?.importPlainLocationFields
    ? /أرض|ارض/.test(String(data.rawPropertyTypeText || ""))
    : data.propertyTypeId === "land";
  const review = activeReviewOptions?.importPlainLocationFields
    ? {
      operationTypeId: data.operationTypeId || "",
      importPlainLocationFields: true,
      rawCityText: data.rawCityText || "",
      rawNeighborhoodText: data.rawNeighborhoodText || "",
      rawPropertyTypeText: data.rawPropertyTypeText || "",
      salePrice: mode === "sale" ? (data.salePrice || "") : "",
      annualRent: mode === "rent" ? (data.annualRent || "") : "",
      monthlyRent: mode === "rent" ? (data.monthlyRent || "") : "",
      optionalMonthlyRentAfterSixMonths: mode === "rent" ? (data.optionalMonthlyRent || "") : "",
      paymentInstallments: mode === "rent" ? (data.paymentInstallments || "") : "",
      budget: mode === "budget" ? (data.budget || "") : "",
      investmentValue: mode === "investment" ? (data.investmentValue || "") : "",
      area: data.area || "",
      rooms: land ? "" : (data.rooms || ""),
      bathrooms: land ? "" : (data.bathrooms || ""),
      floorNumber: land ? "" : (data.floorNumber || ""),
      extractedSnapshot: activeDraft?.fields ? {
        opportunityKind: activeDraft.fields.opportunityKind || "",
        purpose: activeDraft.fields.purpose || "",
        propertyType: activeDraft.fields.propertyType || "",
        city: activeDraft.fields.city || "",
        district: activeDraft.fields.district || ""
      } : null
    }
    : {
    operationTypeId: data.operationTypeId || "",
    propertyTypeId: data.propertyTypeId || "",
    propertyTypeManual: data.propertyTypeManual || "",
    propertyTypeDisplay: form.querySelector('[data-search-for="propertyTypeId"]')?.value || "",
    cityId: data.cityId || "",
    cityManual: data.cityManual || "",
    districtId: data.districtId || "",
    districtManual: data.districtManual || "",
    districtDisplay: form.querySelector('[data-search-for="districtId"]')?.value || "",
    salePrice: mode === "sale" ? (data.salePrice || "") : "",
    annualRent: mode === "rent" ? (data.annualRent || "") : "",
    monthlyRent: mode === "rent" ? (data.monthlyRent || "") : "",
    optionalMonthlyRentAfterSixMonths: mode === "rent" ? (data.optionalMonthlyRent || "") : "",
    paymentInstallments: mode === "rent" ? (data.paymentInstallments || "") : "",
    budget: mode === "budget" ? (data.budget || "") : "",
    investmentValue: mode === "investment" ? (data.investmentValue || "") : "",
    area: data.area || "",
    rooms: land ? "" : (data.rooms || ""),
    bathrooms: land ? "" : (data.bathrooms || ""),
    floorNumber: land ? "" : (data.floorNumber || ""),
    extractedSnapshot: activeDraft?.fields ? {
      opportunityKind: activeDraft.fields.opportunityKind || "",
      purpose: activeDraft.fields.purpose || "",
      propertyType: activeDraft.fields.propertyType || "",
      city: activeDraft.fields.city || "",
      district: activeDraft.fields.district || ""
    } : null
  };
  return review;
}

function setReviewStatus(message, isError = false) {
  const node = $("opportunityReviewStatus");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("is-error", isError);
}

async function submitReview() {
  const review = readReviewForm();
  if (!review) return;
  if (activeReviewOptions?.importSimplifiedReview) {
    const saveMinimum = evaluateImportReviewSaveMinimum(review);
    const missingHint = $("importReviewMissingHint");
    if (missingHint) {
      if (!saveMinimum.ok) {
        missingHint.hidden = false;
        missingHint.textContent = `بيانات ناقصة: ${saveMinimum.missingLabelsArabic.join("، ")} — سيتم الحفظ بحالة «تحتاج استكمال».`;
      } else {
        missingHint.hidden = true;
        missingHint.textContent = "";
      }
    }
  } else if (!review.operationTypeId) {
    return setReviewStatus("اختر نوع العملية", true);
  } else if (activeReviewOptions?.importPlainLocationFields) {
    if (!String(review.rawPropertyTypeText || "").trim()) {
      return setReviewStatus("أدخل نوع العقار", true);
    }
    if (!String(review.rawCityText || "").trim()) {
      return setReviewStatus("أدخل المدينة", true);
    }
    if (!String(review.rawNeighborhoodText || "").trim()) {
      return setReviewStatus("أدخل الحي", true);
    }
  } else {
    if (!String(review.propertyTypeDisplay || "").trim()) {
      return setReviewStatus("أدخل نوع العقار", true);
    }
    if (!review.cityId) return setReviewStatus("اختر المدينة", true);
    if (review.cityId === "other" && !review.cityManual.trim()) {
      return setReviewStatus("اكتب المدينة", true);
    }
    if (!String(review.districtDisplay || "").trim()) {
      return setReviewStatus("أدخل الحي", true);
    }
  }

  const approveBtn = $("opportunityReviewApprove");
  if (approveBtn) {
    approveBtn.disabled = true;
    approveBtn.textContent = "جارٍ الحفظ…";
  }
  setReviewStatus("");

  try {
    const brokerExtras = activeReviewOptions?.importSimplifiedReview
      ? importSimplifiedReviewValuesToBrokerFields(review)
      : activeReviewOptions?.importPlainLocationFields
        ? importReviewValuesToBrokerFields(review)
        : reviewValuesToBrokerFields(review);
    const advertiser = readAdvertiserForm();
    if (typeof onApproveCallback === "function") {
      await onApproveCallback(brokerExtras, review, advertiser);
    }
    closeReview();
  } catch (error) {
    console.warn("[iaqar] review approve", error);
    const code = String(error?.message || error?.code || "");
    const detail = code && code !== "undefined"
      ? `تعذر الحفظ (${code}). حاول مرة أخرى.`
      : "تعذر الحفظ. حاول مرة أخرى.";
    setReviewStatus(detail, true);
  } finally {
    if (approveBtn) {
      approveBtn.disabled = false;
      approveBtn.textContent = activeReviewOptions?.approveLabel || "اعتماد وحفظ";
    }
  }
}

function bootReviewOverlay() {
  const overlay = $("opportunityReviewOverlay");
  if (!overlay || overlay.dataset.bound === "1") return;
  overlay.dataset.bound = "1";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeReview();
  });
  $("opportunityReviewClose")?.addEventListener("click", () => closeReview());
  wireAdvertiserMessageModal();
  window.addEventListener("iaqar:opportunity-review-closed", () => {
    overlay.hidden = true;
    document.body.style.overflow = "";
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootReviewOverlay, { once: true });
} else {
  bootReviewOverlay();
}

export function dismissOpportunityReviewIfOpen() {
  const overlay = $("opportunityReviewOverlay");
  if (overlay && !overlay.hidden) closeReview();
}

export function openOpportunityReview(draft, onApprove, options = {}) {
  openReviewOverlay(draft, onApprove, options);
}

window.IAQAR = window.IAQAR || {};
window.IAQAR.closeOpportunityReview = closeReview;

export const __test = {
  buildReviewDefaults,
  reviewValuesToBrokerFields,
  readReviewForm,
  syncReviewConditionalVisibility,
  renderDynamicReviewFields,
  extractAdvertiserPhonesFromText
};
