/** Publishes the broker photo as the office's public link-preview image (WhatsApp). Without a photo the logo / platform logo is used. */

import { db, idToken, workerBase } from "./runtime.js";
import { session } from "./session.js";
import { SHARE_PHOTO_SIZE, nonceKey, shareCardKey } from "../domain/share-card-domain.js";
import { isSafePhotoDataUrl } from "../domain/avatar-domain.js";

const stamp = () => window.firebase.firestore.FieldValue.serverTimestamp();

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The broker's photo as a square PNG (the image WhatsApp shows). null when there is no photo — the platform logo is used then. */
export async function drawSharePhoto(office) {
  if (!isSafePhotoDataUrl(office.brokerPhotoUrl)) return null;
  const photo = await loadImage(office.brokerPhotoUrl);
  if (!photo) return null;
  const size = SHARE_PHOTO_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff"; context.fillRect(0, 0, size, size);
  context.drawImage(photo, 0, 0, size, size);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

/**
 * Uploads the card when what it shows changed (or when forced). The nonce on both office documents versions the
 * preview URL. Never throws; returns { status: "uploaded" | "current" | "failed", reason, blob } so the screen can say what happened.
 */
export async function ensureShareCard({ force = false } = {}) {
  const office = session.office || {};
  if (!session.isManager || !session.officeId) return { status: "failed", reason: "يلزم مدير المكتب" };
  if (!office.publicSlug) return { status: "failed", reason: "اضبط معرّف الرابط القصير أولًا" };
  const key = shareCardKey(office);
  let blob = null;
  try {
    blob = await drawSharePhoto(office);
  } catch (_) {
    return { status: "failed", reason: "تعذر تجهيز الصورة" };
  }
  const hasPhoto = Boolean(blob);
  if (!force && office.shareCardNonce && nonceKey(office.shareCardNonce) === key) return { status: "current", reason: "", blob, hasPhoto };
  const nonce = force ? `${key}-${Date.now().toString(36)}` : key;
  let response = null;
  try {
    if (hasPhoto) {
      response = await fetch(`${workerBase()}/media/office-share-card`, {
        method: "POST",
        headers: { "Content-Type": "image/png", Authorization: `Bearer ${await idToken()}`, "X-Office-Id": session.officeId, "X-Public-Slug": office.publicSlug, "X-Share-Card-Version": nonce },
        body: blob
      });
    }
  } catch (_) {
    return { status: "failed", reason: "تعذر الاتصال بالخادم عند رفع الصورة", blob, hasPhoto };
  }
  if (response && !response.ok) {
    const payload = await response.json().catch(() => ({}));
    return { status: "failed", reason: `رفض الخادم رفع الصورة (${response.status}${payload.error ? ` · ${payload.error}` : ""})`, blob, hasPhoto };
  }
  try {
    const patch = { shareCardNonce: nonce, sharePhoto: hasPhoto, updatedAt: stamp() };
    await Promise.all([
      db().collection("offices").doc(session.officeId).set(patch, { merge: true }),
      db().collection("publicOffices").doc(session.officeId).set(patch, { merge: true })
    ]);
  } catch (_) {
    return { status: "failed", reason: "رُفعت الصورة لكن تعذر حفظ نسختها", blob, hasPhoto };
  }
  office.shareCardNonce = nonce;
  return { status: "uploaded", reason: "", blob, hasPhoto };
}
