/**
 * Daily-task party send helpers. Mints distinct client/owner review tokens
 * and WhatsApp copy. Does not claim a message was sent.
 */

export const PARTY_LINK_STORAGE_KEY = "iaqar:party-links";
export const PARTY_LINK_QUERY = "cv2Party";

export const PARTY_SEND_COPY = Object.freeze({
  missingClientPhone: "رقم تواصل العميل غير متوفر.",
  missingOwnerPhone: "رقم تواصل المالك غير متوفر.",
  openedWhatsAppClient: "تم فتح واتساب للعميل",
  openedWhatsAppOwner: "تم فتح واتساب للمالك",
  linkFailed: "تعذر إنشاء رابط المراجعة.",
  whatsappFailed: "تعذر فتح واتساب.",
  sendFailed: "تعذر تجهيز الإرسال.",
  detailsFailed: "تعذر فتح تفاصيل العرض.",
  sentClaimForbidden: "تم إرسال الرسالة"
});

export function missingPartyPhoneMessage(party) {
  return party === "owner"
    ? PARTY_SEND_COPY.missingOwnerPhone
    : PARTY_SEND_COPY.missingClientPhone;
}

export function whatsappOpenedMessage(party) {
  return party === "owner"
    ? PARTY_SEND_COPY.openedWhatsAppOwner
    : PARTY_SEND_COPY.openedWhatsAppClient;
}

export function normalizeDailyTaskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (/^009665\d{8}$/.test(digits)) return digits.slice(2);
  if (/^9665\d{8}$/.test(digits)) return digits;
  if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `966${digits}`;
  return "";
}

export function partyLinkStorageKey({ officeId = "", matchId = "", party = "client" } = {}) {
  const match = String(matchId || "").trim();
  const office = String(officeId || "").trim() || "local";
  const side = party === "owner" ? "owner" : "client";
  if (!match) return "";
  return `${office}:${match}:${side}`;
}

