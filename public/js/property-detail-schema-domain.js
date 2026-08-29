/**
 * Property-type structured detail keys for post-match coordination (V1).
 * Four primary types: شقة / فيلا / أرض / عمارة — "أخرى" keeps legacy spec groups.
 */

import { PROPERTY_TYPES } from "./reference-catalog.js";

export const PROPERTY_DETAIL_CATEGORY = Object.freeze({
  APARTMENT: "apartment",
  VILLA: "villa",
  LAND: "land",
  BUILDING: "building",
  OTHER: "other"
});

export const DETAIL_KEY = Object.freeze({
  AREA: "area",
  BEDROOMS: "bedrooms",
  BATHROOMS: "bathrooms",
  FLOOR: "floor",
  ELEVATOR: "elevator",
  PARKING: "parking",
  FURNISHED: "furnished",
  LAND_AREA: "landArea",
  BUILDING_AREA: "buildingArea",
  FLOORS: "floors",
  YARD: "yard",
  USE_TYPE: "useType",
  FRONTAGE: "frontage",
  STREET_COUNT: "streetCount",
  STREET_WIDTHS: "streetWidths",
  DIMENSIONS: "dimensions",
  CORNER: "corner",
  UNITS: "units",
  SHOPS: "shops",
  ANNUAL_INCOME: "annualIncome",
  APPROXIMATE_LOCATION: "approximate_location",
  PHOTOS: "photos",
  PRICE: "price"
});

const DETAIL_LABELS = Object.freeze({
  [DETAIL_KEY.AREA]: "المساحة",
  [DETAIL_KEY.BEDROOMS]: "عدد الغرف",
  [DETAIL_KEY.BATHROOMS]: "عدد الحمامات",
  [DETAIL_KEY.FLOOR]: "الدور",
  [DETAIL_KEY.ELEVATOR]: "مصعد",
  [DETAIL_KEY.PARKING]: "موقف",
  [DETAIL_KEY.FURNISHED]: "مفروشة",
  [DETAIL_KEY.LAND_AREA]: "مساحة الأرض",
  [DETAIL_KEY.BUILDING_AREA]: "مساحة البناء",
  [DETAIL_KEY.FLOORS]: "عدد الأدوار",
  [DETAIL_KEY.YARD]: "حوش",
  [DETAIL_KEY.USE_TYPE]: "الاستخدام",
  [DETAIL_KEY.FRONTAGE]: "الواجهة",
  [DETAIL_KEY.STREET_COUNT]: "عدد الشوارع",
  [DETAIL_KEY.STREET_WIDTHS]: "عرض الشارع",
  [DETAIL_KEY.DIMENSIONS]: "الأطوال",
  [DETAIL_KEY.CORNER]: "زاوية / غير زاوية",
  [DETAIL_KEY.UNITS]: "عدد الوحدات",
  [DETAIL_KEY.SHOPS]: "عدد المحلات",
  [DETAIL_KEY.ANNUAL_INCOME]: "الدخل السنوي",
  [DETAIL_KEY.APPROXIMATE_LOCATION]: "الموقع التقريبي",
  [DETAIL_KEY.PHOTOS]: "الصور",
  [DETAIL_KEY.PRICE]: "السعر"
});

const APARTMENT_KEYS = Object.freeze([
  DETAIL_KEY.AREA,
  DETAIL_KEY.BEDROOMS,
  DETAIL_KEY.BATHROOMS,
  DETAIL_KEY.FLOOR,
  DETAIL_KEY.ELEVATOR,
  DETAIL_KEY.PARKING,
  DETAIL_KEY.FURNISHED
]);

const VILLA_KEYS = Object.freeze([
  DETAIL_KEY.LAND_AREA,
  DETAIL_KEY.BUILDING_AREA,
  DETAIL_KEY.BEDROOMS,
  DETAIL_KEY.BATHROOMS,
  DETAIL_KEY.FLOORS,
  DETAIL_KEY.PARKING,
  DETAIL_KEY.YARD
]);

