/**
 * Coordination decision bundles — semantic keys only in storage.
 * Question sets (client-v1 / owner-v1) supply UI labels; resolver compares meaning.
 */

import {
  slotsOverlap,
  APPOINTMENT_TIME_ZONE
} from "./iaqar-appointment-domain.js";
import { LIVING_TASK_STAGE } from "./match-group-domain.js";
import { PROPERTY_TYPES } from "./reference-catalog.js";
import { listingMediaPaths } from "./party-session-domain.js";
import {
  detailKeyOptions,
  ownerMissingDetailKeys,
  canonicalHasDetailKey,
  detailKeysForPropertyType,
  detailKeyCanonicalValue,
  detailKeyLabel
} from "./property-detail-schema-domain.js";

export const COORDINATION_OUTCOME = Object.freeze({
  AWAITING_OTHER_PARTY: "AWAITING_OTHER_PARTY",
  AWAITING_BOTH_PARTIES: "AWAITING_BOTH_PARTIES",
  CLIENT_NOT_INTERESTED: "CLIENT_NOT_INTERESTED",
  PROPERTY_NOT_AVAILABLE: "PROPERTY_NOT_AVAILABLE",
  CLIENT_NEEDS_INFO: "CLIENT_NEEDS_INFO",
  NEGOTIATION_PENDING_OWNER: "NEGOTIATION_PENDING_OWNER",
  NEGOTIATION_ACCEPTED: "NEGOTIATION_ACCEPTED",
  NEGOTIATION_COUNTERED: "NEGOTIATION_COUNTERED",
  NEGOTIATION_REJECTED: "NEGOTIATION_REJECTED",
  VIEWING_READY: "VIEWING_READY",
  SCHEDULE_CONFLICT: "SCHEDULE_CONFLICT",
  NEEDS_BROKER: "NEEDS_BROKER",
  OWNER_VIEWING_BLOCKED: "OWNER_VIEWING_BLOCKED"
});

/** @deprecated use CLIENT_INTEREST_STATUS */
export const CLIENT_INTEREST = Object.freeze({
  INTERESTED: "interested",
  NOT_SUITABLE: "not_suitable"
});

export const CLIENT_INTEREST_STATUS = Object.freeze({
  INTERESTED: "interested",
  /** Kept only to read old saved replies. New UI never emits it. */
  PRELIMINARY_OK: "preliminary_ok",
  NOT_SUITABLE: "not_suitable"
});

export const CLIENT_INTEREST_ACTION = Object.freeze({
  DETAILS: "details",
  VIEWING: "viewing"
});

export const REJECTION_DISPOSITION = Object.freeze({
  NEGOTIABLE: "negotiable",
  FINAL: "final"
});

export const REJECTION_REASON = Object.freeze({
  PRICE: "price",
  PAYMENT_TERMS: "payment_terms",
  CONDITION: "condition",
  SPECIFICATIONS: "specifications",
  OTHER: "other"
});

export const NEGOTIATION_DECISION = Object.freeze({
  ACCEPT: "accept",
  COUNTER: "counter",
  REJECT: "reject"
});

/** @deprecated use wantsViewing + infoNeeds */
export const CLIENT_NEXT_ACTION = Object.freeze({
  VIEWING: "viewing",
  MORE_INFO: "more_info",
  NONE: "none"
});

export const OWNER_AVAILABILITY = Object.freeze({
  AVAILABLE: "available",
  NOT_AVAILABLE: "not_available"
});

export const OWNER_VIEWING_ALLOWED = Object.freeze({
  YES: "yes",
  NO: "no",
  NEEDS_COORDINATION: "needs_coordination"
});

export const CLIENT_INFO_NEEDS = Object.freeze({
  PRICE: "price",
  LOCATION: "location",
  PHOTOS: "photos",
  SPECS: "specs",
  SPECIFICATIONS: "specifications",
  OTHER: "other"
});

export const VIEWING_DAY = Object.freeze({
  TODAY: "today",
  TOMORROW: "tomorrow",
  WEEKEND: "weekend"
});

export const VIEWING_PERIOD = Object.freeze({
  MORNING: "morning",
  AFTERNOON: "afternoon",
  EVENING: "evening"
});

export const SPEC_GROUP = Object.freeze({
  AREA: "area",
  ROOMS_BATHROOMS: "rooms_bathrooms",
  FLOOR_ELEVATOR: "floor_elevator",
  PARKING_AMENITIES: "parking_amenities",
  FLOORS: "floors",
  FACADE: "facade",
  STREETS: "streets",
  LENGTHS: "lengths",
  USAGE: "usage",
  SERVICES: "services"
});

export const PRICE_CONFIRMATION = Object.freeze({
  CONFIRMED: "confirmed",
  UPDATED: "updated"
});

/** Relative viewing window ids — resolved to ISO start times in Asia/Riyadh */
export const VIEWING_WINDOW_IDS = Object.freeze([
  "today_morning",
  "today_afternoon",
  "today_evening",
  "tomorrow_morning",
  "tomorrow_afternoon",
  "tomorrow_evening",
  "day2_morning",
  "day2_afternoon",
  "day2_evening"
]);

export const QUESTION_SET_VERSIONS = Object.freeze({
  CLIENT_V1: "client-v1",
  OWNER_V1: "owner-v1"
});

