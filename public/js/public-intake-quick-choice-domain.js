/**
 * Public intake quick-choice labels → existing canonical form values.
 * UI-only mapping; no new stored enums.
 */

export const OWNER_PURPOSE_OPTIONS = Object.freeze([
  { id: "sale", label: "بيع", transactionType: "sale", purpose: "SALE" },
  { id: "rent", label: "إيجار", transactionType: "rent", purpose: "RENT" }
]);

export const CLIENT_PURPOSE_OPTIONS = Object.freeze([
  { id: "purchase", label: "شراء", requestKind: "purchase" },
  { id: "rent", label: "إيجار", requestKind: "rent" }
]);

export const PROPERTY_TYPE_OPTIONS = Object.freeze([
  { id: "apartment", label: "شقة", value: "شقة" },
  { id: "villa", label: "فيلا", value: "فيلا" },
  { id: "floor", label: "دور", value: "دور" },
  { id: "land", label: "أرض", value: "أرض" },
  { id: "building", label: "عمارة", value: "عمارة" },
  { id: "shop", label: "محل", value: "محل" },
  { id: "office", label: "مكتب", value: "مكتب" },
  { id: "rest_house", label: "استراحة", value: "استراحة" },
  { id: "warehouse", label: "مستودع", value: "مستودع" },
  { id: "other", label: "أخرى", value: "" }
]);

export function ownerPurposeFromChip(chipId = "") {
  return OWNER_PURPOSE_OPTIONS.find((row) => row.id === chipId) || null;
}

export function clientPurposeFromChip(chipId = "") {
  return CLIENT_PURPOSE_OPTIONS.find((row) => row.id === chipId) || null;
}

export function propertyTypeFromChip(chipId = "", freeText = "") {
  const row = PROPERTY_TYPE_OPTIONS.find((item) => item.id === chipId);
  if (!row) return "";
  if (row.id === "other") return String(freeText || "").trim();
  return row.value;
}

export function buildOwnerPricingFields(purposeOption, priceOrBudget) {
  const amount = Number(priceOrBudget || 0);
  const purpose = purposeOption?.purpose || "SALE";
  const isRent = purpose === "RENT";
  return {
    transactionType: purposeOption?.transactionType || "sale",
    purpose,
    salePrice: isRent ? 0 : amount,
    annualRent: isRent ? amount : 0,
    amount,
    priceOrBudget: amount
  };
}

export function inferOwnerPurposeChip(transactionType = "", purpose = "") {
  const tx = String(transactionType || "").toLowerCase();
  const p = String(purpose || "").toUpperCase();
  if (tx === "rent" || p === "RENT") return "rent";
  return "sale";
}

export function inferClientPurposeChip(requestKind = "", transactionType = "") {
  const kind = String(requestKind || "").toLowerCase();
  const tx = String(transactionType || "").toLowerCase();
  if (kind === "rent" || tx === "rent") return "rent";
  return "purchase";
}

export function inferPropertyTypeChip(propertyType = "") {
  const text = String(propertyType || "").trim();
  if (!text) return "";
  const hit = PROPERTY_TYPE_OPTIONS.find((row) => row.value && row.value === text);
  return hit ? hit.id : "other";
}

export function intakePriceFieldLabel(owner, purposeChipId = "") {
  if (owner) {
    return purposeChipId === "rent" ? "الإيجار السنوي" : "سعر البيع";
  }
  return purposeChipId === "rent" ? "ميزانية الإيجار السنوي" : "الميزانية";
}

function chipMarkup(group, options) {
  return options.map((opt) =>
    `<button type="button" class="access-chip" data-chip-group="${group}" data-chip-id="${opt.id}" data-testid="intake-chip-${group}-${opt.id}">${opt.label}</button>`
  ).join("");
}

/**
 * Repairs the public intake form when the classic access-gate renders before
 * this ES module has executed. Without this repair, quick-choice arrays are
 * temporarily unavailable and the purpose/property rows render empty until a refresh.
 */
