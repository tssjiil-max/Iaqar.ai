/**
 * Conservative broker-visible display normalization.
 * Never mutates stored Firestore values — display layer only.
 */

const GARBAGE_EXACT = new Set([
  "ms", "dd", "dd dd", "ii", "ا ب", "ا", "ب"
]);

const GARBAGE_RE = [
  /^ms$/i,
  /^dd\s*dd$/i,
  /^ii$/i,
  /^سلمى\s*ii$/i,
  /^[a-z]{1,2}$/i
];

function safeTrim(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

/** Strip internal test tags (ctx_*, ctxfix_*) and stray Latin tokens from broker-visible Arabic fields. */
export function stripTechnicalDisplayNoise(value = "") {
  let text = safeTrim(value, 500);
  if (!text) return "";

  text = text
    .replace(/(?:^|[\s_]+)(?:ctxfix|ctx)[a-z0-9_]*/gi, "")
    .replace(/_[a-z][a-z0-9]{3,}/gi, "")
    .replace(/^[a-z][a-z0-9]{3,}_/gi, "")
    .replace(/_{2,}/g, "_")
    .replace(/^[_\s]+|[_\s]+$/g, "")
    .trim();

  if (/[a-zA-Z]{2,}/.test(text)) {
    const arabicOnly = text
      .replace(/[a-zA-Z]+/g, "")
      .replace(/[_\s]+/g, " ")
      .trim();
    text = arabicOnly || text;
  }

  text = text
    .replace(/^حي[_\s]+/u, "حي ")
    .replace(/^حي\s+حي\s+/u, "حي ")
    .trim();

  if (/^حي$/u.test(text)) return "";

  return safeTrim(text);
}

export function isUntrustedDisplayValue(value = "") {
  const raw = safeTrim(value);
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (GARBAGE_EXACT.has(lower) || GARBAGE_EXACT.has(raw)) return true;
  if (raw.length <= 2 && !/^\d+$/.test(raw)) return true;
  if (/^(?:[\u0621-\u064A]\s+){1,4}[\u0621-\u064A]$/.test(raw)) return true;
  return GARBAGE_RE.some((re) => re.test(raw));
}

export function sanitizeDisplayField(value = "") {
  const raw = safeTrim(stripTechnicalDisplayNoise(value));
  if (!raw) return { display: "", needsReview: false, raw: "" };
  if (isUntrustedDisplayValue(raw)) {
    return { display: "تحتاج مراجعة", needsReview: true, raw };
  }
  return { display: raw, needsReview: false, raw };
}

/** Avoid "حي حي الرانوناء" when district already includes the prefix. */
export function formatDistrictLabel(value = "") {
  const cleaned = sanitizeDisplayField(value);
  if (!cleaned.display || cleaned.needsReview) return cleaned.display;
  const raw = cleaned.raw;
  if (/^حي[\s\u200f\u200e]/i.test(raw) || /^حي$/i.test(raw.trim())) return raw;
  return `حي ${raw}`;
}

export function formatLocationLine(city = "", district = "") {
  const cityPart = sanitizeDisplayField(city).display;
  const districtPart = formatDistrictLabel(district);
  if (cityPart && districtPart) return `${cityPart} — ${districtPart}`;
  return cityPart || districtPart || "";
}

export function normalizePropertyTypeDisplay(value = "") {
  const cleaned = sanitizeDisplayField(value);
  if (cleaned.needsReview) return cleaned.display;
  const raw = cleaned.raw;
  const lower = raw.toLowerCase().trim();
  if (lower === "office") return "مكتب";
  if (lower === "office للبيع" || lower === "office for sale") return "مكتب للبيع";
  return raw;
}
