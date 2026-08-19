/**
 * Unified display-layer field completion — shared by details table and listing cards.
 * Uses readiness checks for matching fields; presentation-only rules for optional rows.
 */

import { normalizeAdvertiserPhoneE164 } from "./advertiser-phone-domain.js";
import { safeText } from "./opportunity-intake-domain.js";

const PLACEHOLDER_VALUES = new Set([
  "",
  "—",
  "-",
  "غير محدد",
  "تحتاج مراجعة",
  "unknown",
  "null",
  "undefined"
]);

/**
 * Whether a displayed scalar value counts as complete (not placeholder / empty).
 * @param {*} value
 * @returns {boolean}
 */
export function isDisplayValueComplete(value) {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  const text = String(value).trim();
  if (!text) return false;
  if (PLACEHOLDER_VALUES.has(text)) return false;
  if (PLACEHOLDER_VALUES.has(text.toLowerCase())) return false;
  return true;
}

/**
 * Phone is complete only when normalized E.164 is valid.
 * @param {*} value
 * @returns {boolean}
 */
export function isContactPhoneComplete(value) {
  return Boolean(normalizeAdvertiserPhoneE164(value));
}

/**
 * Build combined specs line for presentation (area, street, facade, rooms).
 * @param {object} record
 * @returns {string}
 */
export function buildOpportunitySpecsLine(record = {}) {
  const parts = [];
  const area = Number(record.area || 0);
  if (area > 0) parts.push(`${area.toLocaleString("ar-SA")} م²`);

  const streetWidth = Number(record.streetWidth || 0);
  if (streetWidth > 0) parts.push(`شارع ${streetWidth.toLocaleString("ar-SA")}م`);

  const facing = safeText(record.facing || record.direction || "", 40);
  if (facing) parts.push(`واجهة ${facing}`);

  const rooms = Number(record.rooms || 0);
  if (rooms > 0) parts.push(`${rooms.toLocaleString("ar-SA")} غرف`);

  return parts.join(" — ");
}

/** @returns {boolean} */
export function isSpecsRowComplete(record = {}) {
  return isDisplayValueComplete(buildOpportunitySpecsLine(record));
}

/**
 * Map a details-table row key to completion using view-model checks.
 * @param {object} vm — buildOpportunityDetailsViewModel result
 * @param {string} rowKey
 * @returns {boolean}
 */
export function isDetailsRowComplete(vm, rowKey = "") {
  switch (rowKey) {
    case "propertyPurpose":
      return vm.byKey.propertyType?.complete !== false && vm.byKey.purpose?.complete !== false;
    case "location":
      return vm.byKey.city?.complete !== false && vm.byKey.district?.complete !== false;
    case "price":
      return vm.byKey.priceOrBudget?.complete !== false;
    case "specs":
      return isSpecsRowComplete(vm.rawRecord || {});
    case "advertiser":
      return vm.byKey.advertiserRole?.complete !== false;
    case "contact":
      return vm.byKey.contactPhone?.complete !== false;
    default:
      return true;
  }
}
