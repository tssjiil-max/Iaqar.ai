/**
 * Opportunity review overlay — searchable catalog fields before final save.
 */

import {
  CITIES,
  DISTRICT_OTHER_ID,
  DISTRICTS,
  OPERATION_TYPES,
  PROPERTY_TYPES,
  buildReviewDefaults,
  districtsForCity,
  filterBySearch,
  reviewValuesToBrokerFields
} from "./reference-catalog.js";

function $(id) {
  return document.getElementById(id);
}

let activeDraft = null;
let onApproveCallback = null;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function closeReview() {
  const overlay = $("opportunityReviewOverlay");
  if (!overlay) return;
  overlay.hidden = true;
  document.body.style.overflow = "";
  window.dispatchEvent(new CustomEvent("iaqar:nav-close-request"));
  activeDraft = null;
}

function openReviewOverlay(draft, onApprove) {
  const overlay = $("opportunityReviewOverlay");
  if (!overlay) return;
  activeDraft = draft;
  onApproveCallback = onApprove;
  const defaults = buildReviewDefaults(draft.fields || {}, draft.sourceText || "");
  renderReviewForm(defaults);
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  window.dispatchEvent(new CustomEvent("iaqar:nav-open", { detail: { view: "opportunityReviewOverlay" } }));
}

function renderReviewForm(defaults) {
  const body = $("opportunityReviewBody");
  if (!body) return;
  body.innerHTML = `
    <p class="review-hint">راجع القيم المستخرجة وعدّل ما يلزم قبل الحفظ النهائي.</p>
    ${defaults.extractedSnapshot?.propertyType || defaults.extractedSnapshot?.district
      ? `<p class="review-extracted">مستخرَج: ${escapeHtml(
        [defaults.extractedSnapshot.propertyType, defaults.extractedSnapshot.city, defaults.extractedSnapshot.district]
          .filter(Boolean).join(" — ")
      )}</p>` : ""}
    <form id="opportunityReviewForm" class="review-form" autocomplete="off">
      ${searchField("operationTypeId", "نوع العملية", OPERATION_TYPES, defaults.operationTypeId, "label")}
      ${searchField("propertyTypeId", "نوع العقار", PROPERTY_TYPES, defaults.propertyTypeId, "label")}
      ${manualField("propertyTypeManual", "اكتب نوع العقار", defaults.propertyTypeManual, defaults.propertyTypeId === "other")}
      ${searchField("cityId", "المدينة", CITIES, defaults.cityId, "label")}
      ${manualField("cityManual", "اكتب المدينة", defaults.cityManual, defaults.cityId === "other")}
      ${searchField("districtId", "الحي", districtOptions(defaults.cityId), defaults.districtId, "officialName", defaults.districtManual)}
      ${manualField("districtManual", "اكتب اسم الحي", defaults.districtManual, defaults.districtId === DISTRICT_OTHER_ID)}
      ${numericField("priceOrBudget", "السعر / الميزانية (ريال)", defaults.priceOrBudget)}
      ${numericField("area", "المساحة (م²)", defaults.area)}
      ${numericField("rooms", "عدد الغرف", defaults.rooms)}
      <div class="review-actions">
        <button type="submit" class="review-approve" id="opportunityReviewApprove">اعتماد وحفظ</button>
        <button type="button" class="review-cancel" id="opportunityReviewCancel">إلغاء</button>
      </div>
      <p class="review-status" id="opportunityReviewStatus" role="status"></p>
    </form>
  `;

  wireSearchFields(body);
  const form = $("opportunityReviewForm");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitReview();
  });
  $("opportunityReviewCancel")?.addEventListener("click", () => closeReview());
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

function searchField(name, label, items, selectedId, labelKey = "label", districtManual = "") {
  const selected = items.find((i) => i.id === selectedId);
  const display = selected
    ? escapeHtml(selected[labelKey] || selected.label || "")
    : (name === "districtId" && selectedId === DISTRICT_OTHER_ID
      ? "حي آخر / غير موجود في القائمة"
      : "");
  return `
    <label class="search-field" data-field="${name}">
      <span>${label}</span>
      <input type="text" class="search-select-input" data-search-for="${name}" placeholder="ابحث أو اختر…" value="${display}">
      <input type="hidden" name="${name}" value="${escapeHtml(selectedId || "")}">
      <ul class="search-select-list" data-list-for="${name}" hidden></ul>
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

function wireSearchFields(root) {
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
      list.hidden = true;
      syncManualVisibility(root);
      if (field === "cityId") refreshDistrictField(root);
    });
    document.addEventListener("click", (event) => {
      if (!input.parentElement.contains(event.target)) list.hidden = true;
    });
  });
}

function refreshDistrictField(root) {
  const cityId = root.querySelector('input[name="cityId"]')?.value || "madinah";
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
  return {
    operationTypeId: data.operationTypeId || "",
    propertyTypeId: data.propertyTypeId || "",
    propertyTypeManual: data.propertyTypeManual || "",
    cityId: data.cityId || "",
    cityManual: data.cityManual || "",
    districtId: data.districtId || "",
    districtManual: data.districtManual || "",
    priceOrBudget: data.priceOrBudget || "",
    area: data.area || "",
    rooms: data.rooms || "",
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
  if (!review.propertyTypeId) return setReviewStatus("اختر نوع العقار", true);
  if (review.propertyTypeId === "other" && !review.propertyTypeManual.trim()) {
    return setReviewStatus("اكتب نوع العقار", true);
  }
  if (!review.cityId) return setReviewStatus("اختر المدينة", true);
  if (review.cityId === "other" && !review.cityManual.trim()) {
    return setReviewStatus("اكتب المدينة", true);
  }
  if (!review.districtId) return setReviewStatus("اختر الحي", true);
  if (review.districtId === DISTRICT_OTHER_ID && !review.districtManual.trim()) {
    return setReviewStatus("اكتب اسم الحي", true);
  }

  const approveBtn = $("opportunityReviewApprove");
  if (approveBtn) {
    approveBtn.disabled = true;
    approveBtn.textContent = "جارٍ الحفظ…";
  }
  setReviewStatus("");

  try {
    const brokerExtras = reviewValuesToBrokerFields(review);
    if (typeof onApproveCallback === "function") {
      await onApproveCallback(brokerExtras, review);
    }
    closeReview();
  } catch (error) {
    console.warn("[iaqar] review approve", error);
    setReviewStatus("تعذر الحفظ. حاول مرة أخرى.", true);
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

export function openOpportunityReview(draft, onApprove) {
  openReviewOverlay(draft, onApprove);
}

export const __test = {
  buildReviewDefaults,
  reviewValuesToBrokerFields,
  readReviewForm
};
