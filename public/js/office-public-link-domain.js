/**
 * Public office short links, crawler OG HTML, and WhatsApp share copy.
 * Private party tokens stay opaque and are never shortened here.
 */

import {
  PLATFORM_APP_NAME,
  PLATFORM_DEFAULT_LOGO,
  PLATFORM_DEFAULT_LOGO_512,
  resolveOfficeBrandIcon
} from "./platform-brand-domain.js";
import { normalizePublicSlug, officeLinkFor, safeText } from "./office-domain.js";

export const PUBLIC_OFFICE_PATH_PREFIX = "/m";
export const LEGACY_PUBLIC_OFFICE_PATH_PREFIX = "/o";
export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

export const RESERVED_PUBLIC_SLUGS = Object.freeze([
  "admin", "api", "app", "auth", "css", "cv2", "fcm", "fonts", "health",
  "icons", "iaqar", "index", "js", "login", "m", "manifest", "matching",
  "media", "messages", "notifications", "o", "office", "operations",
  "party", "pipeline", "platform", "r", "settings", "share", "share-target",
  "staging", "support", "version", "w", "workflow", "cooperation"
]);

export const CRAWLER_UA_RE = /whatsapp|facebookexternalhit|facebot|twitterbot|slackbot|linkedinbot|telegrambot|discordbot|googlebot|bingbot|embedly|preview|pinterest|vkshare|opengraph|iframely/i;

function text(value) {
  return String(value == null ? "" : value).trim();
}

export function isReservedPublicSlug(value) {
  return RESERVED_PUBLIC_SLUGS.includes(normalizePublicSlug(value));
}

export function isLegacyPublicSlug(value) {
  const slug = normalizePublicSlug(value);
  return slug.length > 20 && slug.length <= 64;
}

export function validateAssignablePublicSlug(value) {
  const slug = normalizePublicSlug(value);
  if (!slug) return { ok: false, error: "slug_required", message: "معرّف الرابط مطلوب" };
  if (slug.length < 3) return { ok: false, error: "slug_too_short", message: "معرّف الرابط يجب أن يكون 3 أحرف على الأقل" };
  if (slug.length > 20) return { ok: false, error: "slug_too_long", message: "معرّف الرابط يجب ألا يتجاوز 20 حرفًا" };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return { ok: false, error: "slug_invalid", message: "استخدم أحرفًا إنجليزية صغيرة وأرقامًا وشرطة فقط" };
  }
  if (isReservedPublicSlug(slug)) {
    return { ok: false, error: "slug_reserved", message: "هذا المعرّف محجوز لمسار داخلي" };
  }
  return { ok: true, slug };
}

export function suggestAssignablePublicSlug(value) {
  const base = normalizePublicSlug(value).replace(/-\d+$/, "") || "office";
  const trimmed = base.slice(0, 18);
  for (let n = 2; n <= 99; n += 1) {
    const candidate = `${trimmed}${n}`.slice(0, 20);
    const checked = validateAssignablePublicSlug(candidate);
    if (checked.ok && checked.slug !== normalizePublicSlug(value)) return checked.slug;
  }
  return "";
}

export function parsePublicOfficePath(pathname = "") {
  const path = String(pathname || "").split("?")[0];
  const match = path.match(/^\/(m|o)\/([^/]+)\/?$/i);
  if (!match) return { kind: "", slug: "", legacy: false };
  const slug = normalizePublicSlug(decodeURIComponent(match[2] || ""));
  return {
    kind: match[1].toLowerCase(),
    slug,
    legacy: match[1].toLowerCase() === "o"
  };
}

export function isCrawlerUserAgent(userAgent = "") {
  return CRAWLER_UA_RE.test(String(userAgent || ""));
}

export function officeShareCardVersion(office = {}) {
  const parts = [
    text(office.officeName || office.displayName),
    text(office.logoUrl),
    text(office.displayImageUrl || office.officeProfilePhoto || office.officeImage),
    text(office.licenseNumber),
    text(office.city),
    hasRealLicenseVerification(office) ? "verified" : "unverified",
    text(office.updatedAt),
    text(office.shareCardNonce)
  ];
  let hash = 2166136261;
  const source = parts.join("|");
  for (const char of source) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 10) || "1";
}