const LAND_KEYS = Object.freeze([
  DETAIL_KEY.AREA,
  DETAIL_KEY.USE_TYPE,
  DETAIL_KEY.FRONTAGE,
  DETAIL_KEY.STREET_COUNT,
  DETAIL_KEY.STREET_WIDTHS,
  DETAIL_KEY.DIMENSIONS,
  DETAIL_KEY.CORNER
]);

const BUILDING_KEYS = Object.freeze([
  DETAIL_KEY.LAND_AREA,
  DETAIL_KEY.FLOORS,
  DETAIL_KEY.UNITS,
  DETAIL_KEY.SHOPS,
  DETAIL_KEY.ELEVATOR,
  DETAIL_KEY.PARKING,
  DETAIL_KEY.ANNUAL_INCOME
]);

const LAND_FORBIDDEN = new Set([
  DETAIL_KEY.BEDROOMS,
  DETAIL_KEY.BATHROOMS,
  DETAIL_KEY.FLOOR,
  DETAIL_KEY.ELEVATOR,
  DETAIL_KEY.FURNISHED
]);

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function resolvePropertyTypeId(propertyTypeLabel = "") {
  const label = text(propertyTypeLabel);
  if (!label) return "other";
  for (const item of PROPERTY_TYPES) {
    if (item.label === label || item.id === label) return item.id;
    if ((item.matchTerms || []).some((term) => label.includes(term))) return item.id;
  }
  return "other";
}

function uniqueList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((v) => text(v)).filter(Boolean))];
}

export function propertyDetailCategory(propertyTypeLabel = "") {
  const id = resolvePropertyTypeId(propertyTypeLabel);
  if (id === "apartment" || id === "floor" || id === "furnished") return PROPERTY_DETAIL_CATEGORY.APARTMENT;
  if (id === "villa" || id === "house") return PROPERTY_DETAIL_CATEGORY.VILLA;
  if (id === "land") return PROPERTY_DETAIL_CATEGORY.LAND;
  if (id === "building" || id === "commercial_building") return PROPERTY_DETAIL_CATEGORY.BUILDING;
  return PROPERTY_DETAIL_CATEGORY.OTHER;
}

export function detailKeysForPropertyType(propertyTypeLabel = "") {
  const category = propertyDetailCategory(propertyTypeLabel);
  if (category === PROPERTY_DETAIL_CATEGORY.APARTMENT) return [...APARTMENT_KEYS];
  if (category === PROPERTY_DETAIL_CATEGORY.VILLA) return [...VILLA_KEYS];
  if (category === PROPERTY_DETAIL_CATEGORY.LAND) return [...LAND_KEYS];
  if (category === PROPERTY_DETAIL_CATEGORY.BUILDING) return [...BUILDING_KEYS];
  return [];
}

export function detailKeyLabel(key = "") {
  return DETAIL_LABELS[text(key)] || text(key);
}

export function detailKeyOptions(propertyTypeLabel = "") {
  return detailKeysForPropertyType(propertyTypeLabel).map((value) => ({
    value,
    label: detailKeyLabel(value)
  }));
}

export function isLandForbiddenDetailKey(key = "") {
  return LAND_FORBIDDEN.has(text(key));
}

