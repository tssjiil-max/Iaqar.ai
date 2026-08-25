/**
 * Party-link sessions. Opaque tokens only — never treat URL JSON as authority.
 */

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

export const OWNER_PARTY_ACTIONS = Object.freeze([
  Object.freeze({ id: "property_available", label: "العقار متاح" }),
  Object.freeze({ id: "confirm_appointment", label: "تأكيد الموعد" }),
  Object.freeze({ id: "not_available", label: "غير متاح حالياً" })
]);

const SECRET_KEYS = Object.freeze([
  "phone", "contactPhone", "advertiserPhone", "advertiserPhoneNormalized",
  "ownerPhone", "clientPhone", "buyerPhone", "whatsapp",
  "ownerName", "clientName", "contactName", "advertiserDisplayName",
  "score", "matchScore", "opportunityScore", "closingReadinessScore",
  "matchId", "offerId", "requestId", "opportunityId", "sessionId",
  "token", "tokenHash", "officeId", "recipientRef", "brokerNote", "lastNote"
]);

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

export function partyActionsForRole(party) {
  return party === "owner" ? OWNER_PARTY_ACTIONS : CLIENT_PARTY_ACTIONS;
}

export function partyActionLabel(party, actionId) {
  const hit = partyActionsForRole(party).find((item) => item.id === actionId);
  return hit?.label || "";
}

export function isAllowedPartyAction(party, actionId) {
  return partyActionsForRole(party).some((item) => item.id === actionId);
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

function purposeWord(record = {}) {
  const purpose = text(record.purpose || record.transactionType).toUpperCase();
  if (purpose === "RENT" || purpose === "LEASE_REQUEST") return "للإيجار";
  if (purpose === "SALE" || purpose === "PURCHASE") return "للبيع";
  if (purpose === "INVESTMENT") return "للاستثمار";
  return "";
}

export function partyPropertyHeadline(record = {}) {
  const propertyType = text(record.propertyType);
  const purpose = purposeWord(record);
  const head = [propertyType, purpose].filter(Boolean).join(" ");
  return head || "العقار";
}

export function partyPriceLabel(record = {}) {
  const sale = Number(record.salePrice ?? record.price ?? record.budget ?? 0);
  const rent = Number(record.annualRent ?? 0);
  const format = (value) => `${value.toLocaleString("en-US")} ر.س`;
  if (rent > 0 && purposeWord(record) === "للإيجار") return `${format(rent)} سنويًا`;
  if (sale > 0) return format(sale);
  if (rent > 0) return `${format(rent)} سنويًا`;
  return text(record.moneyLine || record.priceLabel);
}

export function partyLocationLabel(record = {}) {
  const district = text(record.district).replace(/^حي\s+/, "");
  return district ? `حي ${district}` : "";
}

export function partyAreaLabel(record = {}) {
  const area = Number(record.area || 0);
  if (area > 0) return `${area.toLocaleString("en-US")} م²`;
  return "";
}

export function partySpecsLabel(record = {}) {
  const rooms = Number(record.rooms || 0);
  const baths = Number(record.baths || record.bathrooms || 0);
  const bits = [];
  if (rooms > 0) bits.push(`${rooms} غرف`);
  if (baths > 0) bits.push(`${baths} دورات مياه`);
  return bits.join(" · ");
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
  return {
    propertyType: text(record.propertyType),
    purpose: text(record.purpose || record.transactionType),
    typePurpose: partyPropertyHeadline(record),
    priceLabel: partyPriceLabel(record),
    locationLabel: partyLocationLabel(record),
    areaLabel: partyAreaLabel(record),
    specs: partySpecsLabel(record),
    photos: publicPhotoUrls(record)
  };
}

export function sanitizePartyPublicView({
  party = "client",
  status = PARTY_SESSION_STATUS.ACTIVE,
  snapshot = {},
  officeName = "",
  officeLogoUrl = "",
  replyAction = ""
} = {}) {
  const side = party === "owner" ? "owner" : "client";
  const replied = status === PARTY_SESSION_STATUS.REPLIED && Boolean(replyAction);
  const view = {
    party: side,
    title: partyViewTitle(side),
    officeName: text(officeName) || "المكتب العقاري",
    officeLogoUrl: /^https:\/\//i.test(officeLogoUrl) ? officeLogoUrl : "",
    property: {
      photos: publicPhotoUrls(snapshot),
      typePurpose: text(snapshot.typePurpose) || partyPropertyHeadline(snapshot),
      priceLabel: text(snapshot.priceLabel) || partyPriceLabel(snapshot),
      locationLabel: text(snapshot.locationLabel) || partyLocationLabel(snapshot),
      areaLabel: text(snapshot.areaLabel) || partyAreaLabel(snapshot),
      specs: text(snapshot.specs) || partySpecsLabel(snapshot)
    },
    actions: replied ? [] : partyActionsForRole(side).map((item) => ({ ...item })),
    replied,
    replyLabel: replied ? partyActionLabel(side, replyAction) : ""
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
