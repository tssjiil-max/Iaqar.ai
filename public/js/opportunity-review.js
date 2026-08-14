/**
 * Opportunity review overlay — searchable catalog fields + advertiser data before final save.
 */

import {
  OPERATION_TYPES,
  buildReviewDefaults,
  filterBySearch,
  isLandPropertyLabel,
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

function $(id) {
  return document.getElementById(id);
}

let activeDraft = null;
let onApproveCallback = null;
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
  if (/^9665\d{8}$/.test(digits)) return digits.slice(3);
  if (/^05\d{8}$/.test(digits)) return digits.slice(1);
  if (/^5\d{8}$/.test(digits)) return digits;
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

function openReviewOverlay(draft, onApprove) {
  const overlay = $("opportunityReviewOverlay");
  if (!overlay) return;
  activeDraft = draft;
  onApproveCallback = onApprove;
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
  renderReviewForm(defaults);
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

function renderAdvertiserSection(defaults) {
  const primary = advertiserCandidates.length === 1 ? advertiserCandidates[0] : null;
  const localPhone = primary ? e164ToLocalInput(primary.advertiserPhoneNormalized) : "";
  const roleOptions = ADVERTISER_ROLES.map((r) =>
    `<option value="${r.id}" ${r.id === "UNKNOWN" ? "selected" : ""}>${escapeHtml(r.label)}</option>`
  ).join("");
  const contactOptions = ADVERTISER_CONTACT_STATUSES.map((r) =>
    `<option value="${r.id}" ${r.id === "NOT_CONTACTED" ? "selected" : ""}>${escapeHtml(r.label)}</option>`
  ).join("");
  const marketingOptions = MARKETING_CONSENT_STATUSES.map((r) =>
    `<option value="${r.id}" ${r.id === "NOT_STARTED" ? "selected" : ""}>${escapeHtml(r.label)}</option>`
  ).join("");
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
        <div class="advertiser-phone-row">
          <span class="advertiser-phone-prefix" aria-hidden="true">+966</span>
          <input name="advertiserPhoneLocal" type="tel" inputmode="numeric" maxlength="9"
            placeholder="5XXXXXXXX" value="${escapeHtml(localPhone)}"
            aria-label="رقم جوال المعلن بدون مفتاح الدولة">
        </div>
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

function renderReviewForm(defaults) {
  const body = $("opportunityReviewBody");
  if (!body) return;
  const needs = defaults.needsReview || {};
  const mode = reviewTransactionMode(defaults.operationTypeId);
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

  body.innerHTML = `
    <p class="review-hint">راجع القيم المستخرجة وعدّل ما يلزم قبل الحفظ النهائي.</p>
    ${snapshotLines.length
      ? `<p class="review-extracted">مستخرَج: ${escapeHtml(snapshotLines.join(" — "))}</p>` : ""}
    <form id="opportunityReviewForm" class="review-form" autocomplete="off">
      ${searchField("operationTypeId", reviewLabel("transactionType", "نوع العملية", needs), OPERATION_TYPES, defaults.operationTypeId, "label")}
      ${textField("propertyType", reviewLabel("propertyType", "نوع العقار", needs), defaults.propertyType)}
      ${textField("city", reviewLabel("city", "المدينة", needs), defaults.city)}
      ${textField("district", reviewLabel("district", "الحي", needs), defaults.district)}
      <div id="reviewTransactionFields" style="display:contents"></div>
      <div id="reviewPropertyFields" style="display:contents"></div>
      ${renderAdvertiserSection(defaults)}
      <div class="review-actions">
        <button type="submit" class="review-approve" id="opportunityReviewApprove">اعتماد وحفظ</button>
        <button type="button" class="review-cancel" id="opportunityReviewCancel">إلغاء</button>
      </div>
      <p class="review-status" id="opportunityReviewStatus" role="status"></p>
    </form>
  `;

  wireSearchFields(body);
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
  return {
    propertyType: form.querySelector('[name="propertyType"]')?.value || activeDraft?.fields?.propertyType || "",
    district: form.querySelector('[name="district"]')?.value || activeDraft?.fields?.district || "",
    city: form.querySelector('[name="city"]')?.value || activeDraft?.fields?.city || ""
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
    window.open(url, "_blank", "noopener,noreferrer");
    if (ctx?.onWhatsAppOpened) {
      void ctx.onWhatsAppOpened();
    } else {
      const statusSelect = document.querySelector('select[name="advertiserContactStatus"]');
      if (statusSelect) statusSelect.value = "OPENED_WHATSAPP";
      window.dispatchEvent(new CustomEvent("iaqar:advertiser-handoff", {
        detail: { state: "OPENED_EXTERNAL", contactStatus: "OPENED_WHATSAPP" }
      }));
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

function textField(name, label, value) {
  return `
    <label class="review-field" data-field="${name}">
      <span>${label}</span>
      <input name="${name}" type="text" value="${escapeHtml(value || "")}" maxlength="120">
    </label>
  `;
}

function searchField(name, label, items, selectedId, labelKey = "label") {
  const selected = items.find((i) => i.id === selectedId);
  const display = selected ? escapeHtml(selected[labelKey] || selected.label || "") : "";
  return `
    <label class="search-field" data-field="${name}">
      <span>${label}</span>
      <input type="text" class="search-select-input" data-search-for="${name}" placeholder="ابحث أو اختر…" value="${display}">
      <input type="hidden" name="${name}" value="${escapeHtml(selectedId || "")}">
      <ul class="search-select-list" data-list-for="${name}" hidden></ul>
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

function wireSearchFields(root) {
  root.querySelectorAll(".search-select-input").forEach((input) => {
    const field = input.dataset.searchFor;
    const list = root.querySelector(`[data-list-for="${field}"]`);
    const hidden = root.querySelector(`input[name="${field}"]`);
    const items = field === "operationTypeId" ? OPERATION_TYPES : [];

    const render = (query = "") => {
      const labelKey = "label";
      const filtered = filterBySearch(query, items, labelKey).slice(0, 40);
      list.innerHTML = filtered.map((item) =>
        `<li><button type="button" data-pick-id="${escapeHtml(item.id)}" data-pick-label="${escapeHtml(item[labelKey] || item.label || "")}">${escapeHtml(item[labelKey] || item.label || "")}</button></li>`
      ).join("");
      list.hidden = filtered.length === 0;
    };

    input.addEventListener("focus", () => {
      render(input.value);
      list.hidden = false;
    });
    input.addEventListener("input", () => render(input.value));
    list.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-pick-id]");
      if (!btn) return;
      hidden.value = btn.dataset.pickId || "";
      input.value = btn.dataset.pickLabel || "";
      input.closest("label")?.querySelector("[data-review-needed]")?.remove();
      list.hidden = true;
      if (field === "operationTypeId") {
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
  const propertyText = root.querySelector('[name="propertyType"]')?.value || "";
  const mode = reviewTransactionMode(operationId);
  const needs = defaults.needsReview || activeDraft?.needsReview || activeDraft?.fields?.needsReview || {};
  const transactionFields = root.querySelector("#reviewTransactionFields");
  const propertyFields = root.querySelector("#reviewPropertyFields");
  const awaitingTransaction = mode === "unknown";
  for (const fieldName of ["propertyType", "city", "district"]) {
    const field = root.querySelector(`[data-field="${fieldName}"]`);
    if (field) field.style.display = awaitingTransaction ? "none" : "";
  }
  const advertiserSection = root.querySelector(".review-advertiser-card");
  if (advertiserSection) advertiserSection.style.display = awaitingTransaction ? "none" : "";

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
      fields.push(numericField("budget", "الميزانية (ريال)", activeReviewValues.budget));
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
    if (!isLandPropertyLabel(propertyText)) {
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

function readReviewForm() {
  const form = $("opportunityReviewForm");
  if (!form) return null;
  const data = Object.fromEntries(new FormData(form).entries());
  const mode = reviewTransactionMode(data.operationTypeId || "");
  const land = isLandPropertyLabel(data.propertyType || "");
  return {
    operationTypeId: data.operationTypeId || "",
    propertyType: data.propertyType || "",
    city: data.city || "",
    district: data.district || "",
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
  if (!review.operationTypeId) return setReviewStatus("اختر نوع العملية", true);
  if (!review.propertyType.trim()) return setReviewStatus("اكتب نوع العقار", true);
  if (!review.city.trim()) return setReviewStatus("اكتب المدينة", true);

  const approveBtn = $("opportunityReviewApprove");
  if (approveBtn) {
    approveBtn.disabled = true;
    approveBtn.textContent = "جارٍ الحفظ…";
  }
  setReviewStatus("");

  try {
    const brokerExtras = reviewValuesToBrokerFields(review);
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
      approveBtn.textContent = "اعتماد وحفظ";
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

export function openOpportunityReview(draft, onApprove) {
  openReviewOverlay(draft, onApprove);
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