export function hydrateEarlyIntakeQuickChoices(root = document) {
  const form = root?.querySelector?.("#intakeForm");
  if (!form) return false;
  const purposeRow = form.querySelector(".access-chip-row--purpose");
  const propertyRow = form.querySelector(".access-chip-row--property");
  if (!purposeRow || !propertyRow) return false;

  const owner = Boolean(form.querySelector("#transactionTypeInput"));
  if (!purposeRow.querySelector(".access-chip")) {
    purposeRow.innerHTML = chipMarkup("purpose", owner ? OWNER_PURPOSE_OPTIONS : CLIENT_PURPOSE_OPTIONS);
  }
  if (!propertyRow.querySelector(".access-chip")) {
    propertyRow.innerHTML = chipMarkup("property", PROPERTY_TYPE_OPTIONS);
  }

  const purposeHidden = form.querySelector("#intakePurposeValue");
  const requestKindInput = form.querySelector("#requestKindInput");
  const transactionTypeInput = form.querySelector("#transactionTypeInput");
  const propertyInput = form.querySelector("#propertyTypeInput");
  const otherWrap = form.querySelector("#propertyTypeOtherWrap");
  const otherInput = form.querySelector("#propertyTypeOtherInput");
  const priceLabel = form.querySelector("#intakePriceLabel");

  form.querySelectorAll(".access-chip").forEach((button) => {
    if (button.dataset.quickChoiceRepairBound === "1") return;
    button.dataset.quickChoiceRepairBound = "1";
    button.addEventListener("click", () => {
      const group = button.dataset.chipGroup;
      const chipId = button.dataset.chipId || "";
      form.querySelectorAll(`[data-chip-group="${group}"]`).forEach((node) => {
        node.classList.toggle("is-selected", node === button);
      });
      if (group === "purpose") {
        if (purposeHidden) purposeHidden.value = chipId;
        if (owner) {
          const row = ownerPurposeFromChip(chipId);
          if (transactionTypeInput && row) transactionTypeInput.value = row.transactionType;
        } else {
          const row = clientPurposeFromChip(chipId);
          if (requestKindInput && row) requestKindInput.value = row.requestKind;
        }
        if (priceLabel) priceLabel.innerHTML = `${intakePriceFieldLabel(owner, chipId)} <span class="access-required-mark" aria-hidden="true">*</span>`;
      } else if (group === "property") {
        if (propertyInput) propertyInput.dataset.chipId = chipId;
        const isOther = chipId === "other";
        if (otherWrap) otherWrap.hidden = !isOther;
        if (otherInput) otherInput.required = isOther;
        if (propertyInput) propertyInput.value = propertyTypeFromChip(chipId, otherInput?.value || "");
      }
    });
  });

  if (otherInput && otherInput.dataset.quickChoiceRepairBound !== "1") {
    otherInput.dataset.quickChoiceRepairBound = "1";
    otherInput.addEventListener("input", () => {
      if (propertyInput?.dataset.chipId === "other") propertyInput.value = String(otherInput.value || "").trim();
    });
  }
  return true;
}

if (typeof window !== "undefined") {
  window.IAQARPublicIntakeQuickChoice = {
    OWNER_PURPOSE_OPTIONS,
    CLIENT_PURPOSE_OPTIONS,
    PROPERTY_TYPE_OPTIONS,
    ownerPurposeFromChip,
    clientPurposeFromChip,
    propertyTypeFromChip,
    buildOwnerPricingFields,
    inferOwnerPurposeChip,
    inferClientPurposeChip,
    inferPropertyTypeChip,
    intakePriceFieldLabel,
    hydrateEarlyIntakeQuickChoices
  };
  // ES modules and classic deferred scripts do not have a reliable relative
  // execution order across all mobile browsers. Repair an already-rendered form.
  hydrateEarlyIntakeQuickChoices(document);
}
