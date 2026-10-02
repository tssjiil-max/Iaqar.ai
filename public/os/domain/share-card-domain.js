/** Office share card (the preview image WhatsApp shows for the office link) — pure rules. */

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

const text = (value) => String(value == null ? "" : value).trim();

export function previewVersion(value = "") {
  return text(value).replace(/[^a-z0-9_-]/gi, "").slice(0, 48);
}

/** Firebase-hosted preview domains have no crawler routing; the Worker serves the share page there. */
export function isHostedPreviewHost(hostname = "") {
  return /(^|\.)(web\.app|firebaseapp\.com)$/i.test(text(hostname));
}

/** Permanent office URL. This address does not change when the WhatsApp preview changes. */
export function officePermanentUrl({ slug = "", officeId = "", origin = "" } = {}) {
  const handle = text(slug).toLowerCase();
  if (handle) return `${String(origin || "https://iaqar.ai").replace(/\/$/, "")}/m/${encodeURIComponent(handle)}`;
  const url = new URL("/", origin || "https://iaqar.ai");
  url.searchParams.set("office", officeId);
  url.searchParams.set("view", "public");
  return url.toString();
}

/**
 * Versioned share URL. On Firebase preview domains the Worker owns /s so crawlers always
 * receive static OG HTML. If no preview version exists yet, fall back to the permanent
 * short link until ensureShareCard() publishes one.
 */
export function officeShareUrl({
  slug = "", officeId = "", origin = "", hostname = "", workerOrigin = "", preview = ""
} = {}) {
  const handle = text(slug).toLowerCase();
  if (!handle) return officePermanentUrl({ officeId, origin });
  const base = isHostedPreviewHost(hostname) && workerOrigin ? workerOrigin : origin;
  const root = String(base || origin || "https://iaqar.ai").replace(/\/$/, "");
  const version = previewVersion(preview);
  return version
    ? `${root}/s/${encodeURIComponent(handle)}/${encodeURIComponent(version)}`
    : `${root}/m/${encodeURIComponent(handle)}`;
}

/** Changes when any visible share-card content changes. */
export function shareCardKey(office = {}) {
  const photo = text(office.brokerPhotoUrl);
  const parts = [
    office.publicSlug,
    office.officeName || office.name,
    office.city,
    office.licenseNumber,
    photo ? `${photo.length}:${photo.slice(-48)}` : "no-photo",
    "share-card-v2"
  ];
  let hash = 2166136261;
  for (const char of parts.map(text).join("|")) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

/** The deterministic content key at the start of a stored nonce; force refresh adds a suffix. */
export function nonceKey(nonce = "") {
  return text(nonce).split("-")[0];
}