const APARTMENT_TYPE_IDS = new Set(["apartment", "floor", "furnished"]);
const VILLA_TYPE_IDS = new Set(["villa", "house"]);
const LAND_TYPE_IDS = new Set(["land"]);
const COMMERCIAL_TYPE_IDS = new Set([
  "shop", "office", "showroom", "warehouse", "commercial_building", "hotel", "building"
]);

const SPEC_GROUP_LABELS = Object.freeze({
  [SPEC_GROUP.AREA]: "المساحة",
  [SPEC_GROUP.ROOMS_BATHROOMS]: "الغرف والحمامات",
  [SPEC_GROUP.FLOOR_ELEVATOR]: "الدور والمصعد",
  [SPEC_GROUP.PARKING_AMENITIES]: "المواقف والمزايا",
  [SPEC_GROUP.FLOORS]: "الأدوار",
  [SPEC_GROUP.FACADE]: "الواجهة",
  [SPEC_GROUP.STREETS]: "الشوارع",
  [SPEC_GROUP.LENGTHS]: "الأطوال",
  [SPEC_GROUP.USAGE]: "الاستخدام",
  [SPEC_GROUP.SERVICES]: "المواقف والخدمات"
});

const DAY_PERIOD_TO_WINDOW = Object.freeze({
  today: { morning: "today_morning", afternoon: "today_afternoon", evening: "today_evening" },
  tomorrow: { morning: "tomorrow_morning", afternoon: "tomorrow_afternoon", evening: "tomorrow_evening" },
  weekend: { morning: "day2_morning", afternoon: "day2_afternoon", evening: "day2_evening" }
});

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function uniqueList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((v) => text(v)).filter(Boolean))];
}

export function resolvePropertyTypeId(propertyTypeLabel = "") {
  const label = text(propertyTypeLabel);
  if (!label) return "other";
  for (const item of PROPERTY_TYPES) {
    if (item.label === label || item.id === label) return item.id;
    if ((item.matchTerms || []).some((term) => label.includes(term))) return item.id;
  }
  return "other";
}

export function specGroupsForPropertyType(propertyTypeLabel = "") {
  const id = resolvePropertyTypeId(propertyTypeLabel);
  if (LAND_TYPE_IDS.has(id)) {
    return [SPEC_GROUP.AREA, SPEC_GROUP.FACADE, SPEC_GROUP.STREETS, SPEC_GROUP.LENGTHS];
  }
  if (VILLA_TYPE_IDS.has(id)) {
    return [SPEC_GROUP.AREA, SPEC_GROUP.ROOMS_BATHROOMS, SPEC_GROUP.FLOORS, SPEC_GROUP.PARKING_AMENITIES];
  }
  if (APARTMENT_TYPE_IDS.has(id)) {
    return [SPEC_GROUP.AREA, SPEC_GROUP.ROOMS_BATHROOMS, SPEC_GROUP.FLOOR_ELEVATOR, SPEC_GROUP.PARKING_AMENITIES];
  }
  if (COMMERCIAL_TYPE_IDS.has(id)) {
    return [SPEC_GROUP.AREA, SPEC_GROUP.FACADE, SPEC_GROUP.USAGE, SPEC_GROUP.SERVICES];
  }
  return [SPEC_GROUP.AREA, SPEC_GROUP.ROOMS_BATHROOMS];
}

export function specGroupLabel(key = "") {
  return SPEC_GROUP_LABELS[key] || text(key);
}

export function specGroupOptions(propertyTypeLabel = "") {
  return specGroupsForPropertyType(propertyTypeLabel).map((value) => ({
    value,
    label: specGroupLabel(value)
  }));
}

function riyadhParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: APPOINTMENT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false
  });
  const parts = fmt.formatToParts(now);
  const pick = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour")
  };
}

function riyadhDateAt({ year, month, day, hour = 0, minute = 0 }) {
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offsetLabel = probe.toLocaleString("en-US", {
    timeZone: APPOINTMENT_TIME_ZONE,
    timeZoneName: "shortOffset"
  });
  const match = offsetLabel.match(/GMT([+-]\d+)/);
  const offsetHours = match ? Number(match[1]) : 3;
  return new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0)).toISOString();
}

export function resolveViewingWindowStart(windowId = "", now = new Date()) {
  const id = text(windowId);
  const { year, month, day } = riyadhParts(now);
  if (id === "today_morning") return riyadhDateAt({ year, month, day, hour: 10 });
  if (id === "today_afternoon") return riyadhDateAt({ year, month, day, hour: 15 });
  if (id === "today_evening") return riyadhDateAt({ year, month, day, hour: 18 });
  if (id === "tomorrow_morning") {
    const d = new Date(Date.UTC(year, month - 1, day + 1));
    return riyadhDateAt({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 10 });
  }
  if (id === "tomorrow_afternoon") {
    const d = new Date(Date.UTC(year, month - 1, day + 1));
    return riyadhDateAt({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 15 });
  }
  if (id === "tomorrow_evening") {
    const d = new Date(Date.UTC(year, month - 1, day + 1));
    return riyadhDateAt({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 18 });
  }
  if (id === "day2_morning") {
    const d = new Date(Date.UTC(year, month - 1, day + 2));
    return riyadhDateAt({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 10 });
  }
  if (id === "day2_afternoon") {
    const d = new Date(Date.UTC(year, month - 1, day + 2));
    return riyadhDateAt({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 15 });
  }
  if (id === "day2_evening") {
    const d = new Date(Date.UTC(year, month - 1, day + 2));
    return riyadhDateAt({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 18 });
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(id)) return id;
  return "";
}

