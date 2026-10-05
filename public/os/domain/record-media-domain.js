/**
 * Property photos of an offer — pure rules shared by the form, the record page and the Worker.
 *
 * Photos live in the office's media bucket under record-media/<officeId>/<recordId>/<imageId>.<ext>
 * and are listed on the record itself (`images`, first = the main photo, mirrored in `coverUrl`).
 * The image id is a random 128-bit value, so the address works like a private share link the
 * broker can pass to a client; uploading, ordering and removing always need an office member.
 * Requests never carry photos.
 */

export const MAX_RECORD_IMAGES = 10;
/** Upload limit after the browser has resized the photo (the Worker re-checks the real bytes). */
export const MAX_IMAGE_UPLOAD_BYTES = 3 * 1024 * 1024;
/** What the browser accepts from the gallery/camera before resizing. */
export const MAX_IMAGE_INPUT_BYTES = 25 * 1024 * 1024;
export const IMAGE_LONG_EDGE = 1600;
export const IMAGE_QUALITIES = Object.freeze([0.84, 0.74, 0.62, 0.5]);
/** Resized photos aim to stay under this so pages load fast on mobile data. */
export const IMAGE_TARGET_BYTES = 450 * 1024;

export const RECORD_IMAGE_TYPES = Object.freeze({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" });
export const RECORD_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

export const IMAGE_MESSAGES = Object.freeze({
  type: "اختر صورًا بصيغة JPG أو PNG أو WEBP فقط.",
  size: "الصورة كبيرة جدًا — اختر صورة أصغر من 25 ميجابايت.",
  unreadable: "تعذر قراءة الصورة — اختر صورة أخرى.",
  limit: `الحد الأقصى ${MAX_RECORD_IMAGES} صور للعقار.`,
  tooLarge: "تعذر تصغير الصورة بما يكفي — اختر صورة أخرى."
});

export function checkImageFile(file) {
  if (!file || !RECORD_IMAGE_TYPES[String(file.type || "").toLowerCase()]) return { ok: false, message: IMAGE_MESSAGES.type };
  if (Number(file.size || 0) > MAX_IMAGE_INPUT_BYTES) return { ok: false, message: IMAGE_MESSAGES.size };
  if (!(Number(file.size || 0) > 0)) return { ok: false, message: IMAGE_MESSAGES.unreadable };
  return { ok: true, message: "" };
}

/** Target size that fits inside max×max keeping the aspect ratio; never enlarges. */
export function fitWithin(width, height, max = IMAGE_LONG_EDGE) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** The real type from the file's first bytes — never trust the declared content type alone. */
export function sniffImageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return "";
}

const ID_PATTERN = /^[a-f0-9]{32}$/;
const SAFE_SEGMENT = /^[a-zA-Z0-9_-]{1,180}$/;
/** record-media/<officeId>/<recordId>/<32 hex>.<jpg|png|webp> — the only keys ever served or deleted. */
export const RECORD_IMAGE_KEY_PATTERN = /^record-media\/[a-zA-Z0-9_-]{1,80}\/[a-zA-Z0-9_-]{1,180}\/[a-f0-9]{32}\.(?:jpg|png|webp)$/;

export function isImageId(value) {
  return ID_PATTERN.test(String(value || ""));
}

export function recordImageKey(officeId, recordId, imageId, contentType) {
  const ext = RECORD_IMAGE_TYPES[String(contentType || "").toLowerCase()];
  if (!ext || !isImageId(imageId) || !SAFE_SEGMENT.test(String(officeId || "")) || !SAFE_SEGMENT.test(String(recordId || ""))) return "";
  return `record-media/${officeId}/${recordId}/${imageId}.${ext}`;
}

export function recordImageUrl(workerOrigin, key) {
  if (!RECORD_IMAGE_KEY_PATTERN.test(String(key || ""))) return "";
  return `${String(workerOrigin || "").replace(/\/+$/, "")}/media/public/${key}`;
}

/** True when `key` is a photo of exactly this office and record. */
export function keyBelongsTo(key, officeId, recordId) {
  return RECORD_IMAGE_KEY_PATTERN.test(String(key || "")) && String(key).startsWith(`record-media/${officeId}/${recordId}/`);
}

/** Clean list from a record document: only our own well-formed entries, no duplicates, capped. */
export function recordImages(record = {}) {
  const raw = Array.isArray(record.images) ? record.images : [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "");
    const url = String(item.url || "");
    const path = String(item.path || "");
    if (!isImageId(id) || seen.has(id) || !/^https?:\/\//.test(url) || !RECORD_IMAGE_KEY_PATTERN.test(path)) continue;
    seen.add(id);
    out.push({
      id, url, path,
      contentType: String(item.contentType || ""),
      bytes: Number(item.bytes || 0) || 0,
      uploadedAt: String(item.uploadedAt || ""),
      uploadedBy: String(item.uploadedBy || ""),
      source: String(item.source || "")
    });
    if (out.length >= MAX_RECORD_IMAGES) break;
  }
  return out;
}

export function coverUrlOf(images = []) {
  return images[0]?.url || "";
}

/**
 * Apply the broker's arrangement: `order` lists the ids to keep, first = main photo.
 * Unknown ids are ignored; existing photos missing from `order` are removed.
 * Returns { images, removed } — `removed` are the entries whose files must be deleted.
 */
export function arrangeImages(existing = [], order = []) {
  const byId = new Map(existing.map((image) => [image.id, image]));
  const images = [];
  const kept = new Set();
  for (const raw of Array.isArray(order) ? order : []) {
    const id = String(raw || "");
    if (!byId.has(id) || kept.has(id)) continue;
    kept.add(id);
    images.push(byId.get(id));
  }
  return { images, removed: existing.filter((image) => !kept.has(image.id)) };
}

/** Fields written on the record whenever its photos change. */
export function imageFields(images = []) {
  return { images, coverUrl: coverUrlOf(images) || null, imageCount: images.length };
}

/** Move an item inside a list (used by the form's reorder buttons). Returns a new array. */
export function moveItem(list = [], from, to) {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
