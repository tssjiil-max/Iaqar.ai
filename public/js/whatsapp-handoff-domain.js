/**
 * Unified WhatsApp handoff.
 * Never assign whatsapp:// or relative URLs to location.href (that navigates
 * the iaqar.ai SPA instead of WhatsApp).
 * On phones, open the WhatsApp app scheme via an in-page <a> click so the
 * browser does not land on api.whatsapp.com and ask to continue.
 * Desktop still uses https://wa.me in a new tab.
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

function clickHiddenAnchor(href, { target = "" } = {}) {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return false;
  }
  try {
    const anchor = document.createElement("a");
    anchor.href = String(href || "");
    if (typeof anchor.setAttribute === "function") {
      anchor.setAttribute("data-iaqar-whatsapp-direct", "1");
    }
    if (target) {
      anchor.target = target;
      anchor.rel = "noopener noreferrer";
    }
    anchor.referrerPolicy = "no-referrer";
    if (anchor.style) anchor.style.display = "none";
    const parent = document.body || document.documentElement;
    if (parent && typeof parent.appendChild === "function") parent.appendChild(anchor);
    anchor.click();
    if (typeof anchor.remove === "function") anchor.remove();
    else if (parent && typeof parent.removeChild === "function") parent.removeChild(anchor);
    return true;
  } catch (_) {
    return false;
  }
}

function openExternalWhatsAppHttp(url) {
  const href = String(url || "").trim();
  if (!isSafeWhatsAppHttpUrl(href)) return false;
  if (typeof window === "undefined") return false;
  try {
    const popup = window.open(href, "_blank", "noopener,noreferrer");
    if (popup) return true;
  } catch (_) { /* popup blocked */ }
  return clickHiddenAnchor(href, { target: "_blank" });
}

export function resolveWhatsAppOpenPlan({ phone = "", text = "", userAgent } = {}) {
  const digits = whatsappDigits(phone);
  const webUrl = buildWhatsAppWebUrl({ phone: digits, text });
  const appUrl = buildWhatsAppAppUrl({ phone: digits, text });
  if (isMobileWhatsAppDevice(userAgent)) {
    return { mode: "app_scheme", href: appUrl, webUrl };
  }
  return { mode: "https_web", href: webUrl, webUrl };
}

/**
 * Open WhatsApp to a specific contact.
 * Phones: whatsapp:// via an <a> click (same page, no api.whatsapp.com tab).
 * Desktop: https://wa.me in a new tab.
 * Never writes location.href.
 */
export function openWhatsApp({ phone = "", text = "", userAgent } = {}) {
  const plan = resolveWhatsAppOpenPlan({ phone, text, userAgent });
  if (plan.mode === "app_scheme") {
    const opened = clickHiddenAnchor(plan.href);
    return {
      ok: opened,
      opened,
      mode: "app_scheme",
      url: plan.href,
      webUrl: plan.webUrl
    };
  }
  if (!isSafeWhatsAppHttpUrl(plan.href)) {
    return { ok: false, reason: "invalid_phone", url: "", opened: false };
  }
  const opened = openExternalWhatsAppHttp(plan.href);
  return {
    ok: opened,
    opened,
    mode: "https_web",
    url: plan.href,
    webUrl: plan.webUrl
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

/** Turn leftover wa.me / api.whatsapp.com <a> clicks into the same opener. */
export function handleWhatsAppWebAnchorClick(event, overrides = {}) {
  const target = event && event.target;
  const closest = target && typeof target.closest === "function" ? target.closest.bind(target) : null;
  const anchor = closest ? closest("a[href]") : null;
  if (!anchor) return false;
  if (anchor.getAttribute && anchor.getAttribute("data-iaqar-whatsapp-direct") === "1") {
    return false;
  }
  const href = (anchor.getAttribute && anchor.getAttribute("href")) || anchor.href || "";
  if (/^whatsapp:/i.test(href)) return false;
  const parsed = parseWhatsAppWebUrl(href);
  if (!parsed) return false;
  if (typeof event.preventDefault === "function") event.preventDefault();
  if (typeof event.stopPropagation === "function") event.stopPropagation();
  openWhatsApp({
    phone: parsed.phone,
    text: parsed.text,
    userAgent: overrides.userAgent
  });
  return true;
}

export function installWhatsAppWebAnchorIntercept(root) {
  const doc = root || (typeof document !== "undefined" ? document : null);
  const el = doc && (doc.documentElement || doc);
  if (!doc || !el || typeof doc.addEventListener !== "function") return false;
  if (el.dataset && el.dataset.iaqarWhatsappIntercept === "1") return false;
  if (el.dataset) el.dataset.iaqarWhatsappIntercept = "1";
  else if (typeof el.setAttribute === "function") el.setAttribute("data-iaqar-whatsapp-intercept", "1");
  doc.addEventListener("click", handleWhatsAppWebAnchorClick, true);
  return true;
}

if (typeof document !== "undefined") {
  installWhatsAppWebAnchorIntercept(document);
}
