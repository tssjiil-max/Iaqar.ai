/**
 * Listing image validation + analysis-only resize (original bytes preserved elsewhere).
 */

export const ALLOWED_IMAGE_MIMES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

export const ANALYSIS_IMAGE_MAX_LONG_EDGE = 2200;
export const ANALYSIS_JPEG_QUALITY = 0.9;

function u8(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
}

export function validateImageMagicBytes(bytes, mimeType = "") {
  const data = u8(bytes);
  if (!data.length) return false;
  const mime = String(mimeType || "").toLowerCase();
  if (mime === "image/jpeg") {
    return data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF;
  }
  if (mime === "image/png") {
    return data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47;
  }
  if (mime === "image/webp") {
    return data.length >= 12
      && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
      && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50;
  }
  return false;
}

export function validateListingImageBytes(bytes, mimeType = "") {
  const mime = String(mimeType || "").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_IMAGE_MIMES.includes(mime)) {
    return { ok: false, error: "unsupported_media" };
  }
  const data = u8(bytes);
  if (!data.length) return { ok: false, error: "empty_image" };
  if (!validateImageMagicBytes(data, mime)) {
    return { ok: false, error: "invalid_image" };
  }
  return { ok: true, mimeType: mime, byteSize: data.length };
}

export async function prepareListingImageForAnalysis(bytes, mimeType = "") {
  const validation = validateListingImageBytes(bytes, mimeType);
  if (!validation.ok) return validation;
  const originalBytes = u8(bytes);

  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
    return {
      ok: true,
      originalBytes,
      analysisBytes: originalBytes,
      analysisMimeType: validation.mimeType,
      resized: false
    };
  }

  try {
    const blob = new Blob([originalBytes], { type: validation.mimeType });
    const bitmap = await createImageBitmap(blob);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    let targetW = bitmap.width;
    let targetH = bitmap.height;
    if (longEdge > ANALYSIS_IMAGE_MAX_LONG_EDGE) {
      const scale = ANALYSIS_IMAGE_MAX_LONG_EDGE / longEdge;
      targetW = Math.max(1, Math.round(bitmap.width * scale));
      targetH = Math.max(1, Math.round(bitmap.height * scale));
    }
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return {
        ok: true,
        originalBytes,
        analysisBytes: originalBytes,
        analysisMimeType: validation.mimeType,
        resized: false
      };
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close?.();
    const analysisBlob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: ANALYSIS_JPEG_QUALITY
    });
    const analysisBytes = new Uint8Array(await analysisBlob.arrayBuffer());
    return {
      ok: true,
      originalBytes,
      analysisBytes,
      analysisMimeType: "image/jpeg",
      resized: targetW !== bitmap.width || targetH !== bitmap.height
    };
  } catch {
    return {
      ok: true,
      originalBytes,
      analysisBytes: originalBytes,
      analysisMimeType: validation.mimeType,
      resized: false
    };
  }
}

export const __test = {
  validateImageMagicBytes,
  validateListingImageBytes,
  prepareListingImageForAnalysis
};
