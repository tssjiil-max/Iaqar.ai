import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { validateRecordInput, recordFields } from "../public/os/domain/records-domain.js";
import { formatPrice } from "../public/os/domain/format-domain.js";

const base = { kind: "REQUEST", purpose: "PURCHASE", propertyType: "شقة", city: "الرياض", district: "حي اختباري", contactName: "عميل اختباري", contactPhone: "0500000000" };
for (const purpose of ["PURCHASE", "LEASE_REQUEST"]) {
  test(`${purpose}: Arabic decimal amount survives validation and canonical fields`, () => {
    const result = validateRecordInput({ ...base, purpose, price: "٦٠٠٬٠٠٠٫٥٠" });
    assert.equal(result.ok, true);
    assert.equal(result.value.price, 600000.5);
    const saved = recordFields(result.value, { officeId: "synthetic-office", brokerId: "synthetic-user" });
    assert.equal(saved.priceOrBudget, 600000.5);
    assert.equal(saved.budget, 600000.5);
    if (purpose === "LEASE_REQUEST") assert.equal(saved.annualRent, 600000.5);
  });
  test(`${purpose}: embedded text and malformed amounts are rejected`, () => {
    for (const price of ["600ريال000", "600SAR000", "600s000", "60,00", "600000.505", "-5", "1e6"]) {
      const result = validateRecordInput({ ...base, purpose, price });
      assert.equal(result.ok, false, price);
      assert.ok(result.errors.price, price);
    }
  });
}

test("financial presentation preserves cents without changing whole-number formatting", () => {
  assert.equal(formatPrice(600000.5), "600,000.5 ريال");
  assert.equal(formatPrice(600000), "600,000 ريال");
});

test("numeric payloads must obey the same two-decimal money boundary", () => {
  for (const price of [1.234, -5, Infinity, NaN]) {
    assert.equal(validateRecordInput({ ...base, price }).ok, false, String(price));
  }
  for (const price of [0.25, 600000.5]) {
    const checked = validateRecordInput({ ...base, price });
    assert.equal(checked.ok, true);
    assert.equal(checked.value.price, price);
  }
});

test("record price blur preserves valid decimals and leaves invalid text for validation", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://127.0.0.1" });
  const previous = new Map(["document", "Node", "HTMLElement"].map(key => [key, globalThis[key]]));
  for (const key of previous.keys()) globalThis[key] = dom.window[key];
  try {
    const { recordFormFields } = await import("../public/os/views/record-form.js");
    for (const [raw, expected] of [["٦٠٠٬٠٠٠٫٥٠", "600,000.5"], ["600,000.50", "600,000.5"], ["600ريال000", "600ريال000"]]) {
      const { form } = recordFormFields({ kind: "REQUEST" });
      const input = form.querySelector('[name="price"]');
      input.value = raw;
      input.dispatchEvent(new dom.window.Event("blur"));
      assert.equal(input.value, expected, raw);
    }
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    dom.window.close();
  }
});

test("Worker validates raw prices before persisting purchase and rent records", async () => {
  const { startOfficeOsHarness, OFFICE_A, OWNER_A, idTokenFor } = await import("../scripts/qa/office-os/server.mjs");
  const harness = await startOfficeOsHarness();
  let index = 0;
  try {
    for (const purpose of ["PURCHASE", "LEASE_REQUEST"]) {
      for (const price of ["٦٠٠٬٠٠٠٫٥٠", "600ريال000"]) {
        const before = harness.store.list(`offices/${OFFICE_A}/opportunities`).length;
        const response = await harness.worker.fetch(new Request("https://worker.test/os/records/save", {
          method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${idTokenFor(OWNER_A)}` },
          body: JSON.stringify({ officeId: OFFICE_A, requestKey: `money-${index}`, record: { ...base, purpose, price, district: `حي اختباري ${index++}` } })
        }), harness.env, { waitUntil() {} });
        const result = await response.json();
        if (price === "600ريال000") {
          assert.equal(response.status, 400);
          assert.equal(harness.store.list(`offices/${OFFICE_A}/opportunities`).length, before);
        } else {
          assert.equal(response.status, 200, JSON.stringify(result));
          assert.equal(harness.store.get(`offices/${OFFICE_A}/opportunities/${result.recordId}`).priceOrBudget, 600000.5);
        }
      }
    }
  } finally { await new Promise(resolve => harness.server.close(resolve)); }
});
