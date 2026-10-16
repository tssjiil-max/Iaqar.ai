import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("shared office sections preserve RTL structure, group identity and existing controls", async () => {
  const dom = new JSDOM('<main id="app" dir="rtl"></main>', { url: "https://example.test/" });
  const previous = new Map(["window", "document", "Node"].map((key) => [key, globalThis[key]]));
  for (const key of previous.keys()) globalThis[key] = dom.window[key];
  try {
    const { h, officeSection, field, formGrid, actionBar } = await import("../public/os/core/dom.js");
    let opened = 0;
    const action = h("button", { type: "button", onClick: () => { opened++; } }, "فتح النتيجة");
    const section = officeSection(
      { title: "العروض والطلبات", iconName: "search", description: "نتائج المكتب",
        count: 2, className: "os-center-group", attrs: { "data-search-group": "records" } },
      h("div", { class: "os-center-list" }, action));
    document.getElementById("app").append(section);
    assert.equal(section.getAttribute("data-ui"), "surface");
    assert.equal(section.getAttribute("data-search-group"), "records");
    assert.equal(section.getAttribute("aria-label"), "العروض والطلبات");
    assert.equal(section.querySelector(".os-office-section-head h2").textContent, "العروض والطلبات");
    assert.equal(section.querySelector(".os-office-section-title .os-center-count").textContent, "2");
    assert.equal(section.querySelector(".os-office-section-copy p").textContent, "نتائج المكتب");
    assert.equal(section.querySelector(".os-office-section-body .os-center-list button"), action);
    action.click();
    assert.equal(opened, 1, "Existing action handlers must survive the shared wrapper");
    const withoutCount = officeSection({ title: "الوسطاء", iconName: "users" }, h("span", { text: "عضو" }));
    assert.equal(withoutCount.querySelector(".os-center-count"), null);
    assert.equal(withoutCount.querySelector(".os-office-section-body").textContent, "عضو");
    const stage = h("span", { "data-room-stage": "", text: "التفاوض" });
    const room = officeSection({ title: "روابط الطرفين", attrs: { "aria-label": "روابط الغرفة" }, accessory: stage });
    assert.equal(room.getAttribute("aria-label"), "روابط الغرفة");
    assert.equal(room.querySelector("[data-room-stage]"), stage);
    const phone = h("input", { name: "phone", value: "0501111111" });
    const error = h("small", { role: "alert", "data-error": "phone" });
    const hint = h("small", { role: "status" });
    const form = h("form", {}, formGrid(field("رقم الجوال", phone, { error, hint })), actionBar(action));
    document.getElementById("app").append(form);
    assert.equal(phone.labels[0].textContent, "رقم الجوال");
    error.textContent = "رقم غير صحيح";
    hint.textContent = "جارٍ التحقق";
    assert.equal(form.querySelector('[data-error="phone"]'), error);
    assert.equal(form.querySelector('[role="status"]'), hint);
    assert.equal(new dom.window.FormData(form).get("phone"), "0501111111");
    action.click();
    assert.equal(opened, 2, "Moving original controls into layout slots preserves their handlers");
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    dom.window.close();
  }
});

test("navigation tiles preserve button actions and native external-link semantics", async () => {
  const dom = new JSDOM('<main dir="rtl"></main>', { url: "https://example.test/" });
  const previous = new Map(["window", "document", "Node"].map(key => [key, globalThis[key]]));
  for (const key of previous.keys()) globalThis[key] = dom.window[key];
  try {
    const { navigationTile } = await import("../public/os/core/dom.js");
    let activations = 0;
    const action = navigationTile({ title: "بيانات المكتب", hint: "إدارة بيانات المكتب", iconName: "office",
      attrs: { "data-settings": "profile" }, onClick: () => { activations++; } });
    assert.equal(action.tagName, "BUTTON");
    assert.equal(action.type, "button");
    action.click();
    assert.equal(activations, 1);
    assert.equal(action.querySelector(".ref-reference-copy strong").textContent, "بيانات المكتب");
    const link = navigationTile({ title: "خدمة رسمية", hint: "زيارة الجهة", iconName: "link",
      href: "https://example.org/service", attrs: { class: "os-service-row", target: "_blank",
        rel: "noopener noreferrer", "data-service": "official" } });
    assert.equal(link.tagName, "A");
    assert.equal(link.getAttribute("href"), "https://example.org/service");
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");
    assert.equal(link.dataset.service, "official");
    assert.ok(link.classList.contains("os-service-row"));
    assert.equal(link.querySelector(".ref-reference-copy small").textContent, "زيارة الجهة");
    assert.equal(link.getAttribute("data-ui"), "navigation-tile");
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    dom.window.close();
  }
});
