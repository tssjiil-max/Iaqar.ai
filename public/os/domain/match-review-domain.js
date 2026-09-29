/**
 * Match review domain — turns a persisted Match (real engine score, reasons,
 * warnings) plus its two repository records into a compact comparison.
 * The level is derived from the engine's computed score only; nothing is invented.
 */

import { formatArea, formatPrice, toNumber } from "./format-domain.js";
import { kindOf, priceOf, purposeShortLabel, recordLocation, RECORD_KIND } from "./records-domain.js";

export const COMPATIBILITY_LEVELS = Object.freeze([
  { min: 85, key: "HIGH", label: "توافق مرتفع" },
  { min: 70, key: "GOOD", label: "توافق جيد" },
  { min: 55, key: "INITIAL", label: "توافق مبدئي" },
  { min: 0, key: "LOW", label: "توافق ضعيف" }
]);

export function compatibilityLevel(score) {
  const n = Math.round(toNumber(score));
  const level = COMPATIBILITY_LEVELS.find((item) => n >= item.min) || COMPATIBILITY_LEVELS.at(-1);
  return { ...level, score: n };
}

function parseList(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? list.map((item) => (typeof item === "string" ? item : item?.label || item?.text || "")).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function matchReasons(match = {}) {
  return parseList(match.reasonsJson ?? match.reasons).slice(0, 5);
}

export function matchWarnings(match = {}) {
  return parseList(match.warningsJson ?? match.warnings).slice(0, 4);
}

export function splitPair(a = {}, b = {}) {
  if (kindOf(a) === RECORD_KIND.OFFER) return { offer: a, request: b };
  if (kindOf(b) === RECORD_KIND.OFFER) return { offer: b, request: a };
  return { offer: a, request: b };
}

function same(a, b) {
  const n = (v) => String(v || "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/^حي\s+/, "").trim();
  return Boolean(n(a)) && n(a) === n(b);
}

/**
 * Rows: { key, label, offer, request, state: "match" | "differ" | "unknown" }.
 */
export function compareRecords(offer = {}, request = {}) {
  const rows = [];
  rows.push({
    key: "type", label: "نوع العقار",
    offer: offer.propertyType || "—", request: request.propertyType || "—",
    state: offer.propertyType && request.propertyType ? (same(offer.propertyType, request.propertyType) ? "match" : "differ") : "unknown"
  });
  const offerPurpose = purposeShortLabel(offer.purpose);
  const requestPurpose = purposeShortLabel(request.purpose);
  const purposeMatch = (String(offer.purpose).toUpperCase() === "SALE" && String(request.purpose).toUpperCase() === "PURCHASE")
    || (String(offer.purpose).toUpperCase() === "RENT" && String(request.purpose).toUpperCase() === "LEASE_REQUEST");
  rows.push({ key: "purpose", label: "الغرض", offer: offerPurpose || "—", request: requestPurpose || "—", state: offerPurpose && requestPurpose ? (purposeMatch ? "match" : "differ") : "unknown" });
  rows.push({
    key: "location", label: "الموقع",
    offer: recordLocation(offer) || "—", request: recordLocation(request) || "—",
    state: offer.district && request.district ? (same(offer.district, request.district) ? "match" : "differ") : "unknown"
  });
  const price = priceOf(offer);
  const budget = priceOf(request);
  let priceState = "unknown";
  let priceNote = "";
  if (price && budget) {
    if (price <= budget) { priceState = "match"; priceNote = "ضمن الميزانية"; }
    else {
      const gap = Math.round(((price - budget) / budget) * 100);
      priceState = "differ";
      priceNote = `أعلى من الميزانية بـ ${gap}%`;
    }
  }
  rows.push({ key: "price", label: "السعر / الميزانية", offer: formatPrice(price) || "—", request: formatPrice(budget) || "—", state: priceState, note: priceNote });
  const offerArea = toNumber(offer.area);
  const requestArea = toNumber(request.area);
  if (offerArea || requestArea) {
    rows.push({
      key: "area", label: "المساحة",
      offer: formatArea(offerArea) || "غير محددة", request: formatArea(requestArea) || "غير محددة",
      state: offerArea && requestArea ? (Math.abs(offerArea - requestArea) / Math.max(offerArea, requestArea) <= 0.15 ? "match" : "differ") : "unknown"
    });
  }
  const offerRooms = toNumber(offer.rooms);
  const requestRooms = toNumber(request.rooms);
  if (offerRooms || requestRooms) {
    rows.push({
      key: "rooms", label: "الغرف",
      offer: offerRooms ? String(offerRooms) : "—", request: requestRooms ? String(requestRooms) : "—",
      state: offerRooms && requestRooms ? (offerRooms >= requestRooms ? "match" : "differ") : "unknown"
    });
  }
  return rows;
}

/** One-line summary for a task card: "السعر ضمن الميزانية · توافق جيد". */
export function reviewHeadline(match = {}, offer = {}, request = {}) {
  const rows = compareRecords(offer, request);
  const priceRow = rows.find((row) => row.key === "price");
  const level = compatibilityLevel(match.score);
  return [priceRow?.note, level.label].filter(Boolean).join(" · ");
}

export const REVIEW_DECISIONS = Object.freeze({
  APPROVE: "approve",
  REJECT: "reject",
  POSTPONE: "postpone",
  REQUEST_INFO: "request_info"
});
