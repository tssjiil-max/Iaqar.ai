/**
 * Opportunity details ViewModel for Content V2.
 * UI binds here, not to Firestore field names.
 */

export {
  V2_DATA_ROWS,
  mapOpportunityDetailsV2ViewModel,
  v2ReferenceActivities,
  v2ReferenceAppointment,
  v2ReferenceFixture
} from "../../opportunity-details-v2-domain.js";

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
