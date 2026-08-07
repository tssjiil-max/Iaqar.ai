// Pure domain logic for office visual identity. No DOM or network access.

export const ACCEPTED_IMAGE_TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
});
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const OFFICE_IMAGE_PRESETS = Object.freeze({
  logo: Object.freeze({
    variant: "logo",
    label: "شعار المكتب أو صورته الرسمية",
    aspectRatio: 1,
    outputWidth: 512,
    outputHeight: 512,
    outputType: "image/png",
    outputQuality: 1,
    removable: true
  })
});

export const OFFICE_IMAGE_VARIANTS = Object.freeze(Object.keys(OFFICE_IMAGE_PRESETS));

export const OFFICE_IMAGE_MESSAGES = Object.freeze({
  type: "اختر صورة JPG أو PNG أو WebP",
  size: "حجم الصورة يتجاوز 10 ميجابايت",
  missing: "لم يتم اختيار صورة",
  failed: "تعذر تجهيز الصورة، حاول مرة أخرى",
  uploading: "جارٍ رفع الصورة…",
  uploaded: "تم رفع الصورة",
  removing: "جارٍ إزالة الصورة…",
  removed: "تمت إزالة الصورة"
});

export function imagePreset(variant) {
  return OFFICE_IMAGE_PRESETS[variant] || null;
}

export function officeImageStorageKey(officeId, variant) {
  const preset = imagePreset(variant);
  const safeOfficeId = String(officeId || "").trim().toLowerCase();
  if (!preset || !/^[a-z0-9_-]{1,80}$/.test(safeOfficeId)) return "";
  return `office-covers/${safeOfficeId}/${preset.variant}`;
}

export function officeImageOriginalKey(officeId) {
  const safeOfficeId = String(officeId || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,80}$/.test(safeOfficeId)) return "";
  return `office-covers/${safeOfficeId}/logo-original`;
}

/** Returns "" when the file is acceptable, otherwise an Arabic message. */
export function validateImageFile(file) {
  if (!file) return OFFICE_IMAGE_MESSAGES.missing;
  if (!ACCEPTED_IMAGE_TYPES[String(file.type || "").toLowerCase()]) {
    return OFFICE_IMAGE_MESSAGES.type;
  }
  if (Number(file.size || 0) > MAX_IMAGE_BYTES) return OFFICE_IMAGE_MESSAGES.size;
  return "";
}

/**
 * Largest source rectangle matching `aspectRatio`, positioned by `offsetX`/`offsetY`
 * (0 = start, 0.5 = centred, 1 = end). `zoom` > 1 crops a smaller region (zoom in).
 */
export function cropRectForAspect({
  naturalWidth,
  naturalHeight,
  aspectRatio,
  offsetX = 0.5,
  offsetY = 0.5,
  zoom = 1
} = {}) {
  const width = Math.floor(Number(naturalWidth) || 0);
  const height = Math.floor(Number(naturalHeight) || 0);
  const ratio = Number(aspectRatio);
  const zoomFactor = Math.max(1, Number(zoom) || 1);
  if (width <= 0 || height <= 0 || !(ratio > 0)) return null;

  let sourceWidth = width;
  let sourceHeight = Math.round(width / ratio);
  if (sourceHeight > height) {
    sourceHeight = height;
    sourceWidth = Math.round(height * ratio);
  }
  sourceWidth = Math.min(Math.round(sourceWidth / zoomFactor), width);
  sourceHeight = Math.min(Math.round(sourceHeight / zoomFactor), height);

  const clamp = value => Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0.5));
  return {
    sourceX: Math.round((width - sourceWidth) * clamp(offsetX)),
    sourceY: Math.round((height - sourceHeight) * clamp(offsetY)),
    sourceWidth,
    sourceHeight
  };
}