export function viewingWindowOptions(now = new Date()) {
  return VIEWING_WINDOW_IDS.map((id) => {
    const startAt = resolveViewingWindowStart(id, now);
    return { id, startAt, label: id };
  }).filter((row) => row.startAt);
}

export function viewingWindowsFromDaysPeriods(days = [], periods = []) {
  const windows = [];
  for (const day of uniqueList(days)) {
    const periodMap = DAY_PERIOD_TO_WINDOW[day];
    if (!periodMap) continue;
    for (const period of uniqueList(periods)) {
      const windowId = periodMap[period];
      if (windowId) windows.push(windowId);
    }
  }
  return uniqueList(windows);
}

export function dayPeriodLabel(day = "", period = "") {
  const dayLabels = { today: "اليوم", tomorrow: "غدًا", weekend: "نهاية الأسبوع" };
  const periodLabels = { morning: "صباحًا", afternoon: "عصرًا", evening: "مساءً" };
  const d = dayLabels[day] || day;
  const p = periodLabels[period] || period;
  return d && p ? `${d} ${p}` : d || p;
}

function canonicalHasInfoNeed(need = "", offer = {}) {
  const key = text(need);
  if (key === CLIENT_INFO_NEEDS.PRICE || key === "price") {
    return Number(offer.salePrice || offer.price || offer.priceOrBudget || 0) > 0;
  }
  if (key === CLIENT_INFO_NEEDS.LOCATION || key === "location") {
    return Boolean(text(offer.locationUrl || offer.mapUrl));
  }
  if (key === CLIENT_INFO_NEEDS.PHOTOS || key === "photos") {
    return listingMediaPaths(offer).length > 0 || Number(offer.imageCount || 0) > 0;
  }
  if (key === CLIENT_INFO_NEEDS.SPECS || key === CLIENT_INFO_NEEDS.SPECIFICATIONS || key === "specifications") {
    return Number(offer.area || 0) > 0;
  }
  return false;
}

export function canonicalHasSpecGroup(group = "", offer = {}) {
  const key = text(group);
  if (key === SPEC_GROUP.AREA) return Number(offer.area || 0) > 0;
  if (key === SPEC_GROUP.ROOMS_BATHROOMS) {
    return Number(offer.rooms || 0) > 0 || Number(offer.bathrooms || offer.baths || 0) > 0;
  }
  if (key === SPEC_GROUP.FLOOR_ELEVATOR) return Number(offer.floorNumber || offer.floor || 0) > 0;
  if (key === SPEC_GROUP.FLOORS) return Number(offer.floors || offer.floorCount || 0) > 0;
  if (key === SPEC_GROUP.FACADE) return Boolean(text(offer.facing || offer.facade || offer.direction));
  if (key === SPEC_GROUP.STREETS) return Number(offer.streetWidth || 0) > 0;
  if (key === SPEC_GROUP.LENGTHS) return Number(offer.depth || 0) > 0 || Boolean(text(offer.plotNumber));
  if (key === SPEC_GROUP.USAGE) return Boolean(text(offer.usage || offer.description));
  if (key === SPEC_GROUP.PARKING_AMENITIES || key === SPEC_GROUP.SERVICES) {
    return Boolean(text(offer.parking || offer.amenities || offer.description));
  }
  return false;
}

export function ownerMissingSpecGroups(clientBundle = {}, offer = {}, propertyTypeLabel = "") {
  const wantsSpecs = (clientBundle.infoNeeds || []).some((need) =>
    [CLIENT_INFO_NEEDS.SPECS, CLIENT_INFO_NEEDS.SPECIFICATIONS, "specifications", "specs"].includes(text(need))
  );
  const requested = uniqueList(clientBundle.specNeeds || []);
  const groups = requested.length
    ? requested
    : (wantsSpecs ? specGroupsForPropertyType(propertyTypeLabel) : []);
  return groups.filter((group) => !canonicalHasSpecGroup(group, offer));
}

function mapLegacyClientInput(raw = {}) {
  const interestStatus = text(raw.interestStatus || raw.interest);
  const nextAction = text(raw.nextAction);
  const mapped = { ...raw };
  if (!mapped.interestStatus && interestStatus) mapped.interestStatus = interestStatus;
  if (nextAction === CLIENT_NEXT_ACTION.VIEWING) mapped.wantsViewing = true;
  if (nextAction === CLIENT_NEXT_ACTION.MORE_INFO && !mapped.infoNeeds?.length) {
    mapped.infoNeeds = uniqueList(raw.infoNeeds || [CLIENT_INFO_NEEDS.OTHER]);
  }
  if (Array.isArray(raw.viewingWindows) && raw.viewingWindows.length) {
    mapped.viewingDays = raw.viewingDays || [];
    mapped.viewingPeriods = raw.viewingPeriods || [];
    for (const windowId of raw.viewingWindows) {
      if (windowId.startsWith("today")) mapped.viewingDays.push(VIEWING_DAY.TODAY);
      if (windowId.startsWith("tomorrow")) mapped.viewingDays.push(VIEWING_DAY.TOMORROW);
      if (windowId.startsWith("day2")) mapped.viewingDays.push(VIEWING_DAY.WEEKEND);
      if (windowId.includes("morning")) mapped.viewingPeriods.push(VIEWING_PERIOD.MORNING);
      if (windowId.includes("afternoon")) mapped.viewingPeriods.push(VIEWING_PERIOD.AFTERNOON);
      if (windowId.includes("evening")) mapped.viewingPeriods.push(VIEWING_PERIOD.EVENING);
    }
    mapped.viewingDays = uniqueList(mapped.viewingDays);
    mapped.viewingPeriods = uniqueList(mapped.viewingPeriods);
  }
  return mapped;
}

