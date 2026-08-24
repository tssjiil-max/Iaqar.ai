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

export function editorForDataRow(rowKey, missingFields = []) {
  const keys = ROW_EDITOR_KEYS[rowKey] || [];
  const hit = (missingFields || []).find((field) => keys.includes(field.key) || keys.includes(field.editor));
  return hit?.editor || "";
}

export function firstMissingEditor(vm = {}) {
  return vm.missingFields?.[0]?.editor || "";
}

function missingRowLabels(vm = {}) {
  const labels = [];
  const seen = new Set();
  for (const row of V2_DATA_ROWS) {
    if (!editorForDataRow(row.key, vm.missingFields || [])) continue;
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    labels.push(row.key === "price" ? (vm.priceLabel || row.label) : row.label);
  }
  return labels;
}

export function completenessLine(vm = {}) {
  const total = V2_DATA_ROWS.length;
  const missing = missingRowLabels(vm);
  const complete = Math.max(0, total - missing.length);
  if (!missing.length) return `${total} من ${total} بيانات مكتملة`;
  if (missing.length <= 2) return `ينقص ${missing.join(" و")}`;
  return `${complete} من ${total} بيانات مكتملة`;
}

export function nextActionLine(vm = {}) {
  const missing = missingRowLabels(vm);
  if (missing.length) return `الإجراء التالي: أكمل ${missing.join(" و")}`;
  const appointment = vm.nextAppointment || {};
  const waiting = /بانتظار التأكيد/.test(String(appointment.confirmationStatus || ""));
  if (waiting) return "الإجراء التالي: تأكيد موعد المعاينة";
  return "الإجراء التالي: متابعة الفرصة";
}
