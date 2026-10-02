/** Office share card (the preview image WhatsApp shows for the office link) — pure rules. */

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

const text = (value) => String(value == null ? "" : value).trim();

/** Firebase-hosted preview domains have no crawler routing; the Worker serves the preview there. */
export function isHostedPreviewHost(hostname = "") {
  return /(^|\.)(web\.app|firebaseapp\.com)$/i.test(text(hostname));
}

/** The link the broker shares: the Worker preview on hosted domains, the normal short link elsewhere. */
export function officeShareUrl({ slug = "", officeId = "", origin = "", hostname = "", workerOrigin = "" } = {}) {
  const handle = text(slug).toLowerCase();
  if (!handle) {
    const url = new URL("/", origin || "https://iaqar.ai");
    url.searchParams.set("office", officeId);
    url.searchParams.set("view", "public");
    return url.toString();
  }
  const base = isHostedPreviewHost(hostname) && workerOrigin ? workerOrigin : origin;
  return `${String(base).replace(/\/$/, "")}/m/${encodeURIComponent(handle)}`;
}

/** Changes only when the preview image changes (photo or slug) — it becomes the image's cache-busting version. */
export function shareCardKey(office = {}) {
  const photo = text(office.brokerPhotoUrl);
  const parts = [office.publicSlug, photo ? `${photo.length}:${photo.slice(-24)}` : "none"];
  let hash = 2166136261;
  for (const char of parts.map(text).join("|")) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

/** The version part of a stored nonce (a forced refresh appends a suffix). */
export function nonceKey(nonce = "") {
  return text(nonce).split("-")[0];
}
