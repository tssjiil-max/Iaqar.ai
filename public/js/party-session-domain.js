/**
 * Party-link sessions. Opaque tokens only — never treat URL JSON as authority.
 */

import {
  buildDecisionPackageView,
  clientBundleSummary,
  ownerBundleSummary
} from "./coordination-bundle-domain.js";
import { buildPartyLocationView } from "./approximate-location-domain.js";
import { VIEWING_APPOINTMENT_STATUS } from "./broker-viewing-schedule-domain.js";

export const PARTY_LINK_QUERY = "cv2Party";

export const PARTY_SESSION_STATUS = Object.freeze({
  ACTIVE: "active",
  REPLIED: "replied",
  REVOKED: "revoked"
});

export const PARTY_INVALID_COPY = "هذا الرابط غير صالح أو لم يعد متاحًا.";
export const PARTY_REPLY_RECORDED = "تم تسجيل ردك";

export const CLIENT_PARTY_ACTIONS = Object.freeze([
  Object.freeze({ id: "interested", label: "مهتم" }),
  Object.freeze({ id: "needs_details", label: "أحتاج تفاصيل أكثر" }),
  Object.freeze({ id: "not_suitable", label: "غير مناسب" })
]);

export const CLIENT_DETAIL_ACTIONS = Object.freeze([
  Object.freeze({ id: "detail_price", label: "السعر" }),
  Object.freeze({ id: "detail_location", label: "الموقع" }),
  Object.freeze({ id: "detail_photos", label: "الصور" }),
  Object.freeze({ id: "detail_specs", label: "المواصفات" }),
  Object.freeze({ id: "detail_other", label: "سؤال آخر" })
]);

export const CLIENT_INTERESTED_FOLLOWUP_ACTIONS = Object.freeze([
  Object.freeze({ id: "want_viewing", label: "أريد معاينة" }),
  Object.freeze({ id: "info_sufficient", label: "المعلومات والصور كافية" })
]);

export const OWNER_PARTY_ACTIONS = Object.freeze([
  Object.freeze({ id: "property_available", label: "العقار متاح" }),
  Object.freeze({ id: "confirm_appointment", label: "تأكيد الموعد" }),
  Object.freeze({ id: "not_available", label: "غير متاح حالياً" })
]);

export const OWNER_CLIENT_STATUS_LINE = "يوجد عميل مهتم بعقارك";

const SECRET_KEYS = Object.freeze([
  "phone", "contactPhone", "advertiserPhone", "advertiserPhoneNormalized",
  "ownerPhone", "clientPhone", "buyerPhone", "whatsapp", "email", "ownerEmail",
  "clientEmail", "ownerName", "clientName", "contactName", "advertiserDisplayName",
  "score", "matchScore", "opportunityScore", "closingReadinessScore",
  "matchId", "offerId", "requestId", "opportunityId", "sessionId",
  "token", "tokenHash", "officeId", "recipientRef", "brokerNote", "lastNote"
]);

const GENERIC_DISPLAY = /^(العقار|غير محدد|غير متوفر|property|n\/?a|unknown|-)$/i;

export function readPartyTokenFromSearch(search = "") {
  try {
    return String(new URLSearchParams(search).get(PARTY_LINK_QUERY) || "").trim();
  } catch {
    return "";
  }
}

export function isOpaquePartyToken(token) {
  return /^[a-f0-9]{32,128}$/i.test(String(token || "").trim());
}

export function createOpaquePartyToken(randomBytes = defaultRandomBytes) {
  const bytes = randomBytes(32);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function defaultRandomBytes(size) {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return bytes;
  }
  throw new Error("random_unavailable");
}

export function partyActionsForRole(party, { livingStage = "" } = {}) {
  if (party !== "owner") return CLIENT_PARTY_ACTIONS;
  const stage = String(livingStage || "").toUpperCase();
  if (
    stage === "APPOINTMENT_COORDINATION"
    || stage === "VIEWING_DECISION"
    || stage === "APPOINTMENT_CONFIRMED"
  ) {
    return OWNER_PARTY_ACTIONS;
  }
  return OWNER_PARTY_ACTIONS.filter((item) => item.id !== "confirm_appointment");
}