export function normalizeClientBundle(raw = {}) {
  const input = mapLegacyClientInput(raw);
  const interestStatus = text(input.interestStatus);
  const bundle = {
    version: QUESTION_SET_VERSIONS.CLIENT_V1,
    interestStatus,
    infoNeeds: [],
    specNeeds: [],
    wantsViewing: false,
    viewingDays: [],
    viewingPeriods: [],
    viewingWindows: [],
    interestAction: "",
    rejectionReason: "",
    rejectionDisposition: "",
    proposedPrice: null,
    negotiationPreference: "",
    submittedAt: text(input.submittedAt)
  };
  if (interestStatus === CLIENT_INTEREST_STATUS.NOT_SUITABLE
    || interestStatus === CLIENT_INTEREST.NOT_SUITABLE) {
    bundle.rejectionReason = text(input.rejectionReason);
    bundle.rejectionDisposition = text(input.rejectionDisposition);
    bundle.proposedPrice = Number(input.proposedPrice || 0) > 0 ? Number(input.proposedPrice) : null;
    bundle.negotiationPreference = text(input.negotiationPreference);
    if (!Object.values(REJECTION_REASON).includes(bundle.rejectionReason)) return null;
    if (!Object.values(REJECTION_DISPOSITION).includes(bundle.rejectionDisposition)) return null;
    if (bundle.rejectionDisposition === REJECTION_DISPOSITION.NEGOTIABLE) {
      if (bundle.rejectionReason === REJECTION_REASON.PRICE && !bundle.proposedPrice) return null;
      if (bundle.rejectionReason !== REJECTION_REASON.PRICE && !bundle.negotiationPreference) return null;
    }
    return bundle;
  }
  if (interestStatus !== CLIENT_INTEREST_STATUS.INTERESTED
    && interestStatus !== CLIENT_INTEREST_STATUS.PRELIMINARY_OK
    && interestStatus !== CLIENT_INTEREST.INTERESTED) {
    return null;
  }
  bundle.infoNeeds = uniqueList(input.infoNeeds).map((need) => {
    if (need === "specs") return CLIENT_INFO_NEEDS.SPECIFICATIONS;
    return need;
  });
  bundle.specNeeds = uniqueList(input.specNeeds);
  bundle.requestedDetailKeys = uniqueList(input.requestedDetailKeys);
  bundle.interestAction = text(input.interestAction)
    || (input.wantsViewing ? CLIENT_INTEREST_ACTION.VIEWING : CLIENT_INTEREST_ACTION.DETAILS);
  bundle.wantsViewing = bundle.interestAction === CLIENT_INTEREST_ACTION.VIEWING;
  bundle.viewingDays = uniqueList(input.viewingDays);
  bundle.viewingPeriods = uniqueList(input.viewingPeriods);
  bundle.viewingWindows = viewingWindowsFromDaysPeriods(bundle.viewingDays, bundle.viewingPeriods);
  if (bundle.interestAction === CLIENT_INTEREST_ACTION.DETAILS) {
    const detailKeys = detailKeysForPropertyType(input.propertyType || "");
    if (detailKeys.length && !bundle.requestedDetailKeys.length) return null;
    bundle.wantsViewing = false;
    bundle.viewingDays = [];
    bundle.viewingPeriods = [];
    bundle.viewingWindows = [];
    return bundle;
  }
  if (bundle.interestAction === CLIENT_INTEREST_ACTION.VIEWING) {
    if (bundle.wantsViewing && (!bundle.viewingDays.length || !bundle.viewingPeriods.length)) return null;
    return bundle;
  }
  return null;
}

export function normalizeOwnerBundle(raw = {}) {
  const propertyAvailability = text(raw.propertyAvailability);
  const bundle = {
    version: QUESTION_SET_VERSIONS.OWNER_V1,
    propertyAvailability,
    priceConfirmation: "",
    updatedPrice: null,
    locationShare: false,
    mediaPaths: uniqueList(raw.mediaPaths || raw.mediaAdded || []),
    specValues: raw.specValues && typeof raw.specValues === "object" ? { ...raw.specValues } : {},
    detailValues: raw.detailValues && typeof raw.detailValues === "object" ? { ...raw.detailValues } : {},
    detailConfirmations: uniqueList(raw.detailConfirmations || []),
    viewingAllowed: "",
    viewingDays: [],
    viewingPeriods: [],
    viewingWindows: [],
    coordinationRequired: false,
    negotiationDecision: text(raw.negotiationDecision),
    counterPrice: Number(raw.counterPrice || 0) > 0 ? Number(raw.counterPrice) : null,
    counterPreference: text(raw.counterPreference),
    submittedAt: text(raw.submittedAt)
  };
  if (propertyAvailability === OWNER_AVAILABILITY.NOT_AVAILABLE) return bundle;
  if (propertyAvailability !== OWNER_AVAILABILITY.AVAILABLE) return null;
  if (bundle.negotiationDecision
    && !Object.values(NEGOTIATION_DECISION).includes(bundle.negotiationDecision)) return null;
  if (bundle.negotiationDecision === NEGOTIATION_DECISION.COUNTER
    && !bundle.counterPrice && !bundle.counterPreference) return null;
  const priceConfirmation = text(raw.priceConfirmation);
  if (priceConfirmation) {
    bundle.priceConfirmation = priceConfirmation;
    if (priceConfirmation === PRICE_CONFIRMATION.UPDATED) {
      const price = Number(raw.updatedPrice);
      if (!Number.isFinite(price) || price <= 0) return null;
      bundle.updatedPrice = price;
    }
  } else if (Number(raw.updatedPrice) > 0) {
    bundle.priceConfirmation = PRICE_CONFIRMATION.UPDATED;
    bundle.updatedPrice = Number(raw.updatedPrice);
  }
  bundle.locationShare = Boolean(raw.locationShare);
  const viewingAllowed = text(raw.viewingAllowed);
  bundle.viewingAllowed = viewingAllowed;
  if (viewingAllowed === OWNER_VIEWING_ALLOWED.NO) return bundle;
  if (viewingAllowed === OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION) {
    bundle.coordinationRequired = Boolean(raw.coordinationRequired);
    return bundle;
  }
  if (viewingAllowed === OWNER_VIEWING_ALLOWED.YES) {
    bundle.viewingDays = uniqueList(raw.viewingDays);
    bundle.viewingPeriods = uniqueList(raw.viewingPeriods);
    bundle.viewingWindows = viewingWindowsFromDaysPeriods(bundle.viewingDays, bundle.viewingPeriods);
    if (!bundle.viewingDays.length || !bundle.viewingPeriods.length) return null;
    return bundle;
  }
  return null;
}

