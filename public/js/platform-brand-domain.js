/**
 * Single source for the platform brand identity.
 * Office logos/photos stay office-owned. This module never mixes the two.
 */

export const PLATFORM_APP_NAME = "مكاتب عقارية ذكية";
export const PLATFORM_APP_SHORT_NAME = "مكاتب عقارية";
export const PLATFORM_APP_TAGLINE = "منصة الفرص العقارية";

export const PLATFORM_DEFAULT_LOGO = "/icons/iaqar-default-icon-192.png";
export const PLATFORM_DEFAULT_LOGO_512 = "/icons/iaqar-default-icon-512.png";
export const PLATFORM_MASKABLE_512 = "/icons/iaqar-default-maskable-512.png";
export const PLATFORM_APPLE_TOUCH = "/icons/iaqar-apple-touch-icon-180.png";
export const PLATFORM_BADGE_ICON = "/icons/iaqar-badge-icon.png";

const BRAND_FILE_RE = /^\/icons\/iaqar-/;
const LEGACY_BRAND_FILES = new Set([
  "/icons/default-office.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-192-maskable.png",
  "/icons/icon-512-maskable.png",
  "/icons/favicon-16.png",
  "/icons/favicon-32.png"
]);

function text(value) {
  return String(value == null ? "" : value).trim();
}

function originOf(appOrigin) {
  return text(appOrigin).replace(/\/$/, "");
}

export function isPlatformDefaultLogo(url) {
  const src = text(url).split("?")[0];
  if (!src) return false;
  if (src === PLATFORM_DEFAULT_LOGO || src.endsWith(PLATFORM_DEFAULT_LOGO)) return true;
  if (src.endsWith("/icons/iaqar-default-icon-192.png")) return true;
  if (src.endsWith("/icons/iaqar-default-icon-512.png")) return true;
  if (src.endsWith("/icons/default-office.png")) return true;
  if (src.endsWith("/icons/icon-192.png") || src.endsWith("/icons/icon-512.png")) return true;
  return false;
}

export function isBrandIconPath(pathname) {
  const path = text(pathname).split("?")[0];
  if (BRAND_FILE_RE.test(path)) return true;
  return LEGACY_BRAND_FILES.has(path);
}

