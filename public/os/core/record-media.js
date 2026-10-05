/**
 * Property photos — browser side: resize/compress a chosen photo, upload it, and save the
 * arrangement (first = main photo). The Worker re-checks type, size, membership and office.
 */

import { ApiError, api, idToken, workerBase } from "./runtime.js";
import { session } from "./session.js";
import {
  IMAGE_LONG_EDGE, IMAGE_MESSAGES, IMAGE_QUALITIES, IMAGE_TARGET_BYTES, MAX_IMAGE_UPLOAD_BYTES, checkImageFile, fitWithin
} from "../domain/record-media-domain.js";

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality));
}

/**
 * Chosen file → JPEG blob no longer than 1600px on its long edge, stepped down in quality
 * until it is light enough for mobile data while still looking sharp on a phone.
 * Returns { blob, width, height }.
 */
export async function prepareImage(file) {
  const checked = checkImageFile(file);
  if (!checked.ok) throw new ApiError(checked.message);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (_) {
    try { bitmap = await createImageBitmap(file); } catch (__) { throw new ApiError(IMAGE_MESSAGES.unreadable); }
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, IMAGE_LONG_EDGE);
  if (!width || !height) throw new ApiError(IMAGE_MESSAGES.unreadable);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  let best = null;
  for (const quality of IMAGE_QUALITIES) {
    const blob = await canvasToBlob(canvas, quality);
    if (!blob) continue;
    best = blob;
    if (blob.size <= IMAGE_TARGET_BYTES) break;
  }
  if (!best || best.size > MAX_IMAGE_UPLOAD_BYTES) throw new ApiError(IMAGE_MESSAGES.tooLarge);
  return { blob: best, width, height };
}

/** Upload one prepared photo to an offer of this office. Returns the stored image entry. */
export async function uploadRecordImage(recordId, blob) {
  let response;
  try {
    response = await fetch(`${workerBase()}/media/record-image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await idToken()}`, "X-Office-Id": session.officeId, "X-Record-Id": recordId, "Content-Type": blob.type || "image/jpeg" },
      body: blob
    });
  } catch (_) {
    throw new ApiError("تعذر الاتصال بالخادم — تحقق من الإنترنت وحاول مجددًا", { code: "network" });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new ApiError(body.message || "تعذر رفع الصورة", { code: body.error, status: response.status });
  return body.image;
}

/** Save which photos stay and in what order (ids; first = main photo). */
export function arrangeRecordImages(recordId, order, remove = []) {
  return api("/os/records/media", { officeId: session.officeId, recordId, order, remove });
}

/** Public office link: a visitor's photo goes to the intake folder of that office (rate-limited by the Worker). */
export async function uploadIntakeImage({ officeId, intakeId, index, blob }) {
  let response;
  try {
    response = await fetch(`${workerBase()}/media/public-intake`, {
      method: "POST",
      headers: { "X-Office-Id": officeId, "X-Intake-Id": intakeId, "X-Media-Kind": "image", "X-Media-Index": String(index), "Content-Type": blob.type || "image/jpeg" },
      body: blob
    });
  } catch (_) {
    throw new ApiError("تعذر رفع الصورة — تحقق من الإنترنت وحاول مجددًا", { code: "network" });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok || !body.mediaPath) throw new ApiError(body.message || "تعذر رفع الصورة", { code: body.error, status: response.status });
  return body.mediaPath;
}