function windowsOverlap(clientWindows = [], ownerWindows = [], now = new Date()) {
  const clientStarts = clientWindows.map((id) => resolveViewingWindowStart(id, now)).filter(Boolean);
  const ownerStarts = ownerWindows.map((id) => resolveViewingWindowStart(id, now)).filter(Boolean);
  for (const left of clientStarts) {
    for (const right of ownerStarts) {
      if (slotsOverlap(left, right)) return true;
    }
  }
  return false;
}

function infoNeedsSummary(needs = []) {
  const labels = {
    price: "السعر",
    location: "الموقع",
    photos: "الصور",
    specifications: "المواصفات",
    specs: "المواصفات",
    other: "تفاصيل"
  };
  return uniqueList(needs).map((need) => labels[need] || need).join(" و");
}

function viewingSummary(days = [], periods = []) {
  const parts = [];
  for (const day of uniqueList(days)) {
    for (const period of uniqueList(periods)) {
      parts.push(dayPeriodLabel(day, period));
    }
  }
  return parts.join(" · ");
}

export function clientBundleSummary(bundle = {}) {
  if (!bundle || !bundle.interestStatus) return "";
  if (bundle.interestStatus === CLIENT_INTEREST_STATUS.NOT_SUITABLE) {
    if (bundle.rejectionDisposition === REJECTION_DISPOSITION.NEGOTIABLE) {
      return bundle.proposedPrice
        ? `غير مهتم حاليًا — قابل للتفاوض عند ${bundle.proposedPrice} ريال`
        : "غير مهتم حاليًا — قابل للتفاوض";
    }
    return "غير مهتم نهائيًا";
  }
  const statusLabel = "مهتم";
  const bits = [statusLabel];
  if (bundle.infoNeeds?.length) bits.push(`طلب ${infoNeedsSummary(bundle.infoNeeds)}`);
  if (bundle.requestedDetailKeys?.length) {
    bits.push(`طلب تفاصيل: ${bundle.requestedDetailKeys.length}`);
  }
  if (bundle.wantsViewing) {
    const view = viewingSummary(bundle.viewingDays, bundle.viewingPeriods);
    bits.push(view ? `يريد معاينة ${view}` : "يريد معاينة");
  }
  return bits.join(" — ");
}

export function ownerBundleSummary(bundle = {}) {
  if (!bundle || !bundle.propertyAvailability) return "";
  if (bundle.propertyAvailability === OWNER_AVAILABILITY.NOT_AVAILABLE) return "غير متاح";
  const bits = ["العقار متاح"];
  if (bundle.negotiationDecision === NEGOTIATION_DECISION.ACCEPT) bits.push("وافق على شرط العميل");
  if (bundle.negotiationDecision === NEGOTIATION_DECISION.COUNTER) {
    bits.push(bundle.counterPrice ? `اقترح ${bundle.counterPrice} ريال` : "قدم اقتراحًا بديلًا");
  }
  if (bundle.negotiationDecision === NEGOTIATION_DECISION.REJECT) bits.push("رفض التفاوض");
  if (bundle.priceConfirmation === PRICE_CONFIRMATION.UPDATED) bits.push("حدّث السعر");
  if (bundle.priceConfirmation === PRICE_CONFIRMATION.CONFIRMED) bits.push("أكد السعر");
  if (bundle.mediaPaths?.length) bits.push("أضاف صورًا");
  if (bundle.locationShare) bits.push("الموقع متوفر");
  if (bundle.viewingAllowed === OWNER_VIEWING_ALLOWED.YES) {
    const view = viewingSummary(bundle.viewingDays, bundle.viewingPeriods);
    bits.push(view ? `${view} مناسب` : "المعاينة ممكنة");
  } else if (bundle.viewingAllowed === OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION) {
    bits.push("المعاينة تحتاج تنسيق مسبق");
  }
  return bits.join(" — ");
}