export function toAbsoluteHttpsIcon(url, appOrigin) {
  const src = text(url);
  const origin = originOf(appOrigin);
  if (!src) return origin ? `${origin}${PLATFORM_DEFAULT_LOGO}` : PLATFORM_DEFAULT_LOGO;
  if (/^https:\/\//i.test(src)) return src;
  if (/^http:\/\//i.test(src)) {
    return origin ? `${origin}${PLATFORM_DEFAULT_LOGO}` : PLATFORM_DEFAULT_LOGO;
  }
  const path = src.startsWith("/") ? src : `/${src}`;
  return origin ? `${origin}${path}` : path;
}

export function resolveOfficeBrandIcon(office = {}) {
  const logo = text(office.logoUrl).slice(0, 2000);
  if (logo) return logo;
  const photo = text(office.displayImageUrl).slice(0, 2000);
  if (photo) return photo;
  return PLATFORM_DEFAULT_LOGO;
}

export function officeBrandIconCandidates(office = {}, { workerBase = "", officeId = "" } = {}) {
  const out = [];
  const seen = new Set();
  const add = (url) => {
    const src = text(url).slice(0, 2000);
    if (!src || seen.has(src)) return;
    seen.add(src);
    out.push(src);
  };
  const canonical = (variant) => {
    const base = text(workerBase).replace(/\/$/, "");
    const id = text(officeId);
    if (!base || !id) return "";
    return `${base}/media/public/office-covers/${encodeURIComponent(id)}/${variant}`;
  };
  if (text(office.logoUrl)) {
    add(canonical("logo"));
    add(office.logoUrl);
  }
  if (text(office.displayImageUrl)) {
    add(canonical("display"));
    add(office.displayImageUrl);
  }
  add(PLATFORM_DEFAULT_LOGO);
  return out;
}

export function resolveNotificationIcon({
  office = {},
  isPlatform = false,
  appOrigin = ""
} = {}) {
  const platform = toAbsoluteHttpsIcon(PLATFORM_DEFAULT_LOGO, appOrigin);
  if (isPlatform || text(office.officeId) === "platform") return platform;
  const brand = resolveOfficeBrandIcon(office);
  if (isPlatformDefaultLogo(brand)) return platform;
  return toAbsoluteHttpsIcon(brand, appOrigin);
}

export function resolveNotificationBadge({ iconUrl = "", appOrigin = "" } = {}) {
  const badge = toAbsoluteHttpsIcon(PLATFORM_BADGE_ICON, appOrigin);
  if (!badge || badge === text(iconUrl)) return "";
  if (isPlatformDefaultLogo(iconUrl) && isPlatformDefaultLogo(badge)) return "";
  return badge;
}

function purposeSuffix(purpose, propertyType) {
  const value = text(purpose).toLowerCase();
  const type = text(propertyType);
  if (!value) return "";
  if (/للإيجار|للايجار/.test(type)) return "";
  if (/للبيع/.test(type)) return "";
  if (value === "rent" || value === "rental" || value === "إيجار" || value === "ايجار" || value.includes("rent") || value.includes("إيجار")) {
    return "للإيجار";
  }
  if (value === "sale" || value === "sell" || value === "بيع" || value.includes("sale") || value.includes("بيع")) {
    return "للبيع";
  }
  return "";
}

export function formatListingPrice(value) {
  const raw = text(value).replace(/[^\d.]/g, "");
  if (!raw) return "";
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return `${Math.round(amount).toLocaleString("en-US")} ر.س`;
}

export function formatMatchNotificationBody(listing = {}) {
  const propertyType = text(listing.propertyType || listing.candidatePropertyType);
  const purpose = purposeSuffix(listing.purpose || listing.candidatePurpose, propertyType);
  const district = text(listing.district || listing.candidateDistrict || listing.city || listing.candidateCity);
  const price = formatListingPrice(listing.price || listing.candidateSalePrice || listing.budget);
  const subject = [propertyType, purpose].filter(Boolean).join(" ");
  const facts = [subject, district, price].filter(Boolean);
  if (!facts.length) return "مطابقة جديدة";
  return `مطابقة جديدة\n${facts.join(" · ")}`;
}

function isPlatformNotification({ officeId, isPlatform }) {
  return isPlatform === true || text(officeId) === "platform";
}

function officeDisplayName(office = {}) {
  return text(office.officeName) || text(office.displayName);
}

export function formatOfficePushPresentation({
  office = {},
  officeId = "",
  isPlatform = false,
  type = "",
  title = "",
  body = "",
  listing = null,
  appOrigin = ""
} = {}) {
  const platform = isPlatformNotification({ officeId: officeId || office.officeId, isPlatform });
  const resolvedTitle = platform
    ? PLATFORM_APP_NAME
    : (officeDisplayName(office) || PLATFORM_APP_NAME);
  const matchType = text(type).toLowerCase() === "match";
  const listingBody = listing && typeof listing === "object"
    ? formatMatchNotificationBody(listing)
    : "";
  let resolvedBody = text(body);
  if (matchType || (listingBody && listingBody !== "مطابقة جديدة")) {
    resolvedBody = listingBody || (matchType ? "مطابقة جديدة" : resolvedBody);
  }
  if (!resolvedBody) resolvedBody = "لديك تنبيه جديد";
  const icon = resolveNotificationIcon({ office: { ...office, officeId: officeId || office.officeId }, isPlatform: platform, appOrigin });
  const badge = resolveNotificationBadge({ iconUrl: icon, appOrigin });
  return {
    title: resolvedTitle,
    body: resolvedBody,
    icon,
    badge
  };
}
