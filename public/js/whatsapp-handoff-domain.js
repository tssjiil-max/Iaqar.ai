/**
 * Unified WhatsApp handoff — prefer native app deep links on mobile,
 * fall back to wa.me on desktop.
 */

import { whatsappDigits } from "./messaging-domain.js";

export function isMobileWhatsAppDevice(userAgent = "") {
  const ua = String(userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : ""));
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export function buildWhatsAppWebUrl({ phone = "", text = "" } = {}) {
  const digits = whatsappDigits(phone);
  const encoded = encodeURIComponent(String(text || ""));
  if (digits) return `https://wa.me/${digits}?text=${encoded}`;
  return `https://wa.me/?text=${encoded}`;
}

export function buildWhatsAppAppUrl({ phone = "", text = "" } = {}) {
  const digits = whatsappDigits(phone);
  const params = new URLSearchParams();
  if (digits) params.set("phone", digits);
  if (String(text || "").trim()) params.set("text", String(text));
  return `whatsapp://send?${params.toString()}`;
}

export function parseWhatsAppWebUrl(url = "") {
  const raw = String(url || "").trim();
  if (!raw.includes("wa.me")) return null;
  try {
    const parsed = new URL(raw);
    const pathDigits = parsed.pathname.replace(/^\//, "").split("/")[0] || "";
    const phone = /^\d+$/.test(pathDigits) ? pathDigits : "";
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

/**
 * Open WhatsApp to a specific contact when phone is known,
 * or the share picker when phone is omitted.
 */
export function openWhatsApp({ phone = "", text = "", userAgent } = {}) {
  const webUrl = buildWhatsAppWebUrl({ phone, text });
  const mobile = isMobileWhatsAppDevice(userAgent);
  if (mobile && typeof window !== "undefined") {
    window.location.href = buildWhatsAppAppUrl({ phone, text });
    return {
      ok: true,
      mode: phone ? "app_direct" : "app_share",
      url: buildWhatsAppAppUrl({ phone, text }),
      fallbackUrl: webUrl
    };
  }
  if (typeof window !== "undefined") {
    const opened = window.open(webUrl, "_blank", "noopener,noreferrer");
    if (!opened) window.location.href = webUrl;
  }
  return {
    ok: true,
    mode: phone ? "web_direct" : "web_share",
    url: webUrl
  };
}

/** Re-open an existing wa.me / api redirect target using the native app when possible. */
export function openWhatsAppUrl(url, overrides = {}) {
  const parsed = parseWhatsAppWebUrl(url);
  if (parsed) {
    return openWhatsApp({
      phone: overrides.phone || parsed.phone,
      text: overrides.text ?? parsed.text,
      userAgent: overrides.userAgent
    });
  }
  if (typeof window !== "undefined") {
    window.location.href = String(url || "");
  }
  return { ok: Boolean(url), mode: "raw_url", url: String(url || "") };
}