export function allPartyActionCatalog(party) {
  if (party === "owner") return OWNER_PARTY_ACTIONS;
  return [
    ...CLIENT_PARTY_ACTIONS,
    ...CLIENT_DETAIL_ACTIONS,
    ...CLIENT_INTERESTED_FOLLOWUP_ACTIONS
  ];
}

export function partyActionLabel(party, actionId) {
  const hit = allPartyActionCatalog(party).find((item) => item.id === actionId);
  return hit?.label || "";
}

export function isPrimaryPartyAction(party, actionId) {
  const catalog = party === "owner" ? OWNER_PARTY_ACTIONS : CLIENT_PARTY_ACTIONS;
  return catalog.some((item) => item.id === actionId);
}

export function isFollowUpPartyAction(party, actionId, replyAction = "") {
  if (party === "owner") return false;
  if (replyAction === "needs_details") {
    return CLIENT_DETAIL_ACTIONS.some((item) => item.id === actionId);
  }
  if (replyAction === "interested") {
    return CLIENT_INTERESTED_FOLLOWUP_ACTIONS.some((item) => item.id === actionId);
  }
  return false;
}

export function isAllowedPartyAction(party, actionId, replyAction = "") {
  return isPrimaryPartyAction(party, actionId)
    || isFollowUpPartyAction(party, actionId, replyAction);
}

export function partyFollowUpActions(party, replyAction = "", followUpAction = "") {
  if (party !== "client" || followUpAction) return [];
  if (replyAction === "needs_details") return CLIENT_DETAIL_ACTIONS.map((item) => ({ ...item }));
  if (replyAction === "interested") {
    return CLIENT_INTERESTED_FOLLOWUP_ACTIONS.map((item) => ({ ...item }));
  }
  return [];
}

export function partyViewTitle(party) {
  return party === "owner" ? "عميل مهتم بعقارك" : "عقار مناسب لطلبك";
}