export function brokerCoordinationLine(session = {}) {
  const lines = [];
  if (session.clientBundle) lines.push(`العميل: ${clientBundleSummary(session.clientBundle)}`);
  if (session.ownerBundle) lines.push(`المالك: ${ownerBundleSummary(session.ownerBundle)}`);
  if (session.brokerLine) lines.push(session.brokerLine);
  return lines.join(" · ");
}

export function resolveCoordinationOutcome({
  clientBundle = null,
  ownerBundle = null,
  canonicalOffer = {},
  now = new Date()
} = {}) {
  if (!clientBundle && !ownerBundle) {
    return {
      outcome: COORDINATION_OUTCOME.AWAITING_BOTH_PARTIES,
      brokerLine: "بانتظار رد العميل والمالك",
      conflictField: ""
    };
  }
  if (!clientBundle || !ownerBundle) {
    return {
      outcome: COORDINATION_OUTCOME.AWAITING_OTHER_PARTY,
      brokerLine: clientBundle ? "بانتظار رد المالك" : "بانتظار رد العميل",
      conflictField: ""
    };
  }
  if (clientBundle.interestStatus === CLIENT_INTEREST_STATUS.NOT_SUITABLE) {
    if (clientBundle.rejectionDisposition === REJECTION_DISPOSITION.NEGOTIABLE) {
      if (!ownerBundle.negotiationDecision) {
        return { outcome: COORDINATION_OUTCOME.NEGOTIATION_PENDING_OWNER, brokerLine: "جلسة تفاوض — بانتظار رد المالك على شرط العميل", conflictField: "negotiationDecision" };
      }
      if (ownerBundle.negotiationDecision === NEGOTIATION_DECISION.ACCEPT) {
        return { outcome: COORDINATION_OUTCOME.NEGOTIATION_ACCEPTED, brokerLine: "جلسة تفاوض — المالك وافق على شرط العميل ويلزم تأكيد العميل", conflictField: "" };
      }
      if (ownerBundle.negotiationDecision === NEGOTIATION_DECISION.COUNTER) {
        return { outcome: COORDINATION_OUTCOME.NEGOTIATION_COUNTERED, brokerLine: "جلسة تفاوض — المالك قدم اقتراحًا بديلًا ويلزم رد العميل", conflictField: "" };
      }
      return { outcome: COORDINATION_OUTCOME.NEGOTIATION_REJECTED, brokerLine: "جلسة تفاوض — المالك رفض شرط التفاوض", conflictField: "" };
    }
    return {
      outcome: COORDINATION_OUTCOME.CLIENT_NOT_INTERESTED,
      brokerLine: "العميل غير مهتم",
      conflictField: ""
    };
  }
  if (ownerBundle.propertyAvailability === OWNER_AVAILABILITY.NOT_AVAILABLE) {
    return {
      outcome: COORDINATION_OUTCOME.PROPERTY_NOT_AVAILABLE,
      brokerLine: "العقار غير متاح",
      conflictField: ""
    };
  }
  const unresolvedInfo = (clientBundle.infoNeeds || []).filter((need) =>
    !canonicalHasInfoNeed(need, canonicalOffer)
  );
  const missingDetails = ownerMissingDetailKeys(clientBundle, canonicalOffer, canonicalOffer.propertyType);
  if ((missingDetails.length || unresolvedInfo.length) && !clientBundle.wantsViewing) {
    return {
      outcome: COORDINATION_OUTCOME.CLIENT_NEEDS_INFO,
      brokerLine: "العميل يحتاج معلومات إضافية",
      conflictField: missingDetails.length ? "requestedDetailKeys" : "infoNeeds"
    };
  }
  if (clientBundle.wantsViewing) {
    if (ownerBundle.viewingAllowed === OWNER_VIEWING_ALLOWED.NO) {
      return {
        outcome: COORDINATION_OUTCOME.OWNER_VIEWING_BLOCKED,
        brokerLine: "المالك لا يقبل معاينة",
        conflictField: "viewingAllowed"
      };
    }
    if (ownerBundle.viewingAllowed === OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION) {
      return {
        outcome: COORDINATION_OUTCOME.NEEDS_BROKER,
        brokerLine: "المعاينة تحتاج تنسيق مسبق مع المالك",
        conflictField: "coordinationRequired"
      };
    }
    if (ownerBundle.viewingAllowed === OWNER_VIEWING_ALLOWED.YES) {
      const clientWindows = clientBundle.viewingWindows
        || viewingWindowsFromDaysPeriods(clientBundle.viewingDays, clientBundle.viewingPeriods);
      const ownerWindows = ownerBundle.viewingWindows
        || viewingWindowsFromDaysPeriods(ownerBundle.viewingDays, ownerBundle.viewingPeriods);
      if (windowsOverlap(clientWindows, ownerWindows, now)) {
        return {
          outcome: COORDINATION_OUTCOME.VIEWING_READY,
          brokerLine: "جاهز لتنسيق المعاينة",
          conflictField: ""
        };
      }
      return {
        outcome: COORDINATION_OUTCOME.SCHEDULE_CONFLICT,
        brokerLine: "تعارض في مواعيد المعاينة",
        conflictField: "viewingWindows"
      };
    }
  }
  if (unresolvedInfo.length) {
    return {
      outcome: COORDINATION_OUTCOME.CLIENT_NEEDS_INFO,
      brokerLine: "العميل يحتاج معلومات إضافية",
      conflictField: "infoNeeds"
    };
  }
  return {
    outcome: COORDINATION_OUTCOME.AWAITING_OTHER_PARTY,
    brokerLine: "بانتظار رد أحد الأطراف",
    conflictField: ""
  };
}

