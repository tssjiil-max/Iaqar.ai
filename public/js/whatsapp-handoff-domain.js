/**
 * Unified WhatsApp handoff — always open an external https://wa.me URL.
 * Never assign whatsapp:// or relative URLs to location.href (that navigates
 * the iaqar.ai SPA instead of WhatsApp).
 */

import { whatsappDigits } from "./messaging-domain.js";

const WHATSAPP_HTTP_RE = /^https:\/\/(wa\.me|api\.whatsapp\.com)\//i;

export function isMobileWhatsAppDevice(userAgent = "") {
  const ua = String(userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : ""));
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export function isSafeWhatsAppHttpUrl(url = "") {
  return WHATSAPP_HTTP_RE.test(String(url || "").trim());
}

export function buildWhatsAppWebUrl({ phone = "", text = "" } = {}) {
  const digits = whatsappDigits(phone);
  const encoded = encodeURIComponent(String(text || ""));
  if (digits) return `https://wa.me/${digits}?text=${encoded}`;
  return `https://wa.me/?text=${encoded}`;
}

/** Kept for tests / diagnostics. Opening must not use this scheme. */
export function buildWhatsAppAppUrl({ phone = "", text = "" } = {}) {
  const digits = whatsappDigits(phone);
  const params = new URLSearchParams();
  if (digits) params.set("phone", digits);
  if (String(text || "").trim()) params.set("text", String(text));
  return `whatsapp://send?${params.toString()}`;
}

export function parseWhatsAppWebUrl(url = "") {
  const raw = String(url || "").trim();
  if (!raw.includes("wa.me") && !/api\.whatsapp\.com/i.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (!isSafeWhatsAppHttpUrl(parsed.href)) return null;
    const pathDigits = parsed.pathname.replace(/^\//, "").split("/")[0] || "";
    const phoneParam = parsed.searchParams.get("phone") || "";
    const phone = /^\d+$/.test(pathDigits) ? pathDigits : (whatsappDigits(phoneParam) || "");
    const text = parsed.searchParams.get("text") || "";
    return { phone, text };
  } catch {
    const phoneMatch = raw.match(/wa\.me\/(\d+)/);
    const textMatch = raw.match(/[?&]text=([^&]+)/);
    return {
      phone: phoneMatch?.[1] || "",
      text: textMatch ? decodeURIComponent(textMatch[1]) : ""
    };
  }
}

export function viewingDateTimeParts(value) {
  if (value == null || value === "") return { date: "", time: "" };
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  return {
    date: date.toLocaleDateString("ar-SA", {
      timeZone: "Asia/Riyadh",
      year: "numeric",
      month: "long",
      day: "numeric"
    }),
    time: date.toLocaleTimeString("ar-SA", {
      timeZone: "Asia/Riyadh",
      hour: "numeric",
      minute: "2-digit"
    })
  };
}

export function viewingAppointmentWhatsAppText(viewingAt) {
  const { date, time } = viewingDateTimeParts(viewingAt);
  if (!date || !time) return "";
  return `السلام عليكم، تم تحديد موعد معاينة العقار بتاريخ ${date} الساعة ${time}.`;
}

export function ownerRequestWhatsAppText({ items = [], note = "" } = {}) {
  const labels = [];
  const map = {
    photos: "صور العقار",
    location: "موقع العقار",
    propertyLink: "رابط العقار"
  };
  for (const item of items) {
    const label = map[item];
    if (label && !labels.includes(label)) labels.push(label);
  }
  if (!labels.length) return "";
  const joined = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(" و")} و${labels[labels.length - 1]}`;
  let text = `السلام عليكم، نحتاج ${joined} لاستكمال بيانات العرض.`;
  const extra = String(note || "").trim();
  if (extra) text += `\n${extra}`;
  return text;
}

function openExternalWhatsAppHttp(url) {
  const href = String(url || "").trim();
  if (!isSafeWhatsAppHttpUrl(href)) return false;
  if (typeof window === "undefined") return false;
  try {
    const popup = window.open(href, "_blank", "noopener,noreferrer");
    if (popup) return true;
  } catch (_) { /* popup blocked */ }
  try {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.referrerPolicy = "no-referrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch (_) { /* ignore */ }
  return false;
}

/**
 * Open WhatsApp to a specific contact. Requires a valid Saudi phone.
 * Always uses https://wa.me — never location.href or whatsapp://.
 */
export function openWhatsApp({ phone = "", text = "", userAgent } = {}) {
  const digits = whatsappDigits(phone);
  const url = buildWhatsAppWebUrl({ phone: digits, text });
  if (!isSafeWhatsAppHttpUrl(url)) {
    return { ok: false, reason: "invalid_phone", url: "", opened: false };
  }
  const opened = openExternalWhatsAppHttp(url);
  return {
    ok: opened,
    opened,
    mode: isMobileWhatsAppDevice(userAgent) ? "https_mobile" : "https_web",
    url
  };
}

/** Re-open an existing wa.me target. Ignores relative / same-origin URLs. */
export function openWhatsAppUrl(url, overrides = {}) {
  const parsed = parseWhatsAppWebUrl(url);
  const phone = overrides.phone || parsed?.phone || "";
  const text = overrides.text ?? parsed?.text ?? "";
  if (whatsappDigits(phone)) {
    return openWhatsApp({
      phone,
      text,
      userAgent: overrides.userAgent
    });
  }
  return {
    ok: false,
    reason: "invalid_whatsapp_url",
    url: String(url || ""),
    opened: false
  };
}
