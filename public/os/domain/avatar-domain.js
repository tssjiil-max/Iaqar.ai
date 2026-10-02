/** Broker photo rules — pure and shared by the settings form and the office card. */

export const PHOTO_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
export const MAX_PHOTO_INPUT_BYTES = 8 * 1024 * 1024;
export const PHOTO_SIZE = 256;
export const MAX_PHOTO_DATA_CHARS = 70000;

export const PHOTO_MESSAGES = Object.freeze({
  type: "اختر صورة بصيغة JPG أو PNG أو WEBP فقط.",
  size: "الصورة كبيرة جدًا — اختر صورة أصغر من 8 ميجابايت.",
  unreadable: "تعذر قراءة الصورة — اختر صورة أخرى.",
  tooLarge: "تعذر تصغير الصورة بما يكفي — اختر صورة أبسط."
});

export function checkPhotoFile(file) {
  if (!file || !PHOTO_TYPES.includes(String(file.type || "").toLowerCase())) return { ok: false, message: PHOTO_MESSAGES.type };
  if (Number(file.size || 0) > MAX_PHOTO_INPUT_BYTES) return { ok: false, message: PHOTO_MESSAGES.size };
  return { ok: true };
}

/** Only a small inline JPEG we produced ourselves is ever stored or displayed. */
export function isSafePhotoDataUrl(value) {
  const text = String(value || "");
  return text.length > 0 && text.length <= MAX_PHOTO_DATA_CHARS && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(text);
}

/** Centre-crop square geometry for a source of w×h. */
export function squareCrop(width, height) {
  const side = Math.min(Number(width) || 0, Number(height) || 0);
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}