export function canonicalHasDetailKey(key = "", offer = {}) {
  const k = text(key);
  if (k === DETAIL_KEY.PRICE) {
    return Number(offer.salePrice || offer.price || offer.priceOrBudget || 0) > 0;
  }
  if (k === DETAIL_KEY.PHOTOS) {
    const paths = offer.mediaPaths;
    const count = Number(offer.imageCount || 0);
    if (count > 0) return true;
    if (Array.isArray(paths) && paths.length) return true;
    if (typeof paths === "string" && paths.trim()) {
      try {
        const parsed = JSON.parse(paths);
        return Array.isArray(parsed) && parsed.length > 0;
      } catch {
        return false;
      }
    }
    return false;
  }
  if (k === DETAIL_KEY.APPROXIMATE_LOCATION) {
    return Boolean(text(offer.city) || text(offer.district) || text(offer.locationUrl || offer.mapUrl));
  }
  if (k === DETAIL_KEY.AREA || k === DETAIL_KEY.BUILDING_AREA) {
    return Number(offer.area || 0) > 0;
  }
  if (k === DETAIL_KEY.LAND_AREA) {
    return Number(offer.landArea || offer.plotArea || offer.area || 0) > 0;
  }
  if (k === DETAIL_KEY.BEDROOMS) return Number(offer.rooms || 0) > 0;
  if (k === DETAIL_KEY.BATHROOMS) return Number(offer.bathrooms || offer.baths || 0) > 0;
  if (k === DETAIL_KEY.FLOOR) return Number(offer.floorNumber || offer.floor || 0) > 0;
  if (k === DETAIL_KEY.FLOORS) return Number(offer.floors || offer.floorCount || 0) > 0;
  if (k === DETAIL_KEY.ELEVATOR) return offer.elevator === true || offer.elevator === "yes" || /مصعد/i.test(text(offer.amenities));
  if (k === DETAIL_KEY.PARKING) return Boolean(text(offer.parking)) || Number(offer.parkingCount || 0) > 0;
  if (k === DETAIL_KEY.FURNISHED) return offer.furnished === true || offer.furnished === "yes" || /مفروش/i.test(text(offer.amenities));
  if (k === DETAIL_KEY.YARD) return Boolean(text(offer.yard || offer.description));
  if (k === DETAIL_KEY.USE_TYPE) return Boolean(text(offer.usage || offer.useType || offer.description));
  if (k === DETAIL_KEY.FRONTAGE) return Boolean(text(offer.facing || offer.facade || offer.direction));
  if (k === DETAIL_KEY.STREET_COUNT) return Number(offer.streetCount || 0) > 0;
  if (k === DETAIL_KEY.STREET_WIDTHS) return Number(offer.streetWidth || 0) > 0;
  if (k === DETAIL_KEY.DIMENSIONS) {
    return Number(offer.depth || 0) > 0 || Number(offer.length || 0) > 0 || Boolean(text(offer.plotNumber));
  }
  if (k === DETAIL_KEY.CORNER) return offer.corner === true || offer.corner === "yes" || offer.corner === "corner";
  if (k === DETAIL_KEY.UNITS) return Number(offer.units || offer.unitCount || 0) > 0;
  if (k === DETAIL_KEY.SHOPS) return Number(offer.shops || offer.shopCount || 0) > 0;
  if (k === DETAIL_KEY.ANNUAL_INCOME) return Number(offer.annualIncome || offer.annualRent || 0) > 0;
  return false;
}

export function ownerMissingDetailKeys(clientBundle = {}, offer = {}, propertyTypeLabel = "") {
  const requested = uniqueList(clientBundle.requestedDetailKeys || []);
  if (!requested.length) return [];
  return requested.filter((key) => !canonicalHasDetailKey(key, offer));
}

