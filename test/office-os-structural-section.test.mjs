import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("shared office sections preserve RTL structure, group identity and existing controls", async () => {
  const dom = new JSDOM('<main id="app" dir="rtl"></main>', { url: "https://example.test/" });
  const previous = new Map(["window", "document", "Node"].map((key) => [key, globalThis[key]]));
  for (const key of previous.keys()) globalThis[key] = dom.window[key];
  try {
    const { h, officeSection } = await import("../public/os/core/dom.js");
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
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    dom.window.close();
  }
});