export function buildPartyReviewUrl({ origin = "", pathname = "/", token = "" } = {}) {
  const opaque = String(token || "").trim();
  if (!isOpaquePartyToken(opaque)) return "";
  const base = String(origin || "").replace(/\/$/, "");
  const path = pathname && String(pathname).startsWith("/") ? pathname : `/${pathname || ""}`;
  const params = new URLSearchParams();
  params.set(PARTY_LINK_QUERY, opaque);
  return `${base}${path}?${params.toString()}`;
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function isGenericPartyValue(value) {
  const raw = text(value);
  if (!raw) return true;
  return GENERIC_DISPLAY.test(raw);
}

function displayText(value, max = 120) {
  const raw = stripSecretFragments(text(value)).slice(0, max);
  return isGenericPartyValue(raw) ? "" : raw;
}

function stripSecretFragments(value) {
  return text(value)
    .replace(/(\+?966|0)5\d{8}/g, "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function purposeWord(record = {}) {
  const purpose = text(record.purpose || record.transactionType || record.purposeLabel).toUpperCase();
  if (purpose === "RENT" || purpose === "LEASE_REQUEST" || purpose === "للإيجار") return "للإيجار";
  if (purpose === "SALE" || purpose === "PURCHASE" || purpose === "للبيع") return "للبيع";
  if (purpose === "INVESTMENT" || purpose === "للاستثمار") return "للاستثمار";
  return "";
}

export function isPartyOfferListing(record = {}) {
  const kind = text(record.opportunityKind || record.kind || record.recordType).toUpperCase();
  const contact = text(record.contactType).toLowerCase();
  if (kind === "REQUEST" || kind === "CLIENT" || kind === "CLIENT_REQUEST") return false;
  if (contact === "client") return false;
  if (kind === "OFFER" || kind === "OWNER" || kind === "OWNER_OFFER") return true;
  if (contact === "owner") return true;
  if (Number(record.salePrice || record.price || 0) > 0) return true;
  return kind === "" && Number(record.budget || 0) <= 0;
}

export function linkedOfferIdsFromMatch(match = {}, session = {}) {
  const ids = [];
  const push = (value) => {
    const id = text(value);
    if (id && !ids.includes(id)) ids.push(id);
  };
  const source = text(match.sourceCollection).toLowerCase();
  const counterpart = text(match.counterpartCollection).toLowerCase();
  push(session.offerId);
  push(session.ownerOfferId);
  push(match.ownerOfferId);
  push(match.offerId);
  if (source === "owners") {
    push(match.opportunityId);
    push(match.sourceRecordId);
    push(match.counterpartOpportunityId);
  } else if (source === "clients" || counterpart === "owners") {
    push(match.counterpartOpportunityId);
    push(match.counterpartRecordId);
    push(match.ownerOfferId);
  } else {
    push(match.counterpartOpportunityId);
    push(match.opportunityId);
    push(match.sourceRecordId);
    push(match.counterpartRecordId);
  }
  push(session.opportunityId);
  return ids;
}

export function partyPropertyHeadline(record = {}) {
  const propertyType = displayText(record.propertyType, 80);
  const purpose = purposeWord(record);
  return [propertyType, purpose].filter(Boolean).join(" ");
}

export function partyPriceLabel(record = {}) {
  if (!isPartyOfferListing(record) && record.salePrice == null && record.price == null && record.annualRent == null) {
    return "";
  }
  const sale = Number(record.salePrice ?? record.price ?? 0);
  const rent = Number(record.annualRent ?? 0);
  const format = (value) => `${value.toLocaleString("en-US")} ر.س`;
  if (rent > 0 && purposeWord(record) === "للإيجار") return `${format(rent)} سنويًا`;
  if (sale > 0) return format(sale);
  if (rent > 0) return `${format(rent)} سنويًا`;
  const labeled = displayText(record.priceLabel || record.moneyLine, 80);
  if (labeled && !isGenericPartyValue(labeled)) return labeled;
  return "";
}

export function partyLocationLabel(record = {}) {
  const city = displayText(record.city, 80);
  const district = displayText(record.district, 80).replace(/^حي\s+/, "");
  const districtLabel = district ? `حي ${district}` : "";
  return [city, districtLabel].filter(Boolean).join(" - ");
}

export function partyAreaLabel(record = {}) {
  const area = Number(record.area || 0);
  if (area > 0) return `${area.toLocaleString("en-US")} م²`;
  return displayText(record.areaLabel, 40);
}

export function partySpecsLabel(record = {}) {
  const rooms = Number(record.rooms || 0);
  const baths = Number(record.baths || record.bathrooms || 0);
  const bits = [];
  if (rooms > 0) bits.push(`${rooms} غرف`);
  if (baths > 0) bits.push(`${baths} دورات مياه`);
  const extra = displayText(record.specs, 80);
  if (extra && !bits.includes(extra)) bits.push(extra);
  return bits.join(" · ");
}

function numberLabel(value, suffix) {
  const amount = Number(value || 0);
  if (!(amount > 0)) return "";
  return `${amount.toLocaleString("en-US")}${suffix}`;
}

export function safePartyLocationUrl(value) {
  const url = text(value);
  if (!/^https:\/\//i.test(url)) return "";
  if (url.length > 500) return "";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const allowed = host === "maps.app.goo.gl"
      || host.endsWith("google.com")
      || host.endsWith("goo.gl")
      || host.endsWith("google.ae")
      || host.endsWith("google.com.sa");
    return allowed ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function listingMediaPaths(record = {}, limit = 6) {
  const raw = []
    .concat(record.mediaPaths || [])
    .concat(record.photoPaths || [])
    .concat(record.sourceMediaPath ? [record.sourceMediaPath] : []);
  const paths = [];
  for (const value of raw) {
    const path = text(value);
    if (!path || /^https?:\/\//i.test(path)) continue;
    if (paths.includes(path)) continue;
    paths.push(path);
    if (paths.length >= limit) break;
  }
  return paths;
}

export function publicPhotoUrls(record = {}, limit = 6) {
  const raw = []
    .concat(record.photos || [])
    .concat(record.imageUrls || [])
    .concat(record.mediaUrls || []);
  const urls = [];
  for (const value of raw) {
    const url = text(value);
    if (!/^https:\/\//i.test(url)) continue;
    if (urls.includes(url)) continue;
    urls.push(url);
    if (urls.length >= limit) break;
  }
  return urls;
}

export function buildPartySnapshot(record = {}) {
  const propertyType = displayText(record.propertyType, 80);
  const purposeLabel = purposeWord(record);
  const city = displayText(record.city, 80);
  const district = displayText(record.district, 80).replace(/^حي\s+/, "");
  const mediaPaths = listingMediaPaths(record);
  return {
    propertyType,
    purpose: text(record.purpose || record.transactionType),
    purposeLabel,
    typePurpose: partyPropertyHeadline(record),
    city,
    district,
    priceLabel: partyPriceLabel(record),
    locationLabel: partyLocationLabel(record),
    areaLabel: partyAreaLabel(record),
    specs: partySpecsLabel(record),
    streetDirection: displayText(record.streetDirection, 40),
    streetWidthLabel: numberLabel(record.streetWidth, " م"),
    facade: displayText(record.facing || record.direction || record.facade, 40),
    depthLabel: numberLabel(record.depth, " م"),
    plotNumber: displayText(record.plotNumber, 40),
    description: displayText(record.description || record.details, 600),
    locationUrl: safePartyLocationUrl(record.locationUrl || record.mapUrl),
    photos: publicPhotoUrls(record),
    mediaPaths,
    photoCount: mediaPaths.length
  };
}

function propertyFromSnapshot(snapshot = {}, {
  exactLocationAllowed = false,
  canonicalOffer = {}
} = {}) {
  const built = buildPartySnapshot(snapshot);
  const propertyType = displayText(snapshot.propertyType, 80) || built.propertyType;
  const purposeLabel = purposeWord(snapshot) || built.purposeLabel;
  const typePurpose = displayText(snapshot.typePurpose, 80) || [propertyType, purposeLabel].filter(Boolean).join(" ");
  const locationSource = { ...canonicalOffer, ...snapshot };
  const locationView = buildPartyLocationView(locationSource, { exactAllowed: exactLocationAllowed });
  return {
    photos: publicPhotoUrls(snapshot),
    photoCount: Number(snapshot.photoCount || listingMediaPaths(snapshot).length || 0),
    propertyType,
    purposeLabel,
    typePurpose,
    city: displayText(snapshot.city, 80) || built.city,
    district: displayText(snapshot.district, 80).replace(/^حي\s+/, "") || built.district,
    priceLabel: displayText(snapshot.priceLabel, 80) || built.priceLabel,
    locationLabel: displayText(snapshot.locationLabel, 80) || built.locationLabel,
    areaLabel: displayText(snapshot.areaLabel, 40) || built.areaLabel,
    specs: displayText(snapshot.specs, 80) || built.specs,
    streetDirection: displayText(snapshot.streetDirection, 40) || built.streetDirection,
    streetWidthLabel: displayText(snapshot.streetWidthLabel, 40) || built.streetWidthLabel,
    facade: displayText(snapshot.facade, 40) || built.facade,
    depthLabel: displayText(snapshot.depthLabel, 40) || built.depthLabel,
    plotNumber: displayText(snapshot.plotNumber, 40) || built.plotNumber,
    description: displayText(snapshot.description, 600) || built.description,
    locationUrl: exactLocationAllowed ? (safePartyLocationUrl(snapshot.locationUrl) || built.locationUrl) : "",
    locationView
  };
}

export function buildShareSnapshot({
  shareId = "",
  matchId = "",
  partyRole = "client",
  opportunityId = "",
  createdAt = "",
  snapshotVersion = 1,
  record = {}
} = {}) {
  return {
    shareId: text(shareId),
    matchId: text(matchId),
    partyRole: partyRole === "owner" ? "owner" : "client",
    opportunityId: text(opportunityId),
    createdAt: text(createdAt) || new Date().toISOString(),
    snapshotVersion: Number(snapshotVersion) || 1,
    permitted: buildPartySnapshot(record)
  };
}

export function revealedDetailFromSnapshot(snapshot = {}, actionId = "") {
  const id = text(actionId);
  if (id === "detail_price" && text(snapshot.priceLabel)) {
    return { label: "السعر", value: text(snapshot.priceLabel) };
  }
  if (id === "detail_location") {
    if (snapshot.locationUrl) {
      return { label: "الموقع", value: "الموقع متاح عبر الزر أدناه", locationUrl: snapshot.locationUrl };
    }
    if (text(snapshot.locationLabel)) {
      return { label: "الموقع", value: text(snapshot.locationLabel) };
    }
  }
  if (id === "detail_photos") {
    const count = Number(snapshot.photoCount || (snapshot.photos || []).length || 0);
    if (count > 0 || (snapshot.photos || []).length) {
      return { label: "الصور", value: "الصور ظاهرة أعلى الصفحة" };
    }
  }
  if (id === "detail_specs") {
    const bits = [snapshot.areaLabel, snapshot.specs, snapshot.streetWidthLabel, snapshot.facade, snapshot.plotNumber]
      .map((value) => text(value))
      .filter(Boolean);
    if (bits.length) return { label: "المواصفات", value: bits.join(" · ") };
  }
  return null;
}

function publicAppointmentView(appointment = null) {
  if (!appointment || typeof appointment !== "object") return { phase: "none" };
  const phase = text(appointment.phase) || "none";
  const selected = appointment.selected && typeof appointment.selected === "object"
    ? {
      dayLabel: text(appointment.selected.dayLabel),
      dateLabel: text(appointment.selected.dateLabel),
      timeLabel: text(appointment.selected.timeLabel)
    }
    : null;
  const slots = Array.isArray(appointment.slots)
    ? appointment.slots.map((slot) => ({
      id: text(slot.id || slot.startAt),
      buttonLabel: text(slot.buttonLabel),
      dayLabel: text(slot.dayLabel),
      dateLabel: text(slot.dateLabel),
      timeLabel: text(slot.timeLabel)
    })).filter((slot) => slot.id && slot.buttonLabel)
    : [];
  return {
    phase,
    slots,
    selected,
    takenMessage: text(appointment.takenMessage),
    confirmedCopy: text(appointment.confirmedCopy)
  };
}

export function sanitizePartyPublicView({
  party = "client",
  status = PARTY_SESSION_STATUS.ACTIVE,
  snapshot = {},
  officeName = "",
  officeLogoUrl = "",
  officeProfileUrl = "",
  replyAction = "",
  followUpAction = "",
  revealedDetail = null,
  livingStage = "",
  appointment = null,
  coordination = null,
  canonicalOffer = {},
  matchRecord = {}
} = {}) {
  const side = party === "owner" ? "owner" : "client";
  const appointmentStatus = text(matchRecord.appointmentStatus || "");
  const exactLocationAllowed = appointmentStatus === VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER
    || text(livingStage) === "APPOINTMENT_CONFIRMED";
  const coordinationSession = coordination && typeof coordination === "object" ? coordination : null;
  const bundleSummary = side === "owner"
    ? ownerBundleSummary(coordinationSession?.ownerBundle)
    : clientBundleSummary(coordinationSession?.clientBundle);
  const useBundleMode = Boolean(coordinationSession?.id || coordinationSession?.matchId);
  const propertyType = snapshot.propertyType || canonicalOffer.propertyType || "";
  const decisionPackage = useBundleMode
    ? buildDecisionPackageView(side, {
      propertyType,
      canonicalOffer,
      clientBundle: coordinationSession?.clientBundle || null,
      ownerBundle: coordinationSession?.ownerBundle || null,
      submitted: false,
      bundleSummary,
      hasLocation: Boolean(snapshot.locationUrl || canonicalOffer.locationUrl)
    })
    : null;
  const hasSideBundle = side === "owner"
    ? Boolean(coordinationSession?.ownerBundle)
    : Boolean(coordinationSession?.clientBundle);
  const bundleSubmitted = hasSideBundle && !decisionPackage?.requiresResponse;
  if (decisionPackage) decisionPackage.submitted = bundleSubmitted;
  const followUpLabel = followUpAction ? partyActionLabel(side, followUpAction) : "";
  const revealed = revealedDetail && text(revealedDetail.value)
    ? { label: text(revealedDetail.label), value: text(revealedDetail.value) }
    : null;
  const publicAppointment = publicAppointmentView(appointment);
  const appointmentActive = publicAppointment.phase && publicAppointment.phase !== "none";
  const bundleModeActive = useBundleMode && !bundleSubmitted && !appointmentActive;
  const replied = bundleSubmitted
    || (status === PARTY_SESSION_STATUS.REPLIED && Boolean(replyAction));
  const officeLabel = text(officeName) || "المكتب العقاري";
  const officeCoordinationLabel = officeLabel === "المكتب العقاري" || /^مكتب\s/.test(officeLabel)
    ? officeLabel
    : `مكتب ${officeLabel}`;
  const view = {
    party: side,
    title: partyViewTitle(side),
    promptLine: bundleModeActive
      ? (side === "client" ? "أجب على الأسئلة التالية" : "أكد توفر العقار والتفاصيل المطلوبة")
      : (side === "client" && !replied ? "ما رأيك بالعقار؟" : (side === "owner" && !replied ? "هل العقار ما زال متاحًا؟" : "")),
    officeName: officeLabel,
    officeLogoUrl: /^https:\/\//i.test(officeLogoUrl) ? officeLogoUrl : "",
    officeProfileUrl: /^https:\/\//i.test(officeProfileUrl) ? officeProfileUrl : "",
    officeCoordinationNotice: `يتم هذا التنسيق عبر ${officeCoordinationLabel}، دون مشاركة بيانات التواصل بين الطرفين.`,
    privacyNotice: "لن تتم مشاركة بيانات التواصل الخاصة بك مع الطرف الآخر عبر هذه الصفحة.",
    ownerClientStatus: side === "owner" ? OWNER_CLIENT_STATUS_LINE : "",
    property: propertyFromSnapshot(snapshot, { exactLocationAllowed, canonicalOffer }),
    actions: (replied || appointmentActive || bundleModeActive) ? [] : partyActionsForRole(side, { livingStage }).map((item) => ({ ...item })),
    followUpActions: replied && !appointmentActive && !bundleModeActive ? partyFollowUpActions(side, replyAction, followUpAction) : [],
    decisionPackage: bundleModeActive || bundleSubmitted ? decisionPackage : null,
    coordinationForm: null,
    replied,
    replyLabel: bundleSubmitted
      ? bundleSummary
      : (replied ? partyActionLabel(side, replyAction) : ""),
    followUpLabel,
    revealedDetail: revealed,
    appointment: publicAppointment,
    submitSuccessCopy: bundleSubmitted
      ? "تم إرسال ردك للطرف الآخر، وسيتدخل الوسيط عند اكتمال الاتفاق أو طلب المعاينة."
      : ""
  };
  const serialized = JSON.stringify(view);
  for (const key of SECRET_KEYS) {
    if (Object.hasOwn(view, key)) throw new Error(`leaked_${key}`);
  }
  if (/\+966|05\d{8}|9665\d{8}/.test(serialized)) {
    throw new Error("leaked_phone");
  }
  return view;
}

export function partySessionKey(matchId, party) {
  const match = text(matchId);
  const side = party === "owner" ? "owner" : "client";
  if (!match) return "";
  return `${match}__${side}`;
}
