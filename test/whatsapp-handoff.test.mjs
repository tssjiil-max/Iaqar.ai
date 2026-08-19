import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWhatsAppAppUrl,
  buildWhatsAppWebUrl,
  isMobileWhatsAppDevice,
  openWhatsApp,
  parseWhatsAppWebUrl
} from "../public/js/whatsapp-handoff-domain.js";

test("buildWhatsAppWebUrl uses phone when available", () => {
  const url = buildWhatsAppWebUrl({ phone: "0512345678", text: "مرحبًا" });
  assert.ok(url.startsWith("https://wa.me/966512345678?text="));
});

test("buildWhatsAppWebUrl without phone opens share mode", () => {
  const url = buildWhatsAppWebUrl({ text: "إعلان" });
  assert.equal(url, "https://wa.me/?text=" + encodeURIComponent("إعلان"));
});

test("buildWhatsAppAppUrl uses whatsapp scheme on mobile", () => {
  const url = buildWhatsAppAppUrl({ phone: "966512345678", text: "test" });
  assert.ok(url.startsWith("whatsapp://send?"));
  assert.ok(url.includes("phone=966512345678"));
});

test("parseWhatsAppWebUrl extracts phone and text", () => {
  const parsed = parseWhatsAppWebUrl("https://wa.me/966512345678?text=hello");
  assert.deepEqual(parsed, { phone: "966512345678", text: "hello" });
});

test("openWhatsApp prefers app scheme on mobile user agents", () => {
  const calls = [];
  const fakeWindow = {
    location: { href: "" },
    open() {
      calls.push("open");
      return null;
    }
  };
  const originalWindow = globalThis.window;
  globalThis.window = fakeWindow;
  try {
    const result = openWhatsApp({
      phone: "0512345678",
      text: "مرحبًا",
      userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile"
    });
    assert.equal(result.mode, "app_direct");
    assert.ok(fakeWindow.location.href.startsWith("whatsapp://send?"));
    assert.equal(calls.length, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("isMobileWhatsAppDevice detects Android and iPhone", () => {
  assert.equal(isMobileWhatsAppDevice("Android 14"), true);
  assert.equal(isMobileWhatsAppDevice("iPhone"), true);
  assert.equal(isMobileWhatsAppDevice("Windows NT"), false);
});
