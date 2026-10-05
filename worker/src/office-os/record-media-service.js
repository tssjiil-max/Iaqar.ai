/**
 * Property photos of an offer (see public/os/domain/record-media-domain.js for the rules).
 *
 *   POST /media/record-image            member upload of one photo (raw bytes)
 *   GET  /media/public/record-media/…   serves a photo by its unguessable address
 *   POST /os/records/media              keep / order / remove (first = main photo)
 *
 * Every write checks office membership and that the record belongs to that office. The
 * real file type is read from the bytes, the size is limited, and only keys in this
 * record's own folder are ever written or deleted.
 */

import { createStore } from "./store.js";
import { AUDIT_ACTIONS, writeAudit } from "./audit-log.js";
import { LIFECYCLE, RECORD_KIND, kindOf, lifecycleOf } from "../../../public/os/domain/records-domain.js";
import {
  MAX_IMAGE_UPLOAD_BYTES, MAX_RECORD_IMAGES, RECORD_IMAGE_KEY_PATTERN, arrangeImages, imageFields, keyBelongsTo,
  recordImageKey, recordImageUrl, recordImages, sniffImageType
} from "../../../public/os/domain/record-media-domain.js";

const PUBLIC_PREFIX = "/media/public/";
const INTAKE_IMAGE_BYTES = 8 * 1024 * 1024;

function newImageId() {
  return crypto.randomUUID().replace(/-/g, "");
}

function cleanRecordId(value) {
  const id = String(value ?? "").trim();
  return /^[a-zA-Z0-9_-]{1,180}$/.test(id) ? id : "";
}

function bucketOf(env, deps) {
  if (!env?.IAQAR_MEDIA) throw deps.appError("media_storage_unavailable", 503, "تخزين الوسائط غير مفعّل");
  return env.IAQAR_MEDIA;
}

/** The Worker's own public address (photos are served from it). */
export function workerOriginOf(request, env) {
  const configured = String(env?.WORKER_PUBLIC_ORIGIN || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(configured) ? configured : new URL(request.url).origin;
}

async function readLimited(request, deps, limit) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > limit) throw deps.appError("image_too_large", 413, "حجم الصورة يتجاوز الحد المسموح");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) throw deps.appError("image_empty", 400, "الصورة فارغة");
  if (bytes.length > limit) throw deps.appError("image_too_large", 413, "حجم الصورة يتجاوز الحد المسموح");
  return bytes;
}

function assertPhotoRecord(deps, record, officeId) {
  if (!record || String(record.officeId || officeId) !== officeId) throw deps.appError("record_not_found", 404, "السجل غير موجود");
  if (lifecycleOf(record) === LIFECYCLE.DELETED) throw deps.appError("record_deleted", 409, "السجل محذوف");
  if (kindOf(record) !== RECORD_KIND.OFFER) throw deps.appError("record_images_offer_only", 409, "الصور تُضاف للعروض فقط");
}

export async function uploadRecordImage(request, env, deps, { requestId = "" } = {}) {
  const bucket = bucketOf(env, deps);
  const officeId = deps.firestoreOfficeId(request.headers.get("x-office-id"));
  const recordId = cleanRecordId(request.headers.get("x-record-id"));
  if (!officeId || officeId === "platform" || !recordId) throw deps.appError("invalid_media_target", 400, "وجهة الصورة غير صالحة");
  // Membership first: nothing is read or stored for a non-member.
  const identity = await deps.authorizeOfficeRequest(request, env, officeId, "member");
  const bytes = await readLimited(request, deps, MAX_IMAGE_UPLOAD_BYTES);
  const contentType = sniffImageType(bytes);
  if (!contentType) throw deps.appError("unsupported_media", 415, "اختر صورة JPG أو PNG أو WebP");

  deps.assertFirebaseSecrets(env);
  const projectId = env.FIREBASE_PROJECT_ID || deps.DEFAULT_PROJECT_ID;
  const accessToken = await deps.getGoogleAccessToken(env);
  const store = createStore(deps, { projectId, accessToken });
  const segments = ["offices", officeId, "opportunities", recordId];
  const record = await store.get(segments);
  assertPhotoRecord(deps, record, officeId);
  if (recordImages(record).length >= MAX_RECORD_IMAGES) throw deps.appError("record_images_limit", 409, `الحد الأقصى ${MAX_RECORD_IMAGES} صور للعقار`);

  const now = new Date();
  const imageId = newImageId();
  const key = recordImageKey(officeId, recordId, imageId, contentType);
  if (!key) throw deps.appError("invalid_media_target", 400, "وجهة الصورة غير صالحة");
  await bucket.put(key, bytes, {
    httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { officeId, recordId, uploadedBy: String(identity.uid || ""), uploadedAt: now.toISOString() }
  });
  const image = {
    id: imageId, path: key, url: recordImageUrl(workerOriginOf(request, env), key), contentType,
    bytes: bytes.length, uploadedAt: now.toISOString(), uploadedBy: String(identity.uid || ""), source: "BROKER"
  };
  let saved = null;
  try {
    // Read-modify-write on the record so two uploads never overwrite each other's entry.
    const result = await store.update(segments, (current) => {
      const list = recordImages(current);
      if (list.length >= MAX_RECORD_IMAGES || lifecycleOf(current) === LIFECYCLE.DELETED) return null;
      saved = [...list, image];
      return { ...imageFields(saved), updatedAt: now };
    });
    if (!result || !result.patch) saved = null;
  } catch (error) {
    await Promise.resolve(bucket.delete?.(key)).catch(() => {});
    throw error;
  }
  if (!saved) {
    await Promise.resolve(bucket.delete?.(key)).catch(() => {});
    throw deps.appError("record_images_limit", 409, `الحد الأقصى ${MAX_RECORD_IMAGES} صور للعقار`);
  }
  await writeAudit({ deps, store, now: () => now }, {
    officeId, action: AUDIT_ACTIONS.RECORD_MEDIA_UPDATED, actorUid: String(identity.uid || ""), entityType: "record", entityId: recordId,
    key: `add:${imageId}`, details: { change: "added", imageId, count: saved.length }
  });
  return deps.jsonResponse({ ok: true, image, images: saved, coverUrl: saved[0]?.url || "", requestId }, 201);
}

