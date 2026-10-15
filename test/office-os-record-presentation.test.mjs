import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("record cards expose their kind and a full accessible price label while filters and links work", async () => {
  const dom = new JSDOM('<main id="records"></main>', { url: "https://example.test/#/repo" });
  const old = new Map(["window", "document", "Node", "location"].map(key => [key, globalThis[key]]));
  for (const key of old.keys()) globalThis[key] = dom.window[key];
  let dispose;
  try {
    const { state } = await import("../public/os/core/state.js");
    const { renderRepository } = await import("../public/os/views/repository.js");
    state.recordsReady = true;
    state.records = ["OFFER", "REQUEST"].map((kind, i) => ({ id: `record-${i}`, opportunityKind: kind, purpose: "SALE", lifecycleStatus: "ACTIVE", propertyType: "فيلا", district: "شوران", city: "المدينة المنورة", priceOrBudget: 2000000, area: 450, rooms: 4, createdAt: "2026-10-14T08:00:00Z" }));
    const root = document.querySelector("main");
    dispose = renderRepository(root);
    for (const kind of ["OFFER", "REQUEST"]) {
      const card = root.querySelector(`[data-record-kind="${kind}"]`);
      assert.ok(card, `${kind}: record kind must be exposed for styling`);
      assert.ok(card.querySelector("[data-kind-label]").textContent);
      assert.match(card.querySelector(".ref-record-open").getAttribute("aria-label"), kind === "OFFER" ? /السعر/ : /الميزانية/);
    }
    root.querySelector('[data-tab="REQUEST"]').click();
    assert.equal(root.querySelectorAll("[data-record]").length, 1);
    root.querySelector(".ref-record-open").click();
    assert.equal(location.hash, "#/record/record-1");
    if (typeof dispose === "function") dispose();
    root.replaceChildren();
    state.records = [{ ...state.records[0], submitterRole: "EXTERNAL_BROKER", lifecycleStatus: "ARCHIVED", archiveKind: "PAUSED" }];
    dispose = renderRepository(root);
    const status = root.querySelector('select[name="status"]');
    status.value = "ALL";
    status.dispatchEvent(new dom.window.Event("change"));
    const brokerCard = root.querySelector("[data-record]");
    assert.ok(brokerCard, "Status filter can show an inactive broker record");
    const accessibleLabel = brokerCard.querySelector(".ref-record-open").getAttribute("aria-label");
    assert.match(accessibleLabel, /وسيط متعاون/);
    assert.ok(accessibleLabel.includes(brokerCard.querySelector("[data-state-label]").textContent), "Visible lifecycle status is announced");
    for (const meta of brokerCard.querySelectorAll(".ref-record-meta span")) {
      assert.ok(accessibleLabel.includes(meta.textContent), `Visible metadata is announced: ${meta.textContent}`);
    }
  } finally {
    if (typeof dispose === "function") dispose();
    for (const [key, value] of old) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    dom.window.close();
  }
});
