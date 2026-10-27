import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { validateRecordInput, recordFields } from "../public/os/domain/records-domain.js";
import { validateProposalFields, validateReply, buildProposalMessage } from "../public/os/domain/proposal-domain.js";

const base = { kind: "REQUEST", purpose: "PURCHASE", propertyType: "شقة", city: "الرياض", district: "حي اختباري", price: 1000000, contactName: "عميل اختباري", contactPhone: "0500000000" };
const malformed = ["600ريال000", "600SAR000", "60,00", "600000.505", "-5", "1e6", 1.234];

test("minimum budget preserves Arabic decimals and persists the exact lower bound", () => {
  for (const purpose of ["PURCHASE", "LEASE_REQUEST"]) {
    const result = validateRecordInput({ ...base, purpose, priceMin: "٦٠٠٬٠٠٠٫٥٠" });
    assert.equal(result.ok, true);
    assert.equal(result.value.priceMin, 600000.5);
    assert.equal(recordFields(result.value, { officeId: "synthetic", brokerId: "synthetic" }).priceMin, 600000.5);
  }
});

test("minimum budget rejects malformed nonempty input rather than dropping or sanitizing it", () => {
  for (const priceMin of [...malformed, "abc"]) {
    const result = validateRecordInput({ ...base, priceMin });
    assert.equal(result.ok, false, String(priceMin));
    assert.ok(result.errors.priceMin, String(priceMin));
  }
});

test("an omitted or zero minimum stays optional, and the lower bound stays below the maximum", () => {
  for (const priceMin of [undefined, null, "", "   ", 0, "0", "0.00", "٠٫٠٠"]) {
    const result = validateRecordInput({ ...base, priceMin });
    assert.equal(result.ok, true, String(priceMin));
    assert.equal(result.value.priceMin, null);
  }
  for (const priceMin of [1000000, 1000000.01]) assert.ok(validateRecordInput({ ...base, priceMin }).errors.priceMin);
});

test("proposed price preserves cents in validation and generated message", () => {
  const result = validateProposalFields("PRICE", { price: "٦٠٠٬٠٠٠٫٥٠" });
  assert.equal(result.ok, true);
  assert.equal(result.fields.price, 600000.5);
  assert.match(buildProposalMessage({ kind: "PRICE", fields: result.fields, recipientRole: "client" }), /600,000\.5 ريال/);
});

test("proposed prices reject malformed input on the shared server boundary", () => {
  for (const price of malformed) assert.equal(validateProposalFields("PRICE", { price }).ok, false, String(price));
});

test("counteroffers preserve cents and normalize the saved reply text", () => {
  const result = validateReply("PRICE", "counter", "٦٠٠٬٠٠٠٫٥٠");
  assert.equal(result.ok, true);
  assert.equal(result.value, 600000.5);
  assert.equal(result.text, "600000.5");
});

test("counteroffers reject embedded currency and text beyond the normal text limit", () => {
  for (const raw of [...malformed, "600000" + " ".repeat(500) + "abc"]) {
    assert.equal(validateReply("PRICE", "counter", raw).ok, false, String(raw));
  }
});

test("composer default price retains decimals without rounding the visible field", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://127.0.0.1" });
  const previous = new Map(["document", "Node", "HTMLElement", "requestAnimationFrame"].map(key => [key, globalThis[key]]));
  for (const key of ["document", "Node", "HTMLElement"]) globalThis[key] = dom.window[key];
  globalThis.requestAnimationFrame = callback => { callback(); return 0; };
  try {
    const { openComposer } = await import("../public/os/views/composer.js");
    const { closeAllSheets } = await import("../public/os/core/ui.js");
    openComposer({ id: "synthetic", lastProposal: { fields: { price: 600000.5 } } });
    assert.equal(dom.window.document.querySelector('[name="price"]').value, "600,000.5");
    closeAllSheets();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    dom.window.close();
  }
});

test("Worker rejects malformed minimum budgets, proposals and counteroffers without writes", async () => {
  const { startOfficeOsHarness, OFFICE_A, OWNER_A, idTokenFor } = await import("../scripts/qa/office-os/server.mjs");
  const { seedStates, callWorker } = await import("../scripts/qa/office-os/seed.mjs");
  const h = await startOfficeOsHarness();
  try {
    const seeded = await seedStates(h);
    const rawCall = async (route, body, auth = true) => h.worker.fetch(new Request(`https://worker.test${route}`, {
      method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${idTokenFor(OWNER_A)}` } : {}) }, body: JSON.stringify(body)
    }), h.env, { waitUntil() {} });
    let index = 0;
    for (const purpose of ["PURCHASE", "LEASE_REQUEST"]) {
      for (const priceMin of ["٦٠٠٬٠٠٠٫٥٠", "600ريال000"]) {
        const before = h.store.list(`offices/${OFFICE_A}/opportunities`).length;
        const response = await rawCall("/os/records/save", { officeId: OFFICE_A, requestKey: `min-${index}`, record: { ...base, purpose, priceMin, district: `حي اختباري ${index++}` } });
        const result = await response.json();
        if (priceMin === "600ريال000") {
          assert.equal(response.status, 400);
          assert.equal(h.store.list(`offices/${OFFICE_A}/opportunities`).length, before);
        } else {
          assert.equal(response.status, 200, JSON.stringify(result));
          assert.equal(h.store.get(`offices/${OFFICE_A}/opportunities/${result.recordId}`).priceMin, 600000.5);
        }
      }
    }
    const journeyId = seeded.negotiation.journeyId;
    const beforeProposals = h.store.list(`offices/${OFFICE_A}/proposals`).length;
    const invalidProposal = await rawCall("/os/proposals/create", { officeId: OFFICE_A, journeyId, kind: "PRICE", recipients: ["owner"], fields: { price: "600ريال000" }, requestKey: "bad-price" });
    assert.equal(invalidProposal.status, 400);
    assert.equal(h.store.list(`offices/${OFFICE_A}/proposals`).length, beforeProposals);
    const created = await callWorker(h, "/os/proposals/create", { officeId: OFFICE_A, journeyId, kind: "PRICE", recipients: ["owner"], fields: { price: "٦٠٠٬٠٠٠٫٥٠" }, requestKey: "good-price" });
    const proposal = created.proposals[0];
    const token = proposal.replyUrl.split("#")[1];
    const stored = h.store.get(`offices/${OFFICE_A}/proposals/${proposal.proposalId}`);
    assert.equal(stored.fields.price, 600000.5);
    const invalidReply = await rawCall("/os/reply/submit", { token, optionId: "counter", text: "600ريال000", submissionId: "invalidcounter001" }, false);
    assert.equal(invalidReply.status, 400);
    assert.deepEqual(h.store.get(`offices/${OFFICE_A}/proposals/${proposal.proposalId}`), stored);
    const saved = await callWorker(h, "/os/reply/submit", { token, optionId: "counter", text: "٦٠٠٬٠٠٠٫٥٠", submissionId: "validcounter0001" }, "");
    assert.equal(saved.state, "SAVED");
    assert.equal(h.store.get(`offices/${OFFICE_A}/proposals/${proposal.proposalId}`).reply.text, "600000.5");
  } finally { await new Promise(resolve => h.server.close(resolve)); }
});
