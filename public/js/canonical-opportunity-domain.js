/**
 * Single canonical opportunity resolver.
 * Offers/requests are the source of truth. Display and completeness
 * must both consume this object — never a second property copy.
 */

import { isDisplayValueComplete } from "./opportunity-field-completion-domain.js";
import { normalizeOpportunityFinancials } from "./opportunity-intake-domain.js";
import {
  normalizePropertyTypeDisplay,
  sanitizeDisplayField
} from "./display-sanitize-domain.js";

const GENERIC_TYPE = /^(العقار|property|n\/?a|unknown|-)$/i;

function text(value, max = 180) {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  return raw.slice(0, max);
}

function scalar(value, max = 120) {
  if (value == null) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : "";
  }
  const cleaned = text(value, max);
  if (!isDisplayValueComplete(cleaned)) return "";
  if (GENERIC_TYPE.test(cleaned)) return "";
  return cleaned;
}

function place(value, max = 80) {
  const raw = scalar(value, max);
  if (!raw) return "";
  const cleaned = sanitizeDisplayField(normalizePropertyTypeDisplay(raw));
  if (!cleaned.display || cleaned.needsReview || cleaned.display === "تحتاج مراجعة") return "";
  if (!isDisplayValueComplete(cleaned.display) || GENERIC_TYPE.test(cleaned.display)) return "";
  return cleaned.display;
}

function kindOf(record = {}) {
  const kind = text(record.opportunityKind || record.kind || record.recordType, 40).toUpperCase();
  const contact = text(record.contactType, 20).toLowerCase();
  if (kind === "REQUEST" || kind === "CLIENT" || kind === "CLIENT_REQUEST" || contact === "client") {
    return "request";
  }
  if (kind === "OFFER" || kind === "OWNER" || kind === "OWNER_OFFER" || contact === "owner") {
    return "offer";
  }
  if (Number(record.budget || 0) > 0 && !(Number(record.salePrice || record.price || 0) > 0)) {
    return "request";
  }
  return "offer";
}

function purposeOf(record = {}) {
  return text(record.purpose || record.transactionType, 30).toUpperCase();
}

function moneyFields(record = {}) {
  const fields = normalizeOpportunityFinancials(record);
  const sale = Number(fields.salePrice ?? record.salePrice ?? record.price ?? 0);
  const budget = Number(fields.budget ?? record.budget ?? 0);
  const rent = Number(fields.annualRent ?? record.annualRent ?? 0);
  return {
    price: sale > 0 ? sale : (rent > 0 ? rent : ""),
    budget: budget > 0 ? budget : "",
    annualRent: rent > 0 ? rent : ""
  };
}

function imagesOf(record = {}) {
  const urls = [];
  const raw = []
    .concat(record.images || [])
    .concat(record.photos || [])
    .concat(record.imageUrls || [])
    .concat(record.mediaUrls || []);
  for (const value of raw) {
    const url = text(value, 500);
    if (!/^https:\/\//i.test(url)) continue;
    if (urls.includes(url)) continue;
    urls.push(url);
  }
  return urls;
}

function locationUrlOf(record = {}) {
  const url = text(record.locationUrl || record.mapUrl, 500);
  if (!/^https:\/\//i.test(url)) return "";
  return url;
}

function specsOf(record = {}) {
  const bits = [];
  const rooms = Number(record.rooms || 0);
  const baths = Number(record.baths || record.bathrooms || 0);
  if (rooms > 0) bits.push(`${rooms} غرف`);
  if (baths > 0) bits.push(`${baths} دورات مياه`);
  const extra = scalar(record.specs, 80);
  if (extra && !bits.includes(extra)) bits.push(extra);
  return bits.join(" · ");
}

/**
 * Normalize a stored opportunity (offer or request) into the canonical shape.
 * Empty / placeholder / generic values become empty strings — never invented.
 */
export function resolveCanonicalOpportunity(record = {}) {
  const id = text(record.id || record.opportunityId, 180);
  const money = moneyFields(record);
  const area = Number(record.area || 0);
  return {
    id,
    kind: kindOf(record),
    purpose: purposeOf(record),
    propertyType: place(record.propertyType, 80),
    city: place(record.city, 80),
    district: place(record.district, 80).replace(/^حي\s+/, ""),
    price: money.price,
    budget: money.budget,
    area: area > 0 ? area : "",
    specs: specsOf(record),
    streetDirection: scalar(record.streetDirection, 40),
    streetWidth: Number(record.streetWidth || 0) > 0 ? Number(record.streetWidth) : "",
    frontage: scalar(record.facing || record.direction || record.facade || record.frontage, 40),
    depth: Number(record.depth || 0) > 0 ? Number(record.depth) : "",
    plotNumber: scalar(record.plotNumber, 40),
    description: scalar(record.description || record.details, 600),
    images: imagesOf(record),
    locationUrl: locationUrlOf(record),
    advertiserRole: text(record.advertiserRole || record.ownerRole, 20).toUpperCase(),
    contactPhone: text(
      record.advertiserPhoneNormalized || record.contactPhone || record.phone || record.advertiserPhoneRaw,
      40
    )
  };
}

export function isCanonicalFieldComplete(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return isDisplayValueComplete(value) && !GENERIC_TYPE.test(String(value).trim());
}
