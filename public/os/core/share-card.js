/** Publishes an immutable JPEG preview card for the office share URL (WhatsApp/Open Graph). */

import { db, idToken, workerBase } from "./runtime.js";
import { session } from "./session.js";
import { SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT, nonceKey, previewVersion, shareCardKey } from "../domain/share-card-domain.js";
import { isSafePhotoDataUrl } from "../domain/avatar-domain.js";

const stamp = () => window.firebase.firestore.FieldValue.serverTimestamp();
const SHARE_PREVIEW_FORMAT = "immutable-v2";

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawFallbackMark(context, x, y, w, h) {
  context.fillStyle = "#DDEFF2";
  context.fillRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h / 2 - 22;
  context.strokeStyle = "#03677A";
  context.lineWidth = 24;
  context.beginPath();
  context.arc(cx, cy, 105, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(cx - 56, cy + 82);
  context.lineTo(cx, cy + 155);
  context.lineTo(cx + 56, cy + 82);
  context.stroke();
  context.fillStyle = "#03677A";
  context.fillRect(cx - 48, cy - 35, 96, 88);
  context.fillStyle = "#EDF5F7";
  context.fillRect(cx - 15, cy + 8, 30, 45);
}

/**
 * Draws the complete 1200×630 immutable share card.
 * The broker photo is rectangular when present. Without one, a branded fallback is drawn,
 * so every published preview is a real JPEG and never depends on another image host.
 */
export async function drawSharePhoto(office) {
  const W = SHARE_CARD_WIDTH, H = SHARE_CARD_HEIGHT;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const context = canvas.getContext("2d");
  context.fillStyle = "#EDF5F7";
  context.fillRect(0, 0, W, H);
  context.fillStyle = "#099FB4";
  context.fillRect(0, 0, 14, H);

  const mediaW = 500;
  const mediaX = W - mediaW;
  let photo = null;
  if (isSafePhotoDataUrl(office.brokerPhotoUrl)) {
    photo = await loadImage(office.brokerPhotoUrl);
  }
  if (photo) {
    const targetRatio = mediaW / H;
    const sourceRatio = photo.width / photo.height;
    let sx = 0, sy = 0, sw = photo.width, sh = photo.height;
    if (sourceRatio > targetRatio) {
      sw = photo.height * targetRatio;
      sx = (photo.width - sw) / 2;
    } else {
      sh = photo.width / targetRatio;
      sy = (photo.height - sh) / 2;
    }
    context.drawImage(photo, sx, sy, sw, sh, mediaX, 0, mediaW, H);
  } else {
    drawFallbackMark(context, mediaX, 0, mediaW, H);
  }

  const name = String(office.name || office.officeName || "مكتب عقاري").trim().slice(0, 44);
  const city = String(office.city || "").trim().slice(0, 40);
  const license = String(office.licenseNumber || "").replace(/[^0-9]/g, "").slice(0, 24);
  context.direction = "rtl";
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.fillStyle = "#082F3A";
  context.font = "700 74px Tahoma, Arial, sans-serif";
  context.fillText(name, mediaX - 58, 230, mediaX - 100);
  context.fillStyle = "#03677A";
  context.font = "500 37px Tahoma, Arial, sans-serif";
  context.fillText(city ? `مكتب عقاري · ${city}` : "مكتب عقاري", mediaX - 58, 322, mediaX - 100);
  if (license) {
    context.fillStyle = "#506D75";
    context.font = "400 31px Tahoma, Arial, sans-serif";
    context.fillText(`رخصة فال: ${license}`, mediaX - 58, 390, mediaX - 100);
  }

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.84));
}

/**
 * Publishes one immutable card per preview version. A forced refresh creates a new version.
 * Old versions are intentionally preserved so an already-shared WhatsApp URL never changes underneath.
 */
export async function ensureShareCard({ force = false } = {}) {
  const office = session.office || {};
  if (!session.isManager || !session.officeId) return { status: "failed", reason: "يلزم مدير المكتب" };
  if (!office.publicSlug) return { status: "failed", reason: "اضبط معرّف الرابط القصير أولًا" };

  const key = shareCardKey(office);
  const alreadyCurrent = !force
    && office.sharePreviewFormat === SHARE_PREVIEW_FORMAT
    && office.shareCardNonce
    && nonceKey(office.shareCardNonce) === key;

  let blob = null;
  try {
    blob = await drawSharePhoto(office);
  } catch (_) {
    return { status: "failed", reason: "تعذر تجهيز الصورة" };
  }
  if (!blob) return { status: "failed", reason: "تعذر تجهيز الصورة" };

  const hasPhoto = isSafePhotoDataUrl(office.brokerPhotoUrl);
  if (alreadyCurrent) {
    return { status: "current", reason: "", blob, hasPhoto, previewVersion: previewVersion(office.shareCardNonce) };
  }

  const nonce = previewVersion(force ? `${key}-${Date.now().toString(36)}` : key);
  let response;
  try {
    response = await fetch(`${workerBase()}/media/office-share-card`, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        Authorization: `Bearer ${await idToken()}`,
        "X-Office-Id": session.officeId,
        "X-Public-Slug": office.publicSlug,
        "X-Share-Card-Version": nonce
      },
      body: blob
    });
  } catch (_) {
    return { status: "failed", reason: "تعذر الاتصال بالخادم عند رفع الصورة", blob, hasPhoto };
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    return { status: "failed", reason: `رفض الخادم رفع الصورة (${response.status}${payload.error ? ` · ${payload.error}` : ""})`, blob, hasPhoto };
  }

  try {
    const patch = {
      shareCardNonce: nonce,
      sharePhoto: hasPhoto,
      sharePreviewFormat: SHARE_PREVIEW_FORMAT,
      updatedAt: stamp()
    };
    await Promise.all([
      db().collection("offices").doc(session.officeId).set(patch, { merge: true }),
      db().collection("publicOffices").doc(session.officeId).set(patch, { merge: true })
    ]);
  } catch (_) {
    return { status: "failed", reason: "رُفعت الصورة لكن تعذر حفظ نسختها", blob, hasPhoto };
  }

  office.shareCardNonce = nonce;
  office.sharePhoto = hasPhoto;
  office.sharePreviewFormat = SHARE_PREVIEW_FORMAT;
  return { status: "uploaded", reason: "", blob, hasPhoto, previewVersion: nonce };
}
