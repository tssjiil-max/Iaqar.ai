// The legacy app writes records straight to Firestore (persistIntake). The matching index is the Worker's: an edit
// from the app removes the record's key in the same write (the rules require it when a key field changes), and a new
// record is created without one.
import test from "node:test";
import assert from "node:assert/strict";

const DELETE = Symbol("FieldValue.delete");
const written = [];
const existingDocs = new Map();
const ref = (path) => ({ path, get: async () => ({ exists: existingDocs.has(path), data: () => existingDocs.get(path) }), collection: (c) => ({ doc: (d) => ref(`${path}/${c}/${d}`) }) });
const firestore = () => ({
  collection: (c) => ({ doc: (d) => ref(`${c}/${d}`) }),
  batch: () => { const ops = []; return { set: (r, data, opts) => ops.push({ path: r.path, data, opts }), commit: async () => { written.push(...ops); } }; }
});
firestore.FieldValue = { delete: () => DELETE, serverTimestamp: () => "SERVER_TIME" };
const inert = () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {}, dataset: {} });
globalThis.document = globalThis.document || { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: inert, body: inert(), documentElement: inert(), readyState: "complete" };
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, location: { search: "", hash: "", href: "https://app.test/" } };
Object.assign(globalThis.window, { IAQAR: { office: { officeId: "office-a", paths: {} } }, firebase: { firestore } });
const { persistIntake } = await import("../public/js/add-opportunity.js");

const result = (id) => ({
  opportunity: { id, officeId: "office-a", opportunityKind: "OFFER", purpose: "SALE", propertyType: "شقة", city: "المدينة المنورة", district: "العزيزية", priceOrBudget: 900000 },
  source: { id: `src_${id}`, officeId: "office-a" }
});

test("a new record from the app is created without a matching key", async () => {
  written.length = 0;
  await persistIntake(result("opp_new"));
  const record = written.find((w) => w.path.endsWith("/opportunities/opp_new"));
  assert.ok(record, "the record was written");
  for (const field of ["matchKey", "matchKeyDistrict", "matchKeyType", "matchKeyVersion"]) assert.ok(!(field in record.data), field);
});

test("an edit from the app removes the record's matching key in the same write", async () => {
  written.length = 0;
  existingDocs.set("offices/office-a/opportunities/opp_old", { officeId: "office-a", city: "الرياض", matchKey: "v1|offer|sale|c%3Ax", matchKeyVersion: "v1" });
  await persistIntake(result("opp_old"), {}, { merge: true });
  const record = written.find((w) => w.path.endsWith("/opportunities/opp_old"));
  assert.ok(record?.opts?.merge, "a merge write");
  for (const field of ["matchKey", "matchKeyDistrict", "matchKeyType", "matchKeyVersion"]) assert.equal(record.data[field], DELETE, field);
});
