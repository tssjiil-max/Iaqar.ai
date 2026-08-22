import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWhatsAppAppUrl,
  buildWhatsAppWebUrl,
  handleWhatsAppWebAnchorClick,
  isMobileWhatsAppDevice,
  isSafeWhatsAppHttpUrl,
  openWhatsApp,
  openWhatsAppUrl,
  ownerRequestWhatsAppText,
  parseWhatsAppWebUrl,
  resolveWhatsAppOpenPlan,
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
  const api = parseWhatsAppWebUrl("https://api.whatsapp.com/send?phone=966558882961&text=hello");
  assert.deepEqual(api, { phone: "966558882961", text: "hello" });
});

test("mobile plan uses the WhatsApp app scheme instead of api.whatsapp.com", () => {
  const mobile = resolveWhatsAppOpenPlan({
    phone: "0512345678",
    text: "مرحبًا",
    userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile"
  });
  assert.equal(mobile.mode, "app_scheme");
  assert.ok(mobile.href.startsWith("whatsapp://send?"));
  assert.ok(mobile.href.includes("phone=966512345678"));
  assert.ok(!mobile.href.includes("api.whatsapp.com"));
  const desktop = resolveWhatsAppOpenPlan({
    phone: "0512345678",
    text: "مرحبًا",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
  });
  assert.equal(desktop.mode, "https_web");
  assert.ok(desktop.href.startsWith("https://wa.me/966512345678?text="));
});

test("openWhatsApp on a phone clicks whatsapp:// and never writes location.href", () => {
  const clicks = [];
  const opens = [];
  const fakeAnchor = {
    href: "",
    click() { clicks.push(this.href); },
    remove() {}
  };
  const fakeDocument = {
    createElement(tag) {
      assert.equal(tag, "a");
      return fakeAnchor;
    },
    body: { appendChild() {} }
  };
  const fakeWindow = {
    location: { href: "https://iaqar-ai-staging--staging-9c4b0k7h.web.app/app" },
    open(url, target) {
      opens.push({ url, target });
      return { closed: false };
    }
  };
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  try {
    const result = openWhatsApp({
      phone: "0512345678",
      text: "مرحبًا",
      userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile"
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "app_scheme");
    assert.ok(result.url.startsWith("whatsapp://send?"));
    assert.equal(fakeWindow.location.href, "https://iaqar-ai-staging--staging-9c4b0k7h.web.app/app");
    assert.equal(opens.length, 0);
    assert.equal(clicks.length, 1);
    assert.ok(clicks[0].startsWith("whatsapp://send?"));
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("openWhatsApp on desktop uses https wa.me in a new tab", () => {
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
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "https_web");
    assert.ok(result.url.startsWith("https://wa.me/966512345678?text="));
    assert.equal(fakeWindow.location.href, "https://iaqar-ai-staging--staging-9c4b0k7h.web.app/app");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].target, "_blank");
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

test("mobile wa.me and api.whatsapp.com anchors open the app scheme instead of a new tab", () => {
  const clicks = [];
  const opens = [];
  const fakeAnchor = {
    href: "",
    click() { clicks.push(this.href); },
    remove() {},
    setAttribute() {}
  };
  const fakeDocument = {
    createElement(tag) {
      assert.equal(tag, "a");
      return fakeAnchor;
    },
    body: { appendChild() {} }
  };
  const fakeWindow = {
    location: { href: "https://iaqar-ai-staging--staging-9c4b0k7h.web.app/app" },
    open(url, target) {
      opens.push({ url, target });
      return { closed: false };
    }
  };
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  try {
    for (const href of [
      "https://wa.me/966558882961?text=%D8%A7%D9%84%D8%B3%D9%84%D8%A7%D9%85",
      "https://api.whatsapp.com/send?phone=966558882961&text=%D8%A7%D9%84%D8%B3%D9%84%D8%A7%D9%85"
    ]) {
      clicks.length = 0;
      opens.length = 0;
      let prevented = false;
      const pageAnchor = {
        href,
        getAttribute(name) {
          if (name === "href") return href;
          if (name === "data-iaqar-whatsapp-direct") return null;
          return null;
        },
        closest(selector) {
          return selector === "a[href]" ? this : null;
        }
      };
      const handled = handleWhatsAppWebAnchorClick({
        target: pageAnchor,
        preventDefault() { prevented = true; },
        stopPropagation() {}
      }, { userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile" });
      assert.equal(handled, true);
      assert.equal(prevented, true);
      assert.equal(opens.length, 0);
      assert.equal(clicks.length, 1);
      assert.ok(clicks[0].startsWith("whatsapp://send?"));
      assert.ok(clicks[0].includes("phone=966558882961"));
      assert.ok(!clicks[0].includes("api.whatsapp.com"));
      assert.equal(fakeWindow.location.href, "https://iaqar-ai-staging--staging-9c4b0k7h.web.app/app");
    }
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("synthetic WhatsApp anchors are not intercepted again", () => {
  let prevented = false;
  const handled = handleWhatsAppWebAnchorClick({
    target: {
      closest() {
        return {
          href: "whatsapp://send?phone=966558882961",
          getAttribute(name) {
            if (name === "data-iaqar-whatsapp-direct") return "1";
            if (name === "href") return "whatsapp://send?phone=966558882961";
            return null;
          }
        };
      }
    },
    preventDefault() { prevented = true; }
  });
  assert.equal(handled, false);
  assert.equal(prevented, false);
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
