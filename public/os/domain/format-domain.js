/**
 * Formatting helpers shared by the office UI, the reply page and the Worker
 * (message text). Pure, no DOM. Western digits are used for prices, areas and
 * phones so numbers stay unambiguous inside Arabic sentences.
 */

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function cleanText(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const ascii = String(value)
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[,،\s]/g, "")
    .replace(/[^\d.]/g, "");
  const parsed = Number(ascii);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatNumber(value) {
  const n = toNumber(value);
  return n ? NUMBER.format(n) : "";
}

export function formatPrice(value) {
  const text = formatNumber(value);
  return text ? `${text} ريال` : "";
}

export function formatArea(value) {
  const text = formatNumber(value);
  return text ? `${text} م²` : "";
}

/** Saudi mobile → international digits for wa.me (9665XXXXXXXX), or "". */
export function whatsappDigits(phone) {
  const digits = String(phone ?? "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");
  if (/^9665\d{8}$/.test(digits)) return digits;
  if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `966${digits}`;
  if (/^009665\d{8}$/.test(digits)) return digits.slice(2);
  return "";
}

/** Local display form 05XXXXXXXX, or "" when not a Saudi mobile. */
export function localPhone(phone) {
  const intl = whatsappDigits(phone);
  return intl ? `0${intl.slice(3)}` : "";
}

export function buildWhatsAppUrl(phone, text) {
  const digits = whatsappDigits(phone);
  if (!digits) return "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(String(text || ""))}`;
}

const AR_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** Riyadh wall-clock parts for an instant (the office timezone). */
function riyadhParts(date) {
  const shifted = new Date(date.getTime() + 3 * 3600 * 1000);
  return {
    y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate(),
    wd: shifted.getUTCDay(), h: shifted.getUTCHours(), min: shifted.getUTCMinutes()
  };
}

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "object" && typeof value.toDate === "function") return value.toDate();
  if (typeof value === "object" && Number.isFinite(value.seconds)) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatTime(value) {
  const date = toDate(value);
  if (!date) return "";
  const p = riyadhParts(date);
  const hour12 = p.h % 12 === 0 ? 12 : p.h % 12;
  const suffix = p.h < 12 ? "ص" : "م";
  return `${hour12}:${String(p.min).padStart(2, "0")} ${suffix}`;
}

/** "اليوم" / "غدًا" / "أمس" / "الأحد 26 أبريل" relative to `now`. */
export function formatDay(value, now = new Date()) {
  const date = toDate(value);
  if (!date) return "";
  const a = riyadhParts(date);
  const b = riyadhParts(now);
  const dayA = Date.UTC(a.y, a.m, a.d);
  const dayB = Date.UTC(b.y, b.m, b.d);
  const diff = Math.round((dayA - dayB) / 86400000);
  if (diff === 0) return "اليوم";
  if (diff === 1) return "غدًا";
  if (diff === -1) return "أمس";
  const base = `${AR_DAYS[a.wd]} ${a.d} ${AR_MONTHS[a.m]}`;
  return a.y === b.y ? base : `${base} ${a.y}`;
}

export function formatDateTime(value, now = new Date()) {
  const day = formatDay(value, now);
  const time = formatTime(value);
  return day && time ? `${day} · ${time}` : day || time;
}

export function relativeAgo(value, now = new Date()) {
  const date = toDate(value);
  if (!date) return "";
  const minutes = Math.round((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return minutes === 1 ? "قبل دقيقة" : minutes === 2 ? "قبل دقيقتين" : minutes <= 10 ? `قبل ${minutes} دقائق` : `قبل ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "قبل ساعة" : hours === 2 ? "قبل ساعتين" : hours <= 10 ? `قبل ${hours} ساعات` : `قبل ${hours} ساعة`;
  return formatDateTime(date, now);
}

/** Parse a <input type="datetime-local"> value as Riyadh wall-clock time. */
export function parseRiyadhLocal(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, h - 3, min));
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Instant → "YYYY-MM-DDTHH:MM" in Riyadh wall-clock time (for datetime-local). */
export function toRiyadhLocalInput(value) {
  const date = toDate(value);
  if (!date) return "";
  const p = riyadhParts(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`;
}

export function isSameRiyadhDay(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  if (!da || !db) return false;
  const pa = riyadhParts(da);
  const pb = riyadhParts(db);
  return pa.y === pb.y && pa.m === pb.m && pa.d === pb.d;
}