export function isPublicRecordImagePath(pathname) {
  return String(pathname || "").startsWith(`${PUBLIC_PREFIX}record-media/`);
}

export async function servePublicRecordImage(url, env, deps, { headers: baseHeaders = {} } = {}) {
  const bucket = bucketOf(env, deps);
  let key = "";
  try { key = decodeURIComponent(url.pathname.slice(PUBLIC_PREFIX.length)); } catch (_) { key = ""; }
  if (!RECORD_IMAGE_KEY_PATTERN.test(key)) throw deps.appError("media_not_found", 404, "الصورة غير موجودة");
  const object = await bucket.get(key);
  if (!object) throw deps.appError("media_not_found", 404, "الصورة غير موجودة");
  const headers = new Headers(baseHeaders);
  if (typeof object.writeHttpMetadata === "function") object.writeHttpMetadata(headers);
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  // The file never changes under its id, so it can be cached for good.
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-disposition", "inline");
  return new Response(object.body, { headers });
}

/** Keep / order / remove. `order` = ids to keep, first is the main photo. */
export async function arrangeRecordImages(ctx, { actor, officeId, recordId, order }) {
  const id = cleanRecordId(recordId);
  if (!id) throw ctx.deps.appError("record_not_found", 404, "السجل غير موجود");
  if (!Array.isArray(order)) throw ctx.deps.appError("record_images_order_required", 400, "ترتيب الصور مطلوب");
  const segments = ["offices", officeId, "opportunities", id];
  const record = await ctx.store.get(segments);
  assertPhotoRecord(ctx.deps, record, officeId);
  const now = ctx.now();
  let removed = [];
  let images = recordImages(record);
  const before = images.map((image) => image.id).join(",");
  const result = await ctx.store.update(segments, (current) => {
    const arranged = arrangeImages(recordImages(current), order);
    removed = arranged.removed;
    images = arranged.images;
    if (images.map((image) => image.id).join(",") === recordImages(current).map((image) => image.id).join(",")) return null;
    return { ...imageFields(images), updatedAt: now };
  });
  if (!result) throw ctx.deps.appError("record_not_found", 404, "السجل غير موجود");
  if (!result.patch) return { ok: true, images, coverUrl: images[0]?.url || "", changed: false };
  // Files go only after the record no longer lists them, and only from this record's folder.
  const bucket = ctx.deps.mediaBucket;
  for (const image of removed) {
    if (!bucket?.delete || !keyBelongsTo(image.path, officeId, id)) continue;
    await Promise.resolve(bucket.delete(image.path)).catch((error) => console.warn("[office-os] photo delete failed", error?.message));
  }
  await writeAudit(ctx, {
    officeId, action: AUDIT_ACTIONS.RECORD_MEDIA_UPDATED, actorUid: actor.uid, entityType: "record", entityId: id,
    key: `arrange:${before}>${images.map((image) => image.id).join(",")}`,
    details: { change: removed.length ? "removed_or_reordered" : "reordered", removed: removed.length, count: images.length }
  });
  return { ok: true, images, coverUrl: images[0]?.url || "", changed: true, removed: removed.length };
}

/**
 * Photos an owner attached on the public office link (public-intake/<office>/<intake>/image-N)
 * become the new offer's own photos, so the broker sees them like any other. Best effort:
 * a failure leaves the intake files where they were and never blocks the intake.
 */
export async function promoteIntakeImages(deps, { env, projectId, accessToken, officeId, recordId, mediaPaths = [], workerOrigin = "" }) {
  const bucket = env?.IAQAR_MEDIA;
  const id = cleanRecordId(recordId);
  if (!bucket || !id || !Array.isArray(mediaPaths) || !mediaPaths.length) return { promoted: 0 };
  const own = new RegExp(`^public-intake/${String(officeId).replace(/[^a-zA-Z0-9_-]/g, "")}/[a-zA-Z0-9_-]{8,80}/image-[1-5]\\.(?:jpg|png|webp)$`);
  const store = createStore(deps, { projectId, accessToken });
  const segments = ["offices", officeId, "opportunities", id];
  const record = await store.get(segments);
  if (!record || kindOf(record) !== RECORD_KIND.OFFER || recordImages(record).length) return { promoted: 0 };
  const now = new Date();
  const images = [];
  for (const path of mediaPaths.slice(0, 5)) {
    if (!own.test(String(path || ""))) continue;
    const object = await bucket.get(path);
    if (!object) continue;
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    if (!bytes.length || bytes.length > INTAKE_IMAGE_BYTES) continue;
    const contentType = sniffImageType(bytes);
    if (!contentType) continue;
    const imageId = newImageId();
    const key = recordImageKey(officeId, id, imageId, contentType);
    if (!key) continue;
    await bucket.put(key, bytes, {
      httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { officeId, recordId: id, uploadedBy: "office-link", uploadedAt: now.toISOString() }
    });
    images.push({ id: imageId, path: key, url: recordImageUrl(workerOrigin, key), contentType, bytes: bytes.length, uploadedAt: now.toISOString(), uploadedBy: "", source: "OFFICE_LINK" });
  }
  if (!images.length) return { promoted: 0 };
  await store.set(segments, imageFields(images));
  return { promoted: images.length };
}