export function resolveOwnerContactNeeded(session = {}, outcome = "") {
  const client = session?.clientBundle;
  if (client?.interestStatus === CLIENT_INTEREST_STATUS.INTERESTED
    && (client.requestedDetailKeys?.length || client.specNeeds?.length)
    && !session?.ownerBundle) {
    return true;
  }
  const living = livingStageForCoordinationOutcome(outcome || session?.outcome, session);
  return Boolean(living.ownerContactNeeded);
}

export function livingStageForCoordinationOutcome(outcome = "", session = {}) {
  const key = text(outcome);
  const clientBundle = session?.clientBundle || null;
  const ownerBundle = session?.ownerBundle || null;
  if (key === COORDINATION_OUTCOME.CLIENT_NOT_INTERESTED) {
    return { stage: LIVING_TASK_STAGE.CLIENT_REJECTED, ownerContactNeeded: false };
  }
  if (key === COORDINATION_OUTCOME.NEGOTIATION_PENDING_OWNER) {
    return { stage: LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION, ownerContactNeeded: true };
  }
  if (key === COORDINATION_OUTCOME.NEGOTIATION_ACCEPTED
    || key === COORDINATION_OUTCOME.NEGOTIATION_COUNTERED) {
    return { stage: LIVING_TASK_STAGE.MATCH_FOUND, ownerContactNeeded: false };
  }
  if (key === COORDINATION_OUTCOME.NEGOTIATION_REJECTED) {
    return { stage: LIVING_TASK_STAGE.CLIENT_REJECTED, ownerContactNeeded: false };
  }
  if (key === COORDINATION_OUTCOME.PROPERTY_NOT_AVAILABLE) {
    return { stage: LIVING_TASK_STAGE.PROPERTY_UNAVAILABLE, ownerContactNeeded: false };
  }
  if (key === COORDINATION_OUTCOME.CLIENT_NEEDS_INFO) {
    return { stage: LIVING_TASK_STAGE.CLIENT_NEEDS_DETAILS, ownerContactNeeded: false };
  }
  if (key === COORDINATION_OUTCOME.VIEWING_READY) {
    return { stage: LIVING_TASK_STAGE.APPOINTMENT_COORDINATION, ownerContactNeeded: false };
  }
  if (key === COORDINATION_OUTCOME.SCHEDULE_CONFLICT) {
    return { stage: LIVING_TASK_STAGE.APPOINTMENT_COORDINATION, ownerContactNeeded: false };
  }
  if (key === COORDINATION_OUTCOME.NEEDS_BROKER
    || key === COORDINATION_OUTCOME.OWNER_VIEWING_BLOCKED) {
    return { stage: LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION, ownerContactNeeded: true };
  }
  if (key === COORDINATION_OUTCOME.AWAITING_BOTH_PARTIES) {
    return { stage: LIVING_TASK_STAGE.MATCH_FOUND, ownerContactNeeded: false };
  }
  if (key === COORDINATION_OUTCOME.AWAITING_OTHER_PARTY) {
    return {
      stage: LIVING_TASK_STAGE.MATCH_FOUND,
      ownerContactNeeded: Boolean(clientBundle && !ownerBundle)
    };
  }
  return { stage: LIVING_TASK_STAGE.MATCH_FOUND, ownerContactNeeded: false };
}

/** Derive ownerContactNeeded from coordination outcome and bundle/summary stamps. */
export function ownerContactNeededForCoordination({
  outcome = "",
  clientBundle = null,
  ownerBundle = null,
  clientSummary = "",
  ownerSummary = ""
} = {}) {
  const hasClient = Boolean(clientBundle) || Boolean(text(clientSummary));
  const hasOwner = Boolean(ownerBundle) || Boolean(text(ownerSummary));
  if (hasClient && !hasOwner) return true;
  if (!hasClient && hasOwner) return false;
  return livingStageForCoordinationOutcome(outcome, { clientBundle, ownerBundle }).ownerContactNeeded;
}

export function coordinationOutcomeLabel(outcome = "") {
  const map = {
    [COORDINATION_OUTCOME.AWAITING_BOTH_PARTIES]: "بانتظار رد الأطراف",
    [COORDINATION_OUTCOME.AWAITING_OTHER_PARTY]: "بانتظار رد أحد الأطراف",
    [COORDINATION_OUTCOME.CLIENT_NOT_INTERESTED]: "العميل غير مهتم",
    [COORDINATION_OUTCOME.PROPERTY_NOT_AVAILABLE]: "العقار غير متاح",
    [COORDINATION_OUTCOME.CLIENT_NEEDS_INFO]: "العميل يحتاج معلومات",
    [COORDINATION_OUTCOME.VIEWING_READY]: "جاهز لتنسيق المعاينة",
    [COORDINATION_OUTCOME.SCHEDULE_CONFLICT]: "تعارض في الموعد",
    [COORDINATION_OUTCOME.NEEDS_BROKER]: "يحتاج تدخل الوسيط",
    [COORDINATION_OUTCOME.OWNER_VIEWING_BLOCKED]: "المعاينة غير متاحة من المالك"
  };
  return map[outcome] || "";
}

