/** Builds the office share card image (broker photo + trusted data) and publishes it for the link preview. */

import { db, idToken, workerBase } from "./runtime.js";
import { session } from "./session.js";
import { SHARE_CARD, shareCardKey, shareCardLines } from "../domain/share-card-domain.js";
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

export async function drawShareCard(office) {
  await document.fonts?.ready?.catch(() => {});
  const { width, height } = SHARE_CARD;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  const font = "Tajawal, system-ui, sans-serif";
  ctx.direction = "rtl";
  ctx.fillStyle = "#EDF5F7"; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#fff"; roundRect(ctx, 36, 36, width - 72, height - 72, 36); ctx.fill();
  ctx.strokeStyle = "#DCE8EB"; ctx.lineWidth = 3; ctx.stroke();

  // Avatar (right side): the broker's photo, otherwise the platform mark.
  const cx = 930, cy = 255, radius = 150;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
  ctx.fillStyle = "#fff"; ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  const photo = isSafePhotoDataUrl(office.brokerPhotoUrl) ? await loadImage(office.brokerPhotoUrl) : null;
  if (photo) ctx.drawImage(photo, cx - radius, cy - radius, radius * 2, radius * 2);
  else {
    const logo = await loadImage("/icons/iaqar-default-icon-512.png");
    if (logo) ctx.drawImage(logo, cx - 105, cy - 105, 210, 210);
  }
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.strokeStyle = "#03677A"; ctx.lineWidth = 8; ctx.stroke();

  // Text column.
  const lines = shareCardLines(office);
  const right = 760; ctx.textAlign = "right";
  ctx.fillStyle = "#082F3A"; ctx.font = `800 56px ${font}`;
  ctx.fillText(lines.name, right, 150, 640);
  let y = 225; ctx.font = `700 34px ${font}`;
  if (lines.broker) { ctx.fillStyle = "#082F3A"; ctx.fillText(lines.broker, right, y, 640); y += 56; }
  ctx.fillStyle = "#03677A";
  for (const line of lines.license) { ctx.fillText(line, right, y, 640); y += 56; }
  if (lines.city) { ctx.fillStyle = "#4d6a72"; ctx.font = `600 32px ${font}`; ctx.fillText(lines.city, right, y, 640); }

  // Call to action + platform brand.
  ctx.fillStyle = "#03677A"; roundRect(ctx, 96, 410, 1008, 84, 24); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = `800 34px ${font}`;
  ctx.fillText("أرسل عرضك أو طلبك العقاري مباشرة للمكتب", width / 2, 465);
  ctx.textAlign = "right"; ctx.fillStyle = "#03677A"; ctx.font = `800 28px ${font}`;
  ctx.fillText("مكاتب عقارية ذكية", 1090, 560);
  const brand = await loadImage("/icons/iaqar-default-icon-192.png");
  if (brand) ctx.drawImage(brand, 1100, 520, 56, 56);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("BLOB_FAILED"))), "image/png"));
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
    blob = await drawShareCard(office);
  } catch (_) {
    return { status: "failed", reason: "تعذر رسم البطاقة" };
  }
  if (!force && office.shareCardNonce && office.shareCardNonce.split("-")[0] === key) return { status: "current", reason: "", blob };
  const nonce = force ? `${key}-${Date.now().toString(36)}` : key;
  let response;
  try {
    response = await fetch(`${workerBase()}/media/office-share-card`, {
      method: "POST",
      headers: { "Content-Type": "image/png", Authorization: `Bearer ${await idToken()}`, "X-Office-Id": session.officeId, "X-Public-Slug": office.publicSlug, "X-Share-Card-Version": nonce },
      body: blob
    });
  } catch (_) {
    return { status: "failed", reason: "تعذر الاتصال بالخادم عند رفع البطاقة", blob };
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    return { status: "failed", reason: `رفض الخادم رفع البطاقة (${response.status}${payload.error ? ` · ${payload.error}` : ""})`, blob };
  }
  try {
    const patch = { shareCardNonce: nonce, updatedAt: stamp() };
    await Promise.all([
      db().collection("offices").doc(session.officeId).set(patch, { merge: true }),
      db().collection("publicOffices").doc(session.officeId).set(patch, { merge: true })
    ]);
  } catch (_) {
    return { status: "failed", reason: "رُفعت البطاقة لكن تعذر حفظ نسختها", blob };
  }
  office.shareCardNonce = nonce;
  return { status: "uploaded", reason: "", blob };
}