export function detailKeyCanonicalValue(key = "", offer = {}) {
  const k = text(key);
  if (!canonicalHasDetailKey(k, offer)) return "";
  if (k === DETAIL_KEY.AREA || k === DETAIL_KEY.BUILDING_AREA) {
    return `${Number(offer.area)} م²`;
  }
  if (k === DETAIL_KEY.LAND_AREA) {
    const v = Number(offer.landArea || offer.plotArea || offer.area || 0);
    return v > 0 ? `${v} م²` : "";
  }
  if (k === DETAIL_KEY.BEDROOMS) return String(Number(offer.rooms || 0));
  if (k === DETAIL_KEY.BATHROOMS) return String(Number(offer.bathrooms || offer.baths || 0));
  if (k === DETAIL_KEY.FLOOR) return String(Number(offer.floorNumber || offer.floor || 0));
  if (k === DETAIL_KEY.FLOORS) return String(Number(offer.floors || offer.floorCount || 0));
  if (k === DETAIL_KEY.PRICE) {
    const sale = Number(offer.salePrice || offer.price || 0);
    return sale > 0 ? `${sale.toLocaleString("en-US")} ر.س` : "";
  }
  if (k === DETAIL_KEY.FRONTAGE) return text(offer.facing || offer.facade || offer.direction);
  if (k === DETAIL_KEY.USE_TYPE) return text(offer.usage || offer.useType);
  if (k === DETAIL_KEY.STREET_WIDTHS) {
    const w = Number(offer.streetWidth || 0);
    return w > 0 ? `${w} م` : "";
  }
  if (k === DETAIL_KEY.STREET_COUNT) return String(Number(offer.streetCount || 0));
  if (k === DETAIL_KEY.UNITS) return String(Number(offer.units || offer.unitCount || 0));
  if (k === DETAIL_KEY.SHOPS) return String(Number(offer.shops || offer.shopCount || 0));
  if (k === DETAIL_KEY.ANNUAL_INCOME) {
    const v = Number(offer.annualIncome || offer.annualRent || 0);
    return v > 0 ? `${v.toLocaleString("en-US")} ر.س` : "";
  }
  if (k === DETAIL_KEY.PARKING) return text(offer.parking);
  if (k === DETAIL_KEY.YARD) return text(offer.yard);
  if (k === DETAIL_KEY.ELEVATOR || k === DETAIL_KEY.FURNISHED || k === DETAIL_KEY.CORNER) return "نعم";
  if (k === DETAIL_KEY.DIMENSIONS) {
    const depth = Number(offer.depth || 0);
    const length = Number(offer.length || 0);
    if (depth > 0 && length > 0) return `${length} × ${depth} م`;
    if (depth > 0) return `${depth} م`;
  }
  if (k === DETAIL_KEY.APPROXIMATE_LOCATION) return text(offer.district || offer.city);
  if (k === DETAIL_KEY.PHOTOS) return "متوفرة";
  return "";
}

export function detailValuesToCanonicalPatch(detailValues = {}) {
  const patch = {};
  const values = detailValues && typeof detailValues === "object" ? detailValues : {};
  if (values.area != null && Number(values.area) > 0) patch.area = Number(values.area);
  if (values.buildingArea != null && Number(values.buildingArea) > 0) patch.area = Number(values.buildingArea);
  if (values.landArea != null && Number(values.landArea) > 0) patch.landArea = Number(values.landArea);
  if (values.bedrooms != null && Number(values.bedrooms) > 0) patch.rooms = Number(values.bedrooms);
  if (values.bathrooms != null && Number(values.bathrooms) > 0) patch.bathrooms = Number(values.bathrooms);
  if (values.floor != null && Number(values.floor) > 0) patch.floorNumber = Number(values.floor);
  if (values.floors != null && Number(values.floors) > 0) patch.floors = Number(values.floors);
  if (values.parking != null) patch.parking = text(values.parking);
  if (values.yard != null) patch.yard = text(values.yard);
  if (values.useType != null) patch.usage = text(values.useType);
  if (values.frontage != null) patch.facing = text(values.frontage);
  if (values.streetCount != null && Number(values.streetCount) > 0) patch.streetCount = Number(values.streetCount);
  if (values.streetWidths != null && Number(values.streetWidths) > 0) patch.streetWidth = Number(values.streetWidths);
  if (values.dimensions != null) {
    const dims = text(values.dimensions);
    const match = dims.match(/(\d+)\s*[×x]\s*(\d+)/);
    if (match) {
      patch.length = Number(match[1]);
      patch.depth = Number(match[2]);
    }
  }
  if (values.corner != null) patch.corner = values.corner === true || values.corner === "yes" || values.corner === "corner";
  if (values.units != null && Number(values.units) > 0) patch.units = Number(values.units);
  if (values.shops != null && Number(values.shops) > 0) patch.shops = Number(values.shops);
  if (values.annualIncome != null && Number(values.annualIncome) > 0) patch.annualIncome = Number(values.annualIncome);
  if (values.elevator != null) patch.elevator = values.elevator === true || values.elevator === "yes";
  if (values.furnished != null) patch.furnished = values.furnished === true || values.furnished === "yes";
  return patch;
}

if (typeof window !== "undefined") {
  window.IAQARPropertyDetailSchema = {
    DETAIL_KEY,
    detailKeysForPropertyType,
    detailKeyOptions,
    detailKeyLabel,
    canonicalHasDetailKey,
    ownerMissingDetailKeys,
    detailKeyCanonicalValue,
    detailValuesToCanonicalPatch
  };
}