export function buildDecisionPackageView(party = "client", {
  propertyType = "",
  canonicalOffer = {},
  clientBundle = null,
  submitted = false,
  bundleSummary = "",
  canonicalPrice = 0,
  hasLocation = false,
  now = new Date()
} = {}) {
  const side = party === "owner" ? "owner" : "client";
  const specOptions = specGroupOptions(propertyType);
  const detailOptions = detailKeyOptions(propertyType);
  const missingSpecs = side === "owner"
    ? ownerMissingSpecGroups(clientBundle || {}, canonicalOffer, propertyType)
    : [];
  const missingDetails = side === "owner"
    ? ownerMissingDetailKeys(clientBundle || {}, canonicalOffer, propertyType)
    : [];
  const ownerRequestedKeys = side === "owner" && clientBundle
    ? uniqueList(clientBundle.requestedDetailKeys || [])
    : [];
  const ownerDetailFields = ownerRequestedKeys.map((key) => ({
    key,
    label: detailKeyLabel(key),
    currentValue: detailKeyCanonicalValue(key, canonicalOffer),
    hasValue: canonicalHasDetailKey(key, canonicalOffer)
  }));
  return {
    mode: "decision_package_v1",
    party: side,
    questionSetVersion: side === "owner" ? QUESTION_SET_VERSIONS.OWNER_V1 : QUESTION_SET_VERSIONS.CLIENT_V1,
    submitted: Boolean(submitted),
    bundleSummary: text(bundleSummary),
    propertyType,
    specOptions,
    detailOptions,
    missingSpecs,
    missingSpecsLabels: missingSpecs.map(specGroupLabel),
    missingDetails,
    missingDetailLabels: missingDetails.map((key) => detailKeyLabel(key)),
    ownerDetailFields,
    negotiationRequest: side === "owner" && clientBundle?.rejectionDisposition === REJECTION_DISPOSITION.NEGOTIABLE
      ? {
        reason: clientBundle.rejectionReason,
        proposedPrice: clientBundle.proposedPrice,
        preference: clientBundle.negotiationPreference
      }
      : null,
    canonicalPrice: Number(canonicalPrice || canonicalOffer.salePrice || canonicalOffer.price || 0),
    hasCanonicalPrice: Number(canonicalPrice || canonicalOffer.salePrice || canonicalOffer.price || 0) > 0,
    hasLocation: Boolean(hasLocation || canonicalOffer.locationUrl || canonicalOffer.mapUrl),
    infoNeedOptions: [
      { value: CLIENT_INFO_NEEDS.PRICE, label: "السعر" },
      { value: CLIENT_INFO_NEEDS.LOCATION, label: "الموقع" },
      { value: CLIENT_INFO_NEEDS.PHOTOS, label: "الصور" },
      { value: CLIENT_INFO_NEEDS.SPECIFICATIONS, label: "المواصفات" }
    ],
    dayOptions: [
      { value: VIEWING_DAY.TODAY, label: "اليوم" },
      { value: VIEWING_DAY.TOMORROW, label: "غدًا" },
      { value: VIEWING_DAY.WEEKEND, label: "نهاية الأسبوع" }
    ],
    periodOptions: [
      { value: VIEWING_PERIOD.MORNING, label: "صباحًا" },
      { value: VIEWING_PERIOD.AFTERNOON, label: "عصرًا" },
      { value: VIEWING_PERIOD.EVENING, label: "مساءً" }
    ],
    now: now.toISOString()
  };
}

/** @deprecated use buildDecisionPackageView */
export function buildCoordinationFormView(party = "client", options = {}) {
  return buildDecisionPackageView(party, options);
}

export function bundleFromLegacyReply(party = "client", replyAction = "", followUpAction = "") {
  const primary = text(replyAction);
  const follow = text(followUpAction);
  const now = new Date().toISOString();
  if (party === "owner") {
    if (primary === "property_available") {
      return normalizeOwnerBundle({
        propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
        viewingAllowed: OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION,
        coordinationRequired: true,
        submittedAt: now
      });
    }
    if (primary === "not_available") {
      return normalizeOwnerBundle({ propertyAvailability: OWNER_AVAILABILITY.NOT_AVAILABLE, submittedAt: now });
    }
    return null;
  }
  if (primary === "not_suitable") {
    return normalizeClientBundle({
      interestStatus: CLIENT_INTEREST_STATUS.NOT_SUITABLE,
      rejectionReason: REJECTION_REASON.OTHER,
      rejectionDisposition: REJECTION_DISPOSITION.FINAL,
      submittedAt: now
    });
  }
  if (primary === "needs_details") {
    return normalizeClientBundle({
      interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
      infoNeeds: [CLIENT_INFO_NEEDS.OTHER],
      submittedAt: now
    });
  }
  if (primary === "interested") {
    if (follow === "want_viewing") {
      return normalizeClientBundle({
        interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
        wantsViewing: true,
        viewingDays: [VIEWING_DAY.TOMORROW],
        viewingPeriods: [VIEWING_PERIOD.EVENING],
        submittedAt: now
      });
    }
    return normalizeClientBundle({
      interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
      submittedAt: now
    });
  }
  return null;
}

export function validateBundleForParty(party = "client", raw = {}) {
  return party === "owner" ? normalizeOwnerBundle(raw) : normalizeClientBundle(raw);
}

export function bundlesEqual(left = {}, right = {}) {
  const a = JSON.stringify({ ...left, submittedAt: "" });
  const b = JSON.stringify({ ...right, submittedAt: "" });
  return a === b;
}