export function officeShareCardPath(slug, version) {
  const handle = normalizePublicSlug(slug) || text(slug).replace(/[^a-z0-9_-]/gi, "").slice(0, 80);
  const ver = text(version).replace(/[^a-z0-9_-]/gi, "").slice(0, 24) || "1";
  return `/share/office/${encodeURIComponent(handle || "office")}/card-v${ver}.png`;
}

export function officePublicLandingUrl(origin, officeId) {
  const base = text(origin).replace(/\/$/, "");
  const id = text(officeId);
  if (!base || !id) return "";
  const url = new URL("/", `${base}/`);
  url.searchParams.set("office", id);
  url.searchParams.set("view", "public");
  return url.toString();
}

export function officeShareCardImageMode(office = {}) {
  if (text(office.logoUrl)) return "logo";
  if (text(office.displayImageUrl || office.officeProfilePhoto || office.officeImage)) return "photo";
  return "fallback";
}

export function officeShareCardCityLine(office = {}) {
  const city = text(office.city);
  return city ? `المدينة: ${city}` : "";
}

export function hasRealLicenseVerification(office = {}) {
  return office.licenseVerified === true
    || office.falVerified === true
    || Boolean(text(office.falVerifiedAt) || text(office.licenseVerifiedAt));
}

export function officeLicensePreviewLines(office = {}) {
  const number = text(office.licenseNumber).replace(/[^\d]/g, "");
  const lines = [];
  if (hasRealLicenseVerification(office) && number) {
    lines.push("✓ مكتب عقاري مرخص");
    lines.push(`رخصة فال: ${number}`);
    return lines;
  }
  if (number) lines.push(`رخصة فال: ${number}`);
  return lines;
}

export function officeOgDescription(office = {}) {
  const city = text(office.city);
  const verified = hasRealLicenseVerification(office);
  if (verified && city) return `مكتب عقاري مرخص في ${city}`;
  if (verified) return "مكتب عقاري مرخص";
  if (city) return `مكتب عقاري في ${city}`;
  return "مكتب عقاري";
}

export function officeShareMessage({ officeName = "", origin = "", publicSlug = "", officeId = "" } = {}) {
  const name = text(officeName) || "مكتب عقاري";
  const link = officeLinkFor({ origin, publicSlug, officeId });
  return `${name}\nرابط المكتب:\n${link}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

export function buildOfficeOgHtml({
  office = {},
  slug = "",
  origin = "",
  workerOrigin = "",
  canonicalUrl = "",
  imageUrl = "",
  browserRedirectUrl = "",
  includeBrowserRedirect = true
} = {}) {
  const name = text(office.officeName || office.displayName) || PLATFORM_APP_NAME;
  const description = officeOgDescription(office);
  const pageUrl = text(canonicalUrl) || officeLinkFor({ origin, publicSlug: slug, officeId: office.officeId });
  const image = text(imageUrl)
    || (workerOrigin ? `${String(workerOrigin).replace(/\/$/, "")}${officeShareCardPath(slug || office.publicSlug, officeShareCardVersion(office))}` : "")
    || `${String(origin || workerOrigin).replace(/\/$/, "")}${PLATFORM_DEFAULT_LOGO_512}`;
  const landing = text(browserRedirectUrl) || officePublicLandingUrl(origin, office.officeId) || pageUrl;
  const title = escapeHtml(name);
  const desc = escapeHtml(description);
  const url = escapeHtml(pageUrl);
  const img = escapeHtml(image);
  const go = escapeHtml(landing);
  // Never meta-refresh: WhatsApp's crawler follows it and then screenshots the SPA.
  // A JS redirect still helps a human WhatsApp in-app browser after they tap the link.
  const redirectScript = includeBrowserRedirect === false
    ? ""
    : `
  <script>location.replace(${JSON.stringify(landing)});</script>`;
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="description" content="${desc}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${desc}">
  <meta property="og:image" content="${img}">
  <meta property="og:image:width" content="${SHARE_CARD_WIDTH}">
  <meta property="og:image:height" content="${SHARE_CARD_HEIGHT}">
  <meta property="og:url" content="${url}">
  <meta property="og:locale" content="ar_SA">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${desc}">
  <meta name="twitter:image" content="${img}">
</head>
<body>
  <p>${title}</p>
  <p><a href="${go}">فتح صفحة المكتب</a></p>${redirectScript}
</body>
</html>`;
}

export function officePreviewBrandIcon(office = {}) {
  return resolveOfficeBrandIcon(office) || PLATFORM_DEFAULT_LOGO;
}

export { PLATFORM_APP_NAME, safeText };
