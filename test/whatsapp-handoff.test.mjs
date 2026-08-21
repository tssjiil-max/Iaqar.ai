import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWhatsAppAppUrl,
  buildWhatsAppWebUrl,
  isMobileWhatsAppDevice,
  isSafeWhatsAppHttpUrl,
  openWhatsApp,
  openWhatsAppUrl,
  ownerRequestWhatsAppText,
  parseWhatsAppWebUrl,
  viewingAppointmentWhatsAppText,
  viewingDateTimeParts
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

test("openWhatsApp never assigns location.href and always uses https wa.me", () => {
  const calls = [];
  const fakeWindow = {
    location: { href: "https://iaqar-ai-staging--staging-9c4b0k7h.web.app/app" },
    open(url, target, features) {
      calls.push({ url, target, features });
      return { closed: false };
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
    assert.equal(result.ok, true);
    assert.ok(result.url.startsWith("https://wa.me/966512345678?text="));
    assert.equal(fakeWindow.location.href, "https://iaqar-ai-staging--staging-9c4b0k7h.web.app/app");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].target, "_blank");
    assert.ok(calls[0].url.startsWith("https://wa.me/966512345678"));
  } finally {
    globalThis.window = originalWindow;
  }
});

test("openWhatsAppUrl ignores relative site paths", () => {
  const fakeWindow = {
    location: { href: "https://iaqar-ai-staging--staging-9c4b0k7h.web.app/app" },
    open() { return { closed: false }; }
  };
  const originalWindow = globalThis.window;
  globalThis.window = fakeWindow;
  try {
    const result = openWhatsAppUrl("/messages/handoff", { phone: "", text: "hi" });
    assert.equal(result.ok, false);
    assert.equal(fakeWindow.location.href, "https://iaqar-ai-staging--staging-9c4b0k7h.web.app/app");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("isSafeWhatsAppHttpUrl rejects relative and custom schemes", () => {
  assert.equal(isSafeWhatsAppHttpUrl("https://wa.me/966501234567?text=x"), true);
  assert.equal(isSafeWhatsAppHttpUrl("whatsapp://send?phone=966501234567"), false);
  assert.equal(isSafeWhatsAppHttpUrl("/whatsapp"), false);
  assert.equal(isSafeWhatsAppHttpUrl("https://iaqar.ai/whatsapp"), false);
});

test("isMobileWhatsAppDevice detects Android and iPhone", () => {
  assert.equal(isMobileWhatsAppDevice("Android 14"), true);
  assert.equal(isMobileWhatsAppDevice("iPhone"), true);
  assert.equal(isMobileWhatsAppDevice("Windows NT"), false);
});

test("viewingAppointmentWhatsAppText uses date and time only", () => {
  const at = new Date("2026-08-21T15:30:00+03:00");
  const parts = viewingDateTimeParts(at);
  assert.ok(parts.date);
  assert.ok(parts.time);
  const text = viewingAppointmentWhatsAppText(at);
  assert.match(text, /^السلام عليكم، تم تحديد موعد معاينة العقار بتاريخ /);
  assert.ok(text.includes(parts.date));
  assert.ok(text.includes(parts.time));
});

test("ownerRequestWhatsAppText joins selected items and optional note", () => {
  assert.equal(
    ownerRequestWhatsAppText({ items: ["photos"] }),
    "السلام عليكم، نحتاج صور العقار لاستكمال بيانات العرض."
  );
  assert.equal(
    ownerRequestWhatsAppText({ items: ["location"] }),
    "السلام عليكم، نحتاج موقع العقار لاستكمال بيانات العرض."
  );
  assert.equal(
    ownerRequestWhatsAppText({ items: ["photos", "location"] }),
    "السلام عليكم، نحتاج صور العقار وموقع العقار لاستكمال بيانات العرض."
  );
  assert.equal(
    ownerRequestWhatsAppText({ items: ["photos", "location", "propertyLink"] }),
    "السلام عليكم، نحتاج صور العقار وموقع العقار ورابط العقار لاستكمال بيانات العرض."
  );
  assert.equal(
    ownerRequestWhatsAppText({ items: ["photos"], note: "الصور من الواجهة" }),
    "السلام عليكم، نحتاج صور العقار لاستكمال بيانات العرض.\nالصور من الواجهة"
  );
});