function randomSessionId() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `s${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

function utf8ToBase64Url(text) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(String(text), "utf8").toString("base64url");
  }
  const chars = unescape(encodeURIComponent(String(text)));
  return btoa(chars).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToUtf8(token) {
  const padded = String(token || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const raw = padded + pad;
  if (typeof Buffer !== "undefined") {
    return Buffer.from(raw, "base64").toString("utf8");
  }
  return decodeURIComponent(escape(atob(raw)));
}

export function encodePartyLinkToken(payload = {}) {
  const matchId = String(payload.matchId || "").trim();
  const party = payload.party === "owner" ? "owner" : "client";
  if (!matchId) return "";
  return utf8ToBase64Url(JSON.stringify({
    v: 1,
    sid: String(payload.sid || randomSessionId()),
    officeId: String(payload.officeId || "").trim(),
    matchId,
    party,
    sessionKind: party === "owner" ? "OWNER_MATCH_REVIEW" : "CLIENT_MATCH_REVIEW",
    offerId: String(payload.offerId || "").trim(),
    requestId: String(payload.requestId || "").trim(),
    opportunityId: String(payload.opportunityId || "").trim(),
    propertyLine: String(payload.propertyLine || "").trim(),
    moneyLine: String(payload.moneyLine || "").trim()
  }));
}

export function parsePartyLinkToken(token) {
  try {
    const parsed = JSON.parse(base64UrlToUtf8(token));
    const matchId = String(parsed?.matchId || "").trim();
    if (!matchId || Number(parsed?.v) !== 1) return null;
    const party = parsed.party === "owner" ? "owner" : "client";
    return {
      v: 1,
      sid: String(parsed.sid || "").trim(),
      officeId: String(parsed.officeId || "").trim(),
      matchId,
      party,
      sessionKind: party === "owner" ? "OWNER_MATCH_REVIEW" : "CLIENT_MATCH_REVIEW",
      offerId: String(parsed.offerId || "").trim(),
      requestId: String(parsed.requestId || "").trim(),
      opportunityId: String(parsed.opportunityId || "").trim(),
      propertyLine: String(parsed.propertyLine || "").trim(),
      moneyLine: String(parsed.moneyLine || "").trim()
    };
  } catch {
    return null;
  }
}

export function isOpaquePartyToken(token) {
  return /^[a-f0-9]{32,128}$/i.test(String(token || "").trim());
}

export function buildPartyReviewUrl({ origin = "", pathname = "/", token = "" } = {}) {
  const sid = String(token || "").trim();
  if (!isOpaquePartyToken(sid)) return "";
  const base = String(origin || "").replace(/\/$/, "") || "";
  const path = pathname && pathname.startsWith("/") ? pathname : `/${pathname || ""}`;
  const params = new URLSearchParams();
  params.set(PARTY_LINK_QUERY, sid);
  return `${base}${path}?${params.toString()}`;
}

export function partyTokenFromLocation(locationLike = {}) {
  try {
    const params = new URLSearchParams(locationLike.search || "");
    return String(params.get(PARTY_LINK_QUERY) || "").trim();
  } catch {
    return "";
  }
}

export function readPartyLinkStore(raw) {
  if (!raw) return { byKey: {}, byToken: {} };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      byKey: parsed?.byKey && typeof parsed.byKey === "object" ? parsed.byKey : {},
      byToken: parsed?.byToken && typeof parsed.byToken === "object" ? parsed.byToken : {}
    };
  } catch {
    return { byKey: {}, byToken: {} };
  }
}

export function rememberPartyLink(store, { key, token, record } = {}) {
  const next = {
    byKey: { ...(store?.byKey || {}) },
    byToken: { ...(store?.byToken || {}) }
  };
  if (key && token) next.byKey[key] = token;
  if (token && record) next.byToken[token] = record;
  return next;
}

export function existingPartyToken(store, key) {
  const token = String(store?.byKey?.[key] || "").trim();
  if (!token) return "";
  return parsePartyLinkToken(token) ? token : "";
}

export function buildPartyWhatsAppMessage({
  party = "client",
  officeName = "المكتب العقاري",
  contactName = "",
  propertyLine = "",
  reviewUrl = ""
} = {}) {
  const office = String(officeName || "المكتب العقاري").trim() || "المكتب العقاري";
  const name = String(contactName || "").trim();
  const greeting = `مرحبًا${name ? ` ${name}` : ""}، معك ${office}.`;
  const property = String(propertyLine || "").trim() || "العقار";
  const url = String(reviewUrl || "").trim();
  const body = party === "owner"
    ? `يوجد عميل مهتم بعقار مطابق لـ ${property}. نرغب في استكمال التنسيق معك.`
    : `وجدنا عرضًا مناسبًا لطلبك: ${property}. نرغب في استكمال التنسيق معك.`;
  const linkBlock = url ? `\n\nرابط المراجعة:\n${url}` : "";
  return `${greeting}\n\n${body}${linkBlock}\n\nمع التحية،\n${office}`;
}

export function phoneFieldsForParty(task = {}, party = "client") {
  if (party === "owner") {
    return [
      task.ownerPhone,
      task.ownerContactPhone,
      task.advertiserPhone
    ];
  }
  return [
    task.clientPhone,
    task.clientContactPhone,
    task.buyerPhone
  ];
}

export function phoneFromTask(task = {}, party = "client") {
  for (const value of phoneFieldsForParty(task, party)) {
    const digits = normalizeDailyTaskPhone(value);
    if (digits) return digits;
  }
  return "";
}

export function opportunityIdForParty(task = {}, party = "client") {
  if (party === "owner") {
    return String(task.offerId || task.ownerOfferId || task.opportunityId || "").trim();
  }
  return String(task.requestId || task.clientRequestId || task.opportunityId || "").trim();
}

export function detailsOpportunityId(task = {}) {
  return String(task.opportunityId || task.offerId || task.requestId || "").trim();
}
