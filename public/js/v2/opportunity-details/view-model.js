/**
 * Opportunity details ViewModel for Content V2.
 * UI binds here, not to Firestore field names.
 */

import {
  V2_DATA_ROWS,
  mapOpportunityDetailsV2ViewModel,
  v2ReferenceActivities,
  v2ReferenceAppointment,
  v2ReferenceFixture
} from "../../opportunity-details-v2-domain.js";
import { isDisplayValueComplete } from "../../opportunity-field-completion-domain.js";

export {
  V2_DATA_ROWS,
  mapOpportunityDetailsV2ViewModel,
  v2ReferenceActivities,
  v2ReferenceAppointment,
  v2ReferenceFixture
};

const ROW_EDITOR_KEYS = Object.freeze({
  propertyPurpose: ["propertyPurpose", "purpose", "propertyType"],
  location: ["location", "city", "district"],
  price: ["price", "priceOrBudget", "salePrice", "annualRent", "budget"],
  specs: ["area"],
  advertiser: ["advertiserRole"],
  contact: ["contact", "contactPhone", "contactNumber"]
});

export const DISPLAY_ROW_EDITORS = Object.freeze({
  propertyPurpose: "propertyPurpose",
  location: "location",
  price: "price",
  specs: "area",
  advertiser: "advertiserRole",
  contact: "contactNumber"
});

export function editorForDataRow(rowKey, missingFields = []) {
  const keys = ROW_EDITOR_KEYS[rowKey] || [];
  const hit = (missingFields || []).find((field) => keys.includes(field.key) || keys.includes(field.editor));
  return hit?.editor || "";
}

function rowDisplayValues(vm = {}, rowKey = "") {
  switch (rowKey) {
    case "propertyPurpose":
      return [vm.propertyPurpose];
    case "location":
      return [vm.location, vm.locationSecondary];
    case "price":
      return [vm.price];
    case "specs":
      return [vm.area, vm.specifications];
    case "advertiser":
      return [vm.advertiserName, vm.advertiserRole, vm.advertiserSecondary];
    case "contact":
      return [vm.contactNumber];
    default:
      return [];
  }
}

export function isDisplayedRowComplete(vm = {}, rowKey = "") {
  if (rowKey === "location") {
    const city = vm.cityValue || vm.city || "";
    const district = vm.districtValue || vm.district || "";
    return isDisplayValueComplete(city) && isDisplayValueComplete(district);
  }
  return rowDisplayValues(vm, rowKey).some((value) => isDisplayValueComplete(value));
}

export function displayedMissingRows(vm = {}) {
  return V2_DATA_ROWS.filter((row) => !isDisplayedRowComplete(vm, row.key));
}

export function displayedMissingRowLabels(vm = {}) {
  return displayedMissingRows(vm).map((row) => (
    row.key === "price" ? (vm.priceLabel || row.label) : row.label
  ));
}

export function editorForDisplayedRow(rowKey, vm = {}) {
  if (isDisplayedRowComplete(vm, rowKey)) return "";
  return editorForDataRow(rowKey, vm.missingFields) || DISPLAY_ROW_EDITORS[rowKey] || "";
}

export function firstMissingEditor(vm = {}) {
  for (const row of V2_DATA_ROWS) {
    const editor = editorForDisplayedRow(row.key, vm);
    if (editor) return editor;
  }
  return "";
}

export function completenessLine(vm = {}) {
  const total = V2_DATA_ROWS.length;
  const missing = displayedMissingRowLabels(vm);
  const complete = Math.max(0, total - missing.length);
  if (!missing.length) return `${complete} من ${total} بيانات مكتملة`;
  if (missing.length <= 2) return `ينقص ${missing.join(" و")}`;
  return `${complete} من ${total} بيانات مكتملة`;
}

export function nextActionLine(vm = {}) {
  const missing = displayedMissingRowLabels(vm);
  if (missing.length) return `الإجراء التالي: أكمل ${missing.join(" و")}`;
  const appointment = vm.nextAppointment || {};
  const waiting = /بانتظار التأكيد/.test(String(appointment.confirmationStatus || ""));
  if (waiting) return "الإجراء التالي: تأكيد موعد المعاينة";
  return "الإجراء التالي: متابعة الفرصة";
}
